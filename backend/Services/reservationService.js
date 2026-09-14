// FILE LOCATION: backend/Services/reservationService.js
// DESCRIPTION: Stock reservation for in-progress checkouts. When a customer
//              creates an order, units are deducted from `stock` immediately
//              (a "reservation") so a second buyer can never check out the same
//              unit. The reservation converts to a sale at payment time
//              (decrementStockForOrder skips reserved units) and is returned to
//              the catalog on cancel or after an abandoned-checkout window
//              (releaseExpiredReservations).
//
// Safety by construction: every reservation/release is an atomic conditional
// UPDATE. Releasing re-adds units and zeroes the order's `reserved` markers in
// a transaction, and payment-time decrements are conditional, so even if a
// payment lands precisely while a reservation is being released, stock can
// never go negative or be double-credited.
import pool from '../config/db.js';

const parseItems = (items) => {
  if (Array.isArray(items)) return items;
  if (typeof items === 'string') {
    try { return JSON.parse(items); } catch { return []; }
  }
  return [];
};

/**
 * Attempt to reserve stock for a list of normalized request items.
 * Each item: { productId, quantity, madeToOrder, stock: null|number }.
 * Non made-to-order tracked items are deducted atomically; a request that can
 * no longer be satisfied is returned as a failure WITHOUT reserving it.
 * The input items get `reserved` set when they were fully reserved.
 * @param {Array<{productId: number, quantity: number, madeToOrder?: boolean, stock?: number|null}>} requestedItems
 * @returns {Promise<{ reserved: Map<number, number>, failures: Array<{productId: number, quantity: number, available: number}> }>}
 */
export const reserveStockForItems = async (requestedItems) => {
  const reserved = new Map();
  const failures = [];

  for (const r of requestedItems) {
    if (r.madeToOrder || r.stock === null || r.stock === undefined) continue;
    const [res] = await pool.execute(
      `UPDATE product SET stock = stock - ?
       WHERE id = ? AND madeToOrder = FALSE AND stock IS NOT NULL AND stock >= ?`,
      [r.quantity, r.productId, r.quantity]
    );
    if (res.affectedRows > 0) {
      reserved.set(r.productId, (reserved.get(r.productId) || 0) + r.quantity);
      r.reserved = r.quantity;
    } else {
      const [[cur]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [r.productId]);
      failures.push({
        productId: r.productId,
        quantity: r.quantity,
        available: cur?.stock ?? 0,
      });
    }
  }

  return { reserved, failures };
};

/**
 * Release reservations held by pending orders older than `maxAgeMinutes` that
 * were never paid. Returns the number of orders released. Idempotent and safe
 * to run on every scheduler tick.
 * @param {number} [maxAgeMinutes]
 */
export const releaseExpiredReservations = async (maxAgeMinutes = 45) => {
  const [orders] = await pool.execute(
    `SELECT id, items FROM orders
     WHERE paymentStatus = 'pending'
       AND orderStatus = 'pending'
       AND escrowStatus = 'none'
       AND created_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [maxAgeMinutes]
  );

  let released = 0;
  for (const order of orders) {
    const items = parseItems(order.items);
    const reservedByProduct = new Map();
    for (const it of items) {
      const productId = parseInt(it?.product ?? it?.productId, 10);
      const reserved = parseInt(it?.reserved, 10) || 0;
      if (productId && reserved > 0) {
        reservedByProduct.set(productId, (reservedByProduct.get(productId) || 0) + reserved);
      }
    }
    if (reservedByProduct.size === 0) continue;

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      // Re-check in the transaction: if a webhook just marked this order paid,
      // skip — the reservation already converted to a sale.
      const [rows] = await connection.execute(
        `SELECT id FROM orders WHERE id = ? AND paymentStatus = 'pending' AND orderStatus = 'pending'`,
        [order.id]
      );
      if (rows.length === 0) {
        await connection.rollback();
        continue;
      }

      let anyRestored = false;
      for (const [productId, qty] of reservedByProduct) {
        const [res] = await connection.execute(
          `UPDATE product SET stock = stock + ? WHERE id = ? AND madeToOrder = FALSE`,
          [qty, productId]
        );
        if (res.affectedRows > 0) anyRestored = true;
      }

      if (anyRestored) {
        // Zero the reserved markers so a later cancel can't double-release.
        const cleanItems = items.map((it) =>
          parseInt(it?.reserved, 10) > 0 ? { ...it, reserved: 0 } : it
        );
        await connection.execute(
          `UPDATE orders SET items = ? WHERE id = ? AND paymentStatus = 'pending' AND orderStatus = 'pending'`,
          [JSON.stringify(cleanItems), order.id]
        );
        await connection.commit();
        released += 1;
        console.log(`⏱️ Released expired stock reservation for order ${order.id}`);
      } else {
        await connection.rollback();
      }
    } catch (err) {
      await connection.rollback();
      console.warn(`⚠️ Could not release reservation for order ${order.id}: ${err.message}`);
    } finally {
      connection.release();
    }
  }

  return released;
};