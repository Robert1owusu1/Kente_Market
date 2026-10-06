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
import { recordStockMove } from './stockMoves.js';
import Coupon from '../models/couponModel.js';

/**
 * N-7/V-04: hand back the coupon slot held by an abandoned checkout. Only a
 * RESERVED slot (state 1) can be released and only by whichever process wins
 * the 1 -> 0 CAS, so cancelOrder and this sweeper can never release the same
 * slot twice, and a settled (state 2) slot is never touched.
 * @param {any} order
 */
const releaseCouponSlot = async (order) => {
  if (!order?.couponId) return;
  try {
    await Coupon.releaseForOrder(order.id, order.couponId);
  } catch (err) {
    // Fail-safe direction: a missed release only costs availability of the
    // coupon, it can never fund an extra discounted order.
    console.warn(` Could not release coupon reservation for order ${order.id}: ${err.message}`);
  }
};

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
      await recordStockMove({ productId: r.productId, delta: -r.quantity, reason: 'reserve' });
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
 *
 * Also hands back any coupon slot the abandoned checkout was holding
 * (N-7/V-04) — but only for the process that won the cancellation claim, and
 * only for a slot that is still merely reserved (state 1), never a settled one.
 *
 * @param {number} [maxAgeMinutes]
 * @param {{ notesLike?: string|null }} [scope] Optional narrow scope. Tests use
 *   it so a targeted sweep never touches another suite's fixtures; production
 *   (and every existing caller) omits it and sweeps everything, unchanged.
 */
export const releaseExpiredReservations = async (maxAgeMinutes = 45, { notesLike = null } = {}) => {
  const [orders] = await pool.execute(
    `SELECT id, items, couponId FROM orders
     WHERE paymentStatus = 'pending'
       AND orderStatus = 'pending'
       AND escrowStatus = 'none'
       AND created_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)
       AND (? IS NULL OR notes LIKE ?)`,
    [maxAgeMinutes, notesLike, notesLike]
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
    if (reservedByProduct.size === 0) {
      // No reserved units (made-to-order only, or markers already zeroed).
      // Still cancel the abandoned checkout so it does not sit pending
      // forever; there is simply no stock to restore.
      try {
        await pool.execute(
          `UPDATE orders SET orderStatus = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND paymentStatus = 'pending' AND orderStatus = 'pending'`,
          [order.id]
        );
        await releaseCouponSlot(order);
        released += 1;
      } catch { /* best-effort */ }
      continue;
    }

    const connection = await pool.getConnection();
    let claimWon = false;
    try {
      await connection.beginTransaction();
      // ATOMIC CLAIM: Try to mark the order as cancelled first.
      // This is the critical race guard — only ONE process (sweeper or cancelOrder)
      // can win this conditional UPDATE. The loser gets affectedRows === 0 and
      // must not restore stock.
      const cleanItems = items.map((it) =>
        parseInt(it?.reserved, 10) > 0 ? { ...it, reserved: 0 } : it
      );
      const [claim] = await connection.execute(
        `UPDATE orders SET items = ?, orderStatus = 'cancelled' WHERE id = ? AND paymentStatus = 'pending' AND orderStatus = 'pending'`,
        [JSON.stringify(cleanItems), order.id]
      );

      // If we didn't win the claim, another process (cancelOrder or another sweeper)
      // already cancelled this order. Do NOT restore stock — they already did.
      if (claim.affectedRows === 0) {
        await connection.rollback();
        continue;
      }

      // We own the cancellation — now safely restore the reserved stock.
      let anyRestored = false;
      for (const [productId, qty] of reservedByProduct) {
        const [res] = await connection.execute(
          `UPDATE product SET stock = stock + ? WHERE id = ? AND madeToOrder = FALSE`,
          [qty, productId]
        );
        if (res.affectedRows > 0) anyRestored = true;
      }

      if (anyRestored) {
        await connection.commit();
        released += 1;
        for (const [productId, qty] of reservedByProduct) {
          await recordStockMove({ productId, delta: qty, reason: 'expiry-release', orderId: order.id });
        }
        console.log(`⏱ Released expired stock reservation for order ${order.id}`);
      } else {
        // No stock to restore (made-to-order items, etc.) — still committed the
        // order cancellation above so the order stays cancelled.
        await connection.commit();
        released += 1;
      }

      // N-7/V-04: we won the cancellation claim, so this order's reserved
      // coupon slot is ours to give back. Deferred until after the connection
      // below is released — releaseForOrder opens a transaction of its own and
      // must never nest inside this one.
      claimWon = true;
    } catch (err) {
      await connection.rollback();
      console.warn(` Could not release reservation for order ${order.id}: ${err.message}`);
    } finally {
      connection.release();
    }
    if (claimWon) {
      await releaseCouponSlot(order);
    }
  }

  return released;
};