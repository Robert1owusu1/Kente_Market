// @ts-check
// FILE LOCATION: controllers/orderController.js
// DESCRIPTION: Complete order controller with all CRUD operations and analytics

import Order from "../models/orderModel.js";
import pool from "../config/db.js";
import Coupon from "../models/couponModel.js";
import Notification from "../models/notificationModel.js";
import isValidId from "../utils/isValidId.js";
import { computeTopProductTypes } from "../utils/marketInsights.js";
import paystackServices from "../Services/paystackservices.js";
import { computeExpectedCompletion } from "../utils/computeExpectedCompletion.js";
import { round2, calcSubtotal, calcTax, calcShipping, calcCouponDiscount, calcOrderTotals } from "../../shared/pricing.js";
import {
  createEscrowAllocations,
  reallocateOrderEscrow,
  consumeCouponForOrder,
  releaseEscrowForOrder,
  setEscrowReleaseDeadline,
  getOrderAllocations,
  holdEscrowForOrder,
  cancelEscrowForOrder,
  retryFailedAllocations,
  ESCROW_RELEASE_DAYS,
} from "../Services/escrowService.js";
import { reserveStockForItems } from "../Services/reservationService.js";
import { recordStockMove } from "../Services/stockMoves.js";
import { sendOrderConfirmationEmail, sendEscrowReleasedEmail } from "../utils/orderEmailService.js";
import { auditFromRequest } from "../utils/auditLog.js";
import { recordFinancialEvent } from "../Services/ledgerService.js";
import { newOrderNumber } from "../utils/orderNumber.js";

// Client-supplied order-item images are stored and rendered to other users (e.g.
// in the vendor's order view), so they must not be able to carry javascript: or
// data: URLs (XSS via <img src>). Only http(s) URLs or relative /uploads paths
// are kept; anything else is rejected and the product's own image is used.
const safeOrderImage = (/** @type {string|null|undefined} */ image) => {
  if (!image || typeof image !== "string") return null;
  const trimmed = image.trim();
  if (trimmed.startsWith("/uploads/") || /^https?:\/\//i.test(trimmed)) {
    return trimmed.slice(0, 1000);
  }
  return null;
};

// Decrement in-stock inventory when an order becomes paid. Made-to-order items
// are woven on demand so their (zero) stock is not decremented.
//
// Concurrency (oversell) protection: each product is decremented with an
// ATOMIC + CONDITIONAL statement — `WHERE stock >= ?` — so two buyers racing
// for the last unit serialize on the row (InnoDB), and the second one simply
// cannot take the unit. Stock never goes negative and no paid order silently
// oversells: products that can't be fully covered are left untouched and
// recorded as a "stock conflict" (shortfall), which flags the order and
// notifies admin, the vendor and the customer so it is resolved visibly
// instead of failing at fulfilment.
//
// This helper must never block the payment confirmation flow (it is
// fire-and-forget) — any failure is logged for operator review.
/**
 * @param {Array<{product?: any, productId?: any, qty?: any, quantity?: any, reserved?: any}>} items
 * @param {number|string|null} [orderId] when provided, shortfalls flag the order + notify
 * @returns {Promise<{ decremented: Record<number, number>, shortfall: number, conflicts: Array<{productId: number, title: string, missing: number, available: number, vendorId: number|null}> }>}
 */
export const decrementStockForOrder = async (items, orderId = null) => {
  if (!Array.isArray(items) || items.length === 0) {
    return { decremented: {}, shortfall: 0, conflicts: [] };
  }
  const decrements = new Map();
  for (const item of items) {
    const productId = parseInt(item.product ?? item.productId, 10);
    const qty = parseInt(item.qty ?? item.quantity, 10);
    if (!productId || isNaN(qty) || qty <= 0) continue;
    const reserved = parseInt(item.reserved, 10) || 0;
    const existing = decrements.get(productId) || { qty: 0, reserved: 0 };
    decrements.set(productId, { qty: existing.qty + qty, reserved: existing.reserved + reserved });
  }
  if (decrements.size === 0) {
    return { decremented: {}, shortfall: 0, conflicts: [] };
  }

  const connection = await pool.getConnection();
  /** @type {Record<number, number>} */
  const decremented = {};
  const conflicts = [];
  try {
    for (const [productId, { qty, reserved }] of decrements) {
      // Units already reserved at order placement are already off the stock
      // column — only the remainder still needs taking at payment time.
      const toTake = qty - reserved;
      if (toTake <= 0) continue;

      const [result] = await connection.execute(
        `UPDATE product
         SET stock = stock - ?
         WHERE id = ? AND madeToOrder = FALSE AND stock IS NOT NULL AND stock >= ?`,
        [toTake, productId, toTake]
      );
      if (result.affectedRows > 0) {
        decremented[productId] = toTake;
        await recordStockMove({ productId, delta: -toTake, reason: 'sale', orderId });
        continue;
      }
      // Nothing could be taken — distinguish a real shortage from products that
      // are exempt from stock tracking (made-to-order / NULL stock).
      const [rows] = await connection.execute(
        `SELECT id, title, stock, madeToOrder, vendorId FROM product WHERE id = ?`,
        [productId]
      );
      const p = rows[0];
      if (p && !p.madeToOrder && p.stock !== null && p.stock !== undefined) {
        const available = parseInt(p.stock, 10) || 0;
        conflicts.push({
          productId,
          title: p.title || `Product #${productId}`,
          missing: Math.max(1, toTake - available),
          available,
          vendorId: p.vendorId || null,
        });
      }
    }

    const shortfall = conflicts.reduce((sum, c) => sum + c.missing, 0);
    if (orderId && conflicts.length > 0) {
      await flagStockShortfall(orderId, conflicts);
    }
    return { decremented, shortfall, conflicts };
  } catch (err) {
 console.warn(` Stock decrement failed: ${err.message}`);
    return { decremented, shortfall: 0, conflicts };
  } finally {
    connection.release();
  }
};

// Persist the shortfall on the order (merge by product, keep the largest
// missing count) and notify admin, the vendor(s) and the customer. All
// non-fatal — the payment flow is already complete by now.
/** @param {number|string} orderId @param {Array<{productId: number, title: string, missing: number, available: number, vendorId: number|null}>} conflicts */
const flagStockShortfall = async (orderId, conflicts) => {
  try {
    const [rows] = await pool.execute(
      `SELECT COALESCE(stockShortfall, 0) AS currentShortfall, stockConflicts FROM orders WHERE id = ?`,
      [orderId]
    );
    if (rows.length === 0) return;

    const merged = new Map();
    for (const c of rows[0].stockConflicts || []) {
      if (c?.productId) merged.set(c.productId, c);
    }
    for (const c of conflicts) {
      const existing = merged.get(c.productId);
      merged.set(c.productId, existing && existing.missing >= c.missing ? existing : c);
    }
    const allConflicts = [...merged.values()];
    const totalShortfall = allConflicts.reduce((s, c) => s + (c.missing || 0), 0);

    await pool.execute(
      `UPDATE orders SET stockShortfall = ?, stockConflicts = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [Math.max(Number(rows[0].currentShortfall) || 0, totalShortfall), JSON.stringify(allConflicts), orderId]
    );
  } catch (err) {
 console.warn(` Could not flag stock shortfall for order ${orderId}: ${err.message}`);
  }

  try {
    const [adminUsers] = await pool.execute(`SELECT id FROM users WHERE role = 'admin' LIMIT 5`);
    const list = conflicts.map((c) => `${c.title} (${c.missing} short)`).join(', ');
    for (const admin of adminUsers) {
      await Notification.create({
        userId: admin.id,
        type: 'system',
        title: 'Stock shortage on paid order',
        message: `Order #${orderId} was paid but stock is short for: ${list}. Restock the items or contact the customer to resolve.`,
        link: `/admin/orders`,
      });
    }
  } catch (err) {
 console.warn(` Could not notify admins of stock shortfall: ${err.message}`);
  }

  try {
    const vendorIds = [...new Set(conflicts.map((c) => c.vendorId).filter(Boolean))];
    for (const vendorId of vendorIds) {
      await Notification.create({
        userId: vendorId,
        type: 'system',
        title: 'Sold more than you have in stock',
        message: `A paid order #${orderId} needs more of your item(s) than are in stock. Update your stock level or contact the customer.`,
        link: `/vendor/orders`,
      });
    }
  } catch (err) {
 console.warn(` Could not notify vendors of stock shortfall: ${err.message}`);
  }

  try {
    const [[orderRow]] = await pool.execute(`SELECT userId FROM orders WHERE id = ?`, [orderId]);
    if (orderRow?.userId) {
      await Notification.create({
        userId: orderRow.userId,
        type: 'system',
        title: 'Confirming your stock',
        message: `One of your items sold out faster than expected — we're confirming a restock with the weaver and will keep you posted.`,
        link: `/orders/${orderId}`,
      });
    }
  } catch (err) {
 console.warn(` Could not notify customer of stock shortfall: ${err.message}`);
  }
};

// Restore in-stock inventory when a paid order is cancelled/refunded. Made-to-order
// items are skipped, and products that were never taken (stock conflicts at
// payment time) are also skipped so stock is not inflated.
/** @param {Array<{product?: any, productId?: any, qty?: any, quantity?: any}>} items @param {{ skipProductIds?: Set<number>, reason?: string, orderId?: number|string|null }} [options] */
export const restoreStockForOrder = async (items, { skipProductIds = new Set(), reason = 'cancel-restore', orderId = null } = {}) => {
  if (!Array.isArray(items) || items.length === 0) return;
  const restores = new Map();
  for (const item of items) {
    const productId = parseInt(item.product ?? item.productId, 10);
    const qty = parseInt(item.qty ?? item.quantity, 10);
    if (!productId || isNaN(qty) || qty <= 0) continue;
    if (skipProductIds.has(productId)) continue;
    restores.set(productId, (restores.get(productId) || 0) + qty);
  }
  if (restores.size === 0) return;

  const connection = await pool.getConnection();
  try {
    for (const [productId, qty] of restores) {
      const [res] = await connection.execute(
        `UPDATE product SET stock = stock + ? WHERE id = ? AND madeToOrder = FALSE`,
        [qty, productId]
      );
      if (res.affectedRows > 0) {
        await recordStockMove({ productId, delta: qty, reason, orderId });
      }
    }
  } catch (err) {
 console.warn(` Stock restore failed: ${err.message}`);
  } finally {
    connection.release();
  }
};

/**
 * Express Request augmented with the authenticated user (attached by the
 * `authMiddleware`) and scalar route params/query (validated where needed).
 * @typedef {import("express").Request & {
 *   params: Record<string, any>,
 *   query: Record<string, any>,
 *   user: { id: number | string, name?: string, email?: string, role: string }
 * }} AppRequest
 */

// ============================================
// CRUD OPERATIONS (Your existing functions)
// ============================================

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
/** @param {AppRequest} req @param {import("express").Response} res */
export const addOrderItems = async (req, res) => {
  // Hoisted so the catch block can roll back reservations taken in the try.
  let reservedUnits = new Map();
  let newOrder = null; /** @type { { id: number | string, [key: string]: any } | null } */
  // N-7 / V-04: coupon booking state for THIS request. Declared outside the
  // try so the catch block can hand a reserved use back when the booking fails.
  let appliedCouponId = null;
  let couponSlotReserved = false;
  try {
    const rawItems = /** @type {Array<any>} */ (Array.isArray(req.body.items) ? req.body.items : []);
    if (rawItems.length === 0) {
      return res.status(400).json({ message: "Order must contain at least one item" });
    }

    // Normalize client items into {productId, quantity, ...}. We deliberately do
    // NOT trust any client-supplied price — prices are re-fetched from the DB.
    const requested = rawItems.map((item) => {
      const productId = parseInt(item.product || item.productId || item.id);
      const quantity = parseInt(item.quantity ?? item.qty);
      return {
        productId,
        quantity: quantity > 0 ? quantity : 1,
        image: item.image || null,
        selectedColor: item.selectedColor || item.color || null,
        selectedSize: item.selectedSize || item.size || null,
        name: typeof item.name === "string" ? item.name.slice(0, 200) : null,
        // Filled in later: madeToOrder/stock from the product row (below),
        // reserved by reserveStockForItems (defaults to 0 when not reserved).
        madeToOrder: false,
        stock: /** @type {number|null} */ (null),
        reserved: 0,
      };
    });

    if (requested.some((r) => isNaN(r.productId) || r.productId <= 0)) {
      return res.status(400).json({ message: "Each item needs a valid productId" });
    }

    // Cap per-item quantity to a sane ceiling. Without this, an unbounded
    // quantity (e.g. 999,999,999) multiplied by price produces absurd totals /
    // single-order revenue — see audit finding.
    const MAX_QTY_PER_ITEM = 99;
    for (const r of requested) {
      if (r.quantity > MAX_QTY_PER_ITEM) {
        return res.status(400).json({ message: `Quantity for an item cannot exceed ${MAX_QTY_PER_ITEM}` });
      }
    }

    // ---- Server-side authoritative pricing ----
    const productIds = [...new Set(requested.map((r) => r.productId))];
    const placeholders = productIds.map(() => "?").join(", ");
    const [products] = await pool.execute(
      `SELECT id, title, price, img, vendorId, isCustomizable, productionTime, stock, madeToOrder, approvalStatus FROM product WHERE id IN (${placeholders})`,
      productIds
    );
    const productMap = new Map((/** @type {Array<any>} */ (products)).map((p) => [p.id, p]));
    if (productMap.size !== productIds.length) {
      return res.status(400).json({ message: "One or more products are no longer available" });
    }

    // Moderation gate (P0-1): only admin-approved products may be ordered.
    // Rejected / pending / changes_requested items must never reach payment,
    // escrow allocation or stock reservation — even when ordered by direct ID.
    const unapproved = [...productMap.values()].find((p) => p.approvalStatus !== 'approved');
    if (unapproved) {
      return res.status(400).json({ message: "One or more products are not available for sale" });
    }

    // Suspended-vendor gate: products from non-approved vendors must not be
    // purchasable even by direct ID (public listings hide them, but checkout
    // bypasses the model). Check authoritative vendor status here.
    {
      const ownerIds = [...new Set([...productMap.values()].map((p) => p.vendorId).filter((v) => v != null))];
      if (ownerIds.length > 0) {
        const vPlaceholders = ownerIds.map(() => "?").join(", ");
        const [vrows] = await pool.execute(
          `SELECT userId, status FROM vendors WHERE userId IN (${vPlaceholders})`,
          ownerIds
        );
        const statusByVendor = new Map(vrows.map((/** @type {any} */ r) => [r.userId, r.status]));
        const blocked = [...productMap.values()].find((p) => {
          if (p.vendorId == null) return false; // platform-owned
          return statusByVendor.get(p.vendorId) !== 'approved';
        });
        if (blocked) {
          return res.status(400).json({ message: "One or more products are not available for sale" });
        }
      }
    }

    // Stock enforcement: reject quantities that exceed available inventory for
    // in-stock (non made-to-order) items. Made-to-order items are woven on
    // demand, so finite stock does not apply.
    for (const r of requested) {
      const p = productMap.get(r.productId);
      const madeToOrder = !!p.madeToOrder;
      const hasStock = p.stock !== null && p.stock !== undefined;
      if (!madeToOrder && hasStock && r.quantity > parseInt(p.stock, 10)) {
        return res.status(400).json({
          message: `Only ${p.stock} unit(s) of "${p.title}" are available. Please reduce the quantity.`,
        });
      }
    }

    // Reserve in-stock units for this pending order (atomic + conditional, one
    // UPDATE per product). Units are deducted from `stock` immediately so two
    // buyers can never both check out the last unit — the second one gets a
    // clear "only N available" error here instead of a conflict after paying.
    // The reservation converts to a sale at payment time (decrementStockForOrder
    // skips reserved units) and is released on cancel or expiry
    // (releaseExpiredReservations). Reservation is tracked per order item via
    // `reserved`, and a failed reservation rejects the checkout outright.
    for (const r of requested) {
      const p = productMap.get(r.productId);
      r.madeToOrder = !!p.madeToOrder;
      r.stock = p.stock;
    }
    const { reserved, failures: reservationFailures } = await reserveStockForItems(requested);
    reservedUnits = reserved;
    if (reservationFailures.length > 0) {
      // SECURITY FIX (V-03): Restore any units already reserved before returning.
      // Without this, a partial failure permanently locks those units out of
      // the catalog because no order row exists for the sweeper to recover.
      if (reservedUnits.size > 0) {
        try {
          await restoreStockForOrder(
            [...reservedUnits].map(([productId, qty]) => ({ product: productId, qty })),
            { reason: 'reserve-rollback' }
          );
        } catch (restoreErr) {
 console.warn(` Could not roll back partial reservation: ${restoreErr.message}`);
        }
      }
      const f = reservationFailures[0];
      const p = productMap.get(f.productId);
      return res.status(400).json({
        message: `Only ${f.available} unit(s) of "${p?.title || 'this item'}" are available. Please reduce the quantity.`,
      });
    }

    const items = requested.map((r) => {
      const p = productMap.get(r.productId);
      return {
        product: r.productId,
        name: r.name || p.title,
        qty: r.quantity,
        price: round2(parseFloat(p.price) || 0),
        image: safeOrderImage(r.image) || p.img,
        selectedColor: r.selectedColor,
        selectedSize: r.selectedSize,
        vendorId: p.vendorId || null,
        // Customisation metadata: used to compute weaving progress ("days left")
        // for custom orders. The vendor sets productionTime (in days) on the product.
        isCustomizable: !!p.isCustomizable,
        productionTime: parseInt(p.productionTime) || 1,
        reserved: r.reserved || 0,
      };
    });

    // Authoritative totals — single source of truth is shared/pricing.js (the
    // same functions drive the cart page, so price shown == price charged).
    const { subtotal, tax, shipping } = calcOrderTotals(items);

    // Coupon: discount is computed server-side and never trusted from the client.
    // The code is validated against the DB, and the resulting discount is
    // authoritative so a user cannot invent their own totals.
    let discount = 0;
    // appliedCouponId / couponSlotReserved are declared above the try block so
    // the catch path can release a slot this booking took but never completed.
    const couponCode = (req.body.couponCode || "").trim();
    if (couponCode) {
      // P0-4: vendor coupons apply only to their own vendor's cart. The vendor
      // set comes from authoritative DB rows fetched above, never the client.
      const cartVendorIds = [...new Set(
        requested.map((r) => productMap.get(r.productId)?.vendorId).filter((v) => v != null)
      )];
      const couponResult = await Coupon.validate(couponCode, subtotal, { vendorIds: cartVendorIds });
      if (!couponResult.valid) {
        return res.status(400).json({ message: couponResult.message });
      }
      const c = couponResult.coupon;
      // N-7 / V-04: `validate` above is ADVISORY — it only tells us the coupon
      // looked usable a moment ago. This reservation is the authority: one
      // atomic conditional UPDATE either hands us exactly ONE use or tells us
      // the cap is already spent, and it does so BEFORE any discount is booked
      // onto the order. Two concurrent checkouts cannot both win it, so a
      // capped coupon can never fund more discounted orders than maxUses.
      const reservation = await Coupon.reserveUse(c.id);
      if (!reservation.reserved) {
        return res.status(400).json({ message: "Coupon usage limit reached" });
      }
      couponSlotReserved = true;
      discount = calcCouponDiscount(subtotal, c.discountType, c.discountValue);
      appliedCouponId = c.id;
    }

    const totalAmount = calcOrderTotals(items, { discount }).total;

    // IMPORTANT: paymentStatus is always forced to "pending". A client must NEVER
    // be able to self-assert a payment as paid. Orders are marked paid only by the
    // Paystack webhook or by an admin.
    const orderData = {
      userId: req.user.id,
      // N-18: must NOT be a bare `Date.now()` — orders.orderNumber is UNIQUE
      // and two checkouts in the same millisecond collided, giving the loser a
      // 500 and losing their basket. See utils/orderNumber.js.
      orderNumber: newOrderNumber("ORD"),
      items,
      totalAmount,
      shippingAddress: req.body.shippingAddress || {},
      billingAddress: req.body.billingAddress || {},
      paymentMethod: req.body.paymentMethod || "pending",
      paymentStatus: "pending",
      orderStatus: "pending",
      shippingCost: shipping,
      tax,
      discount,
      notes: req.body.notes || null,
      paymentReference: req.body.paymentReference || req.body.paymentResult?.id || null,
      couponId: appliedCouponId,
      // 1 = this order already holds its coupon slot (reserved above).
      couponUseState: appliedCouponId ? 1 : 0,
    };

    // A payment reference identifies exactly ONE Paystack charge. Refuse to
    // create a second order carrying a reference that already exists — one
    // charge must never be able to pay two orders.
    if (orderData.paymentReference) {
      const [[dupRef]] = await pool.execute(
        `SELECT id FROM orders WHERE paymentReference = ? LIMIT 1`,
        [orderData.paymentReference]
      );
      if (dupRef) {
        if (reservedUnits.size > 0) {
          try {
            await restoreStockForOrder(
              [...reservedUnits].map(([productId, qty]) => ({ product: productId, qty })),
              { reason: 'create-rollback' }
            );
          } catch (restoreErr) {
 console.warn(` Could not roll back reservation: ${restoreErr.message}`);
          }
        }
        // N-7/V-04: the order row was never created, so hand the reserved
        // coupon use straight back (there is no order to CAS against yet).
        if (couponSlotReserved) {
          couponSlotReserved = false;
          try {
            await Coupon.decrementUses(appliedCouponId);
          } catch (couponErr) {
 console.warn(` Could not release coupon reservation: ${couponErr.message}`);
          }
        }
        return res.status(400).json({ message: "This payment reference has already been used" });
      }
    }

    newOrder = await Order.create(orderData);

    // N-7/V-04: ONE use was already taken above, atomically, and is recorded on
    // the order (couponUseState = 1). Payment/settlement only flips that to 2 —
    // it never takes another slot, so webhook + verify retries for the same
    // order cannot burn extra redemptions. A cancelled/expired order gives the
    // slot back (see cancelOrder / releaseExpiredReservations).

    // Multi-vendor escrow: split the order into per-vendor allocations at
    // placement. Platform-owned items are excluded automatically (no vendorId
    // on the product). Pass the order-level discount so vendors are allocated
    // net of it — the platform must not fund coupons out of its own share.
    await createEscrowAllocations(newOrder.id, items, { discount });

    res.status(201).json({ message: "Order created successfully", order: newOrder });
  } catch (error) {
    console.error('Error creating order:', error);
    // N-7/V-04: a booking that did not survive must not burn a redemption —
    // give the reserved coupon use back (via the order row when one exists,
    // otherwise straight to the counter; the order cannot settle either way).
    if (couponSlotReserved) {
      couponSlotReserved = false;
      try {
        if (newOrder?.id) {
          await Coupon.releaseForOrder(newOrder.id, appliedCouponId);
        } else {
          await Coupon.decrementUses(appliedCouponId);
        }
      } catch (couponErr) {
 console.warn(` Could not release coupon reservation: ${couponErr.message}`);
      }
    }
    // Roll back any stock reservation taken for this order so a failed creation
    // never permanently locks units out of the catalog.
    if (reservedUnits.size > 0) {
      try {
        if (newOrder?.id) {
          // Order was created but something after it failed (e.g. escrow allocation).
          // Cancel the order to restore stock immediately rather than waiting for
          // the 45-minute sweeper. This also voids any partial escrow allocations.
          // Zero the reserved markers on the stored items so a later reader
          // never sees stale reserved>0 on a cancelled order.
          try {
            const [[created]] = await pool.execute(`SELECT items FROM orders WHERE id = ?`, [newOrder.id]);
            let stored = created?.items;
            if (typeof stored === 'string') { try { stored = JSON.parse(stored); } catch { stored = null; } }
            if (Array.isArray(stored)) {
              const cleaned = stored.map((it) =>
                parseInt(it?.reserved, 10) > 0 ? { ...it, reserved: 0 } : it
              );
              await pool.execute(
                `UPDATE orders SET items = ?, orderStatus = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [JSON.stringify(cleaned), newOrder.id]
              );
            } else {
              await pool.execute(
                `UPDATE orders SET orderStatus = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [newOrder.id]
              );
            }
          } catch {
            await pool.execute(
              `UPDATE orders SET orderStatus = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
              [newOrder.id]
            );
          }
          await restoreStockForOrder(
            [...reservedUnits].map(([productId, qty]) => ({ product: productId, qty })),
            { reason: 'create-rollback', orderId: newOrder.id }
          );
          await pool.execute(
            `UPDATE escrow_allocations SET status = 'failed', reason = 'order creation failed', updated_at = CURRENT_TIMESTAMP WHERE orderId = ? AND status IN ('pending', 'held')`,
            [newOrder.id]
          );
        } else {
          // Order.create never succeeded; simple in-memory rollback is correct.
          await restoreStockForOrder(
            [...reservedUnits].map(([productId, qty]) => ({ product: productId, qty })),
            { reason: 'create-rollback' }
          );
        }
      } catch (restoreErr) {
 console.warn(` Could not roll back reservation: ${restoreErr.message}`);
      }
    }
    // The SELECT-then-INSERT on paymentReference above is not atomic: when two
    // checkouts race the same reference, the DB UNIQUE key (asserted by
    // paymentHardeningSchema.test.js) fires HERE rather than at the pre-check.
    // Answer exactly like the pre-check does — 400 with the same wording —
    // instead of a generic 500, so one charge can never create a second order
    // and the client is told plainly. Every other failure stays a 500.
    const duplicateReference =
      error?.code === 'ER_DUP_ENTRY' &&
      String(error?.message || '').includes('paymentReference');
    res.status(duplicateReference ? 400 : 500).json({
      message: duplicateReference
        ? 'This payment reference has already been used'
        : 'Internal server error',
    });
  }
};

// @desc    Get all orders with pagination
// @route   GET /api/orders
// @access  Private/Admin
/** @param {AppRequest} req @param {import("express").Response} res */
export const getOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status || null;
    // Map legacy "unpaid" filter to the stored value ("pending")
    const paymentStatus = req.query.paymentStatus === 'unpaid' ? 'pending' : (req.query.paymentStatus || null);
    const search = req.query.search || null;
    const sortBy = req.query.sortBy || 'created_at';
    const sortOrder = req.query.sortOrder || 'DESC';

    const result = await Order.findAll({
      page,
      limit,
      status,
      paymentStatus,
      search,
      sortBy,
      sortOrder,
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Get single order by ID
// @route   GET /api/orders/:id
// @access  Private
/** @param {AppRequest} req @param {import("express").Response} res */
export const getOrderById = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    const order = await Order.findById(req.params.id);
    
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Security: Only allow user to see their own orders, or admin
    if (req.user.role !== 'admin' && order.userId !== req.user.id) {
      return res.status(403).json({ message: "Not authorized to view this order" });
    }

    // Attach per-vendor escrow allocations for display
    const allocations = await getOrderAllocations(req.params.id);
    order.escrowAllocations = allocations;

    // P1: parcel tracking numbers, one per vendor shipment. Numbers only —
    // vendor identities stay hidden from the customer view.
    try {
      const [trows] = await pool.execute(
        `SELECT trackingNumber FROM order_vendor_marks
         WHERE orderId = ? AND trackingNumber IS NOT NULL AND trackingNumber <> ''`,
        [req.params.id]
      );
      order.trackingNumbers = [...new Set(trows.map((/** @type {any} */ r) => r.trackingNumber))];
    } catch {
      order.trackingNumbers = [];
    }

    res.json(order);
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Get logged-in user's orders
// @route   GET /api/orders/myorders
// @access  Private
/** @param {AppRequest} req @param {import("express").Response} res */
export const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.findByUserId(req.user.id);
    res.json(orders);
  } catch (error) {
    console.error('Error fetching user orders:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Update order
// @route   PUT /api/orders/:id
// @access  Private
/** @param {AppRequest} req @param {import("express").Response} res */
export const updateOrder = async (req, res) => {
  // N-7 / V-04 bookkeeping for this request: whether we took a NEW coupon slot
  // (so a failure anywhere below can hand it back), which coupon it was, and
  // which coupon it displaced (whose slot is released only after success).
  // Declared outside the try because the catch path needs them too.
  let newCouponSlotTaken = false;
  let newCouponId = null;
  let replacedCouponId = null;
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    // Check if order exists and user has permission
    const existingOrder = await Order.findById(req.params.id);
    if (!existingOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Only admin or order owner can update
    if (req.user.role !== 'admin' && existingOrder.userId !== req.user.id) {
      return res.status(403).json({ message: "Not authorized to update this order" });
    }

    // Security: Order owners may only update non-payment, non-fulfillment fields.
    // Payment status and order status are reserved for admins (and the webhook).
    // Monetary fields (items, shippingCost, tax, discount, totalAmount) are also
    // reserved so an owner can't tamper with what they pay; only admins may adjust.
    const body = { ...req.body };
    if (req.user.role !== 'admin') {
      delete body.paymentStatus;
      delete body.orderStatus;
      delete body.paymentMethod;
      delete body.items;
      delete body.shippingCost;
      delete body.tax;
      delete body.discount;
      delete body.totalAmount;
      // Escrow is a money movement: an order owner must never be able to move
      // their own escrowReleaseDeadline into the past to trigger the 2h
      // auto-release, or assert escrowStatus themselves. Delivery confirmation
      // is the only customer-driven gate on escrow, and it is checked inside
      // confirmOrderReceived. Payment/coupon references are immutable ledger
      // facts too — an owner must not rewrite them.
      delete body.escrowStatus;
      delete body.escrowReleaseDeadline;
      delete body.couponId;
      delete body.deliveredAt;
      delete body.couponCode;

      // paymentReference is the ONE money reference an owner may still set —
      // but exactly once, while it is empty and the order is not yet paid.
      // The standard checkout creates the order BEFORE Paystack is invoked
      // (CartPage → /checkout/:orderId) and PUTs the reference back after a
      // successful charge; deleting it outright left every such order stuck
      // 'pending' forever (webhook/verify look orders up BY REFERENCE only).
      // Once set — or once the order is paid — it is immutable.
      if ('paymentReference' in body) {
        const providedRef = typeof body.paymentReference === 'string'
          ? body.paymentReference.trim().slice(0, 255)
          : '';
        const currentRef = existingOrder?.paymentReference
          ? String(existingOrder.paymentReference).trim()
          : '';
        const alreadyPaid = existingOrder?.paymentStatus === 'paid'
          || existingOrder?.paymentStatus === 'refunded';
        if (!providedRef || currentRef || alreadyPaid) {
          delete body.paymentReference;
        } else {
          const [[dup]] = await pool.execute(
            `SELECT id FROM orders WHERE paymentReference = ? AND id != ? LIMIT 1`,
            [providedRef, req.params.id]
          );
          if (dup) {
            return res.status(400).json({
              message: "This payment reference has already been used by another order",
            });
          }
          body.paymentReference = providedRef;
        }
      }
    }

    // Secure coupon application on the pre-created order path: recompute the
    // totals from the stored items + a server-validated coupon, never from the
    // client's numbers. Only reachable by the order owner (guarded above).
    // NEVER after payment: rewriting totalAmount/discount/couponId on a paid
    // order would diverge the books from what Paystack actually collected (and
    // would let a coupon be applied without its use ever being consumed).
    // N-7 / V-04 bookkeeping flags (newCouponSlotTaken / newCouponId /
    // replacedCouponId) are declared above the try so the catch path can hand
    // an unused reservation back.
    const couponCode = (req.body.couponCode || "").trim();
    if (req.user.role !== 'admin' && couponCode) {
      if (existingOrder.paymentStatus === 'paid' || existingOrder.paymentStatus === 'refunded') {
        return res.status(400).json({
          message: "A coupon can only be applied before payment",
        });
      }
      // SECURITY FIX (V-01): Freeze coupon changes once a paymentReference is
      // attached. The paymentReference indicates a charge has been initiated;
      // changing the order total after this point would diverge from what was
      // actually charged.
      if (existingOrder.paymentReference) {
        return res.status(400).json({
          message: "Cannot apply coupon after payment has been initialized",
        });
      }
      const rawItems = Array.isArray(existingOrder.items) ? existingOrder.items : [];
      const subtotal = calcSubtotal(rawItems);
      // P0-4: scope check against the STORED items. Prefer the inline vendorId
      // persisted at creation; fall back to the product row for legacy orders.
      const inlineVendorIds = rawItems.map((it) => it?.vendorId).filter((v) => v != null);
      let storedVendorIds = [...new Set(inlineVendorIds)];
      if (storedVendorIds.length === 0 && rawItems.length > 0) {
        const pids = [...new Set(rawItems.map((it) => it?.product ?? it?.productId).filter((v) => v != null))];
        if (pids.length > 0) {
          const placeholders = pids.map(() => "?").join(", ");
          const [vrows] = await pool.execute(
            `SELECT id, vendorId FROM product WHERE id IN (${placeholders})`,
            pids
          );
          storedVendorIds = [...new Set(vrows.map((/** @type {any} */ r) => r.vendorId).filter((/** @type {any} */ v) => v != null))];
        }
      }
      const couponResult = await Coupon.validate(couponCode, subtotal, { vendorIds: storedVendorIds });
      if (!couponResult.valid) {
        return res.status(400).json({ message: couponResult.message });
      }
      const c = couponResult.coupon;

      // N-7 / V-04: `validate` above is ADVISORY — it only reports that the
      // coupon looked usable a moment ago. This reservation is the authority:
      // one atomic conditional UPDATE hands us exactly ONE use or refuses when
      // the cap is spent, and it runs BEFORE the discounted total is written.
      // Idempotent when this order already holds the same coupon (re-PUT must
      // never take a second slot), so a retried apply cannot burn capacity.
      const holdsSlotAlready =
        String(existingOrder.couponId) === String(c.id) &&
        Number(existingOrder.couponUseState ?? 0) >= 1;
      if (!holdsSlotAlready) {
        const reservation = await Coupon.reserveUse(c.id);
        if (!reservation.reserved) {
          return res.status(400).json({ message: "Coupon usage limit reached" });
        }
        newCouponSlotTaken = true;
        newCouponId = c.id;
        // Replacing an earlier coupon: its slot is released only AFTER this
        // order has successfully moved to the new coupon (never before, so a
        // failure in between cannot lose a use).
        if (existingOrder.couponId && String(existingOrder.couponId) !== String(c.id)) {
          replacedCouponId = existingOrder.couponId;
        }
      }

      const discount = calcCouponDiscount(subtotal, c.discountType, c.discountValue);
      const shipping = Number(existingOrder.shippingCost ?? calcShipping(subtotal));
      const tax = Number(existingOrder.tax ?? calcTax(subtotal));
      // C2: `discount` is now capped at `subtotal` inside calcCouponDiscount,
      // but shipping and tax are read from the stored order rather than
      // recomputed here, so the floor is enforced rather than assumed. A
      // negative totalAmount would corrupt escrow allocation and make
      // Paystack's expectedKobo verification disagree with what was charged.
      body.discount = Math.min(discount, subtotal);
      body.totalAmount = Math.max(0, round2(subtotal + shipping + tax - body.discount));
      body.couponId = c.id;
      // couponUseState is set on the order row right after the update below —
      // it is never accepted from the client (not in Order.allowedFields).
    }

    // Fulfilment data integrity: flipping to 'delivered' must always record
    // WHEN. This generic path could previously set orderStatus without
    // deliveredAt, so the vendor on-time scorecard (which needs deliveredAt)
    // silently skipped the order and reported onTimeRate as null.
    if (body.orderStatus === 'delivered' && !body.deliveredAt && !existingOrder.deliveredAt) {
      body.deliveredAt = new Date();
    }

    // RB-03/RB-10: the generic update path must never resurrect a cancelled
    // or refunded order. Payment flips belong to the guarded mark-paid
    // endpoint / webhook / verify paths. Strip or reject them here.
    if (body.paymentStatus === 'paid' || body.orderStatus === 'processing') {
      const terminal = existingOrder.paymentStatus === 'refunded' || existingOrder.orderStatus === 'cancelled';
      if (terminal) {
        return res.status(400).json({
          message: 'Cannot mark a cancelled or refunded order as paid. Use the payment recovery flow.',
        });
      }
      if (body.paymentStatus === 'paid' && existingOrder.paymentStatus !== 'paid') {
        return res.status(400).json({
          message: 'Use PUT /api/orders/:id/pay to mark an order as paid.',
        });
      }
    }

    // If this throws, the outer catch hands back the reservation taken above
    // (the order still points at the old coupon, so the slot would be orphaned).
    const updatedOrder = await Order.update(req.params.id, body);

    if (newCouponSlotTaken) {
      newCouponSlotTaken = false;
      try {
        // Record the reservation on the order (0 -> 1). When a previous coupon
        // was displaced the state is already 1 and now names the new coupon —
        // the transition simply no-ops, which is exactly right.
        await Coupon.transitionOrderCoupon(req.params.id, newCouponId, 0, 1);
        if (replacedCouponId) {
          await Coupon.decrementUses(replacedCouponId);
        }
      } catch (relErr) {
        // Fail-safe direction only: a lost decrement under-counts availability,
        // a missed transition makes settlement take the slot itself. Neither can
        // ever fund an extra discounted order.
        console.warn(` Could not finalize coupon reservation: ${relErr.message}`);
      }
    }

    // P0-6: the discount just changed on a still-pending order, so the
    // pending escrow allocations (computed gross at creation) are stale.
    // Re-allocate net of the new discount. Only runs on the owner-coupon
    // path (body.discount set above while order is unpaid); held/released
    // allocations are never touched by reallocateOrderEscrow.
    if (req.user.role !== 'admin' && couponCode && body.discount !== undefined) {
      try {
        const storedItems = updatedOrder && Array.isArray(updatedOrder.items) ? updatedOrder.items : [];
        await reallocateOrderEscrow(req.params.id, storedItems, { discount: body.discount });
      } catch (reallocErr) {
        console.warn(` Coupon escrow realloc failed for order ${req.params.id}: ${reallocErr.message}`);
        try {
          const [adminUsers] = await pool.execute(`SELECT id FROM users WHERE role = 'admin' LIMIT 5`);
          for (const admin of adminUsers) {
            await Notification.create({
              userId: admin.id,
              type: 'system',
              title: 'Escrow realloc failed after coupon change',
              message: `Order #${req.params.id} discount changed but escrow re-allocation failed. Re-run allocation manually before payment.`,
              link: `/admin/orders`,
            });
          }
        } catch { /* notify is best-effort */ }
      }
    }

    res.json({ message: "Order updated successfully", order: updatedOrder });
  } catch (error) {
    console.error('Error updating order:', error);
    // N-7 / V-04: a reservation taken for a coupon that never made it onto the
    // order must not burn a redemption. Once Order.update has succeeded this
    // flag is already false, so a settled booking is never rolled back here.
    if (newCouponSlotTaken && newCouponId) {
      newCouponSlotTaken = false;
      try {
        await Coupon.decrementUses(newCouponId);
      } catch (relErr) {
        console.warn(` Could not release coupon reservation: ${relErr.message}`);
      }
    }
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Mark order as paid
// @route   PUT /api/orders/:id/pay
// @access  Private/Admin
/** @param {AppRequest} req @param {import("express").Response} res */
export const updateOrderToPaid = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    // Only admins (or the Paystack webhook) may mark an order as paid
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: "Not authorized to mark order as paid" });
    }

    const existingOrder = await Order.findById(req.params.id);
    if (!existingOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Idempotency guard: if this order is already paid, the one-time side
    // effects (escrow hold, stock decrement, coupon usage) already ran. A
    // repeated admin click must not decrement stock or consume the coupon a
    // second time.
    const alreadyPaid = existingOrder.paymentStatus === 'paid';

    // RB-03: Admin mark-paid must obey the same financial state machine.
    // It must not bypass cancellation or refund.
    if (existingOrder.paymentStatus === 'refunded' || existingOrder.orderStatus === 'cancelled') {
      return res.status(400).json({
        message: `Cannot mark order as paid: order is ${existingOrder.paymentStatus === 'refunded' ? 'refunded' : 'cancelled'}.`,
      });
    }

    if (!alreadyPaid) {
      // Atomic conditional flip: a cancel/refund racing this admin click must
      // win — affectedRows === 0 means the order moved and we must not run
      // escrow/stock/coupon side effects.
      const [flip] = await pool.execute(
        `UPDATE orders SET paymentStatus = 'paid', orderStatus = 'processing', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND paymentStatus != 'paid' AND orderStatus NOT IN ('cancelled', 'refunded')`,
        [req.params.id]
      );
      if (flip.affectedRows === 0) {
        const [[current]] = await pool.execute(
          `SELECT paymentStatus, orderStatus FROM orders WHERE id = ?`,
          [req.params.id]
        );
        if (current && (current.paymentStatus === 'refunded' || current.orderStatus === 'cancelled')) {
          return res.status(400).json({
            message: `Cannot mark order as paid: order is ${current.paymentStatus === 'refunded' ? 'refunded' : 'cancelled'}.`,
          });
        }
        // Lost the race to a concurrent webhook/verify that just paid the
        // order. Side effects (escrow hold, stock decrement, coupon consume,
        // receipt email) already ran there — running them again here would
        // double-decrement stock and double-consume the coupon. Re-read and
        // treat as idempotent with NO side effects.
        const fresh = await Order.findById(req.params.id);
        if (fresh?.paymentStatus === 'paid') {
          await auditFromRequest(req, {
            action: 'order.markPaid',
            entityType: 'order',
            entityId: req.params.id,
            before: { paymentStatus: existingOrder.paymentStatus },
            after: { paymentStatus: fresh?.paymentStatus, orderStatus: fresh?.orderStatus, note: 'race-lost-to-webhook' },
          });
          return res.json({ message: 'Order was already paid', order: fresh, escrowHeld: 0 });
        }
        // Row vanished or is in an unexpected state — do not run side effects.
        return res.status(409).json({ message: 'Order changed concurrently; please refresh and retry.' });
      }
    }

    // For customised orders, seed the expected completion date (order start +
    // longest productionTime among customisable items) so the buyer sees how
    // many days are left to finish weaving. Only set if not already provided.
    const paidOrder = alreadyPaid ? existingOrder : await Order.findById(req.params.id);
    if (!paidOrder || !paidOrder.expectedCompletionDate) {
      const completion = computeExpectedCompletion(paidOrder);
      if (completion) {
        await Order.update(req.params.id, {
          expectedCompletionDate: completion,
        });
      }
    }

    // Hold escrow allocations for the order so vendors can be paid out
    const heldCount = await holdEscrowForOrder(req.params.id);

    // Decrement in-stock inventory now that the sale is confirmed — once only.
    if (!alreadyPaid) {
      const paidOrderForStock = await Order.findById(req.params.id);
      let paidItems = paidOrderForStock?.items;
      if (typeof paidItems === 'string') {
        try { paidItems = JSON.parse(paidItems); } catch { paidItems = []; }
      }
      if (Array.isArray(paidItems) && paidItems.length > 0) {
        await decrementStockForOrder(paidItems, req.params.id);
      }

      // Consume deferred coupon usage on admin-confirmed payment (P0-5:
      // race losers are journaled + flagged, not silently over-funded).
      const freshOrder = await Order.findById(req.params.id);
      if (freshOrder?.couponId) {
        try {
          await consumeCouponForOrder(freshOrder.couponId, req.params.id);
        } catch (e) {
 console.warn(` Could not increment coupon usage: ${e.message}`);
        }
      }

      // Receipt email — only when this call actually flipped the order to
      // paid. Detached (N-20 class): the paid flip is committed, and the
      // audit write + response below must never wait on SMTP.
      void sendOrderConfirmationEmail(req.params.id).catch((emailErr) => {
        console.warn(` Could not send order confirmation email: ${emailErr.message}`);
      });
    }

    const order = await Order.findById(req.params.id);
    await auditFromRequest(req, {
      action: 'order.markPaid',
      entityType: 'order',
      entityId: req.params.id,
      before: { paymentStatus: existingOrder.paymentStatus },
      after: { paymentStatus: order?.paymentStatus, orderStatus: order?.orderStatus },
    });
    res.json({
      message: alreadyPaid ? "Order was already paid" : "Order marked as paid",
      order,
      escrowHeld: heldCount,
    });
  } catch (error) {
    console.error('Error marking order as paid:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Mark order as delivered
// @route   PUT /api/orders/:id/deliver
// @access  Private/Admin
/** @param {AppRequest} req @param {import("express").Response} res */
export const updateOrderToDelivered = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    // Guard: only orders in 'processing' or 'shipped' state may be delivered
    const existingOrder = await Order.findById(req.params.id);
    if (!existingOrder) {
      return res.status(404).json({ message: "Order not found" });
    }
    const deliverableStates = ['processing', 'shipped'];
    if (!deliverableStates.includes(existingOrder.orderStatus)) {
      return res.status(400).json({
        message: `Cannot mark order as delivered from '${existingOrder.orderStatus}' status. Order must be ${deliverableStates.join(' or ')}.`,
      });
    }

    const updatedOrder = /** @type {import('../models/orderModel.js').default & { escrowReleaseDays?: number }} */ (
      // Row was just updated; non-null.
      await Order.update(req.params.id, {
        orderStatus: "delivered",
        deliveredAt: new Date(),
      })
    );

    // P0-2: Create/update per-vendor fulfillment records and set escrow deadlines
    // This allows each vendor's escrow to be released independently when they deliver
    const { 
      setVendorEscrowReleaseDeadline,
    } = await import('../Services/escrowService.js');

    // Get all vendor allocations for this order
    const allocations = await getOrderAllocations(req.params.id);
    const vendorIds = [...new Set(allocations.map(a => a.vendorId))];

    for (const vendorId of vendorIds) {
      // Upsert vendor_order_fulfillment record
      await pool.execute(
        `INSERT INTO vendor_order_fulfillment (orderId, vendorId, status, deliveredAt, escrowReleaseDeadline, created_at)
         VALUES (?, ?, 'delivered', NOW(), DATE_ADD(NOW(), INTERVAL ? DAY), NOW())
         ON DUPLICATE KEY UPDATE 
           status = 'delivered',
           deliveredAt = NOW(),
           escrowReleaseDeadline = DATE_ADD(NOW(), INTERVAL ? DAY),
           updated_at = CURRENT_TIMESTAMP`,
        [req.params.id, vendorId, ESCROW_RELEASE_DAYS, ESCROW_RELEASE_DAYS]
      );

      // If escrow is held for this vendor, set their individual deadline
      const vendorAlloc = allocations.find(a => a.vendorId == vendorId && a.status === 'held');
      if (vendorAlloc) {
        await setVendorEscrowReleaseDeadline(req.params.id, vendorId);
      }
    }

    // Escrow orders get an auto-release deadline: if the customer does not
    // confirm receipt within the window, funds are released automatically.
    // Handle the race where escrow is not yet held (webhook delayed):
    // attempt to hold escrow first, then set the deadline.
    if (updatedOrder.escrowStatus === 'held') {
      const days = await setEscrowReleaseDeadline(req.params.id);
      updatedOrder.escrowReleaseDeadline = await Order.findById(req.params.id)
        .then((o) => o?.escrowReleaseDeadline);
      updatedOrder.escrowReleaseDays = days;
    } else if (updatedOrder.escrowStatus === 'none') {
      // Webhook may not have fired yet — try to hold escrow now
      const heldCount = await holdEscrowForOrder(req.params.id);
      if (heldCount > 0) {
        const days = await setEscrowReleaseDeadline(req.params.id);
        updatedOrder.escrowReleaseDeadline = await Order.findById(req.params.id)
          .then((o) => o?.escrowReleaseDeadline);
        updatedOrder.escrowReleaseDays = days;
        updatedOrder.escrowStatus = 'held';
      }
    }

    res.json({ message: "Order marked as delivered", order: updatedOrder });

    // Auto-issue an authenticity certificate for every paid product once
    // delivery is confirmed (idempotent — custom order certs were already
    // issued at payment).
    try {
      const { issueCertificateForOrder } = await import('../Services/certificateService.js');
      await issueCertificateForOrder(updatedOrder.id);
    } catch (certErr) {
 console.warn(` Delivery cert auto-issue skipped: ${certErr.message}`);
    }
  } catch (error) {
    console.error('Error marking order as delivered:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Customer confirms delivery received → release escrow to vendors
// @route   POST /api/orders/:id/confirm-received
// @access  Private (order owner or admin)
/** @param {AppRequest} req @param {import("express").Response} res */
export const confirmOrderReceived = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (req.user.role !== 'admin' && order.userId !== req.user.id) {
      return res.status(403).json({ message: "Not authorized to confirm this order" });
    }

    // P0-2: Support per-vendor confirmation via optional vendorId query param
    // If vendorId provided, release only that vendor's escrow; otherwise release all
    const vendorId = req.query.vendorId ? parseInt(req.query.vendorId, 10) : null;

    let result;
    if (vendorId) {
      // Per-vendor confirmation: check this vendor's fulfillment status
      const [vof] = await pool.execute(
        `SELECT status FROM vendor_order_fulfillment WHERE orderId = ? AND vendorId = ?`,
        [req.params.id, vendorId]
      );
      if (vof.length === 0 || vof[0].status !== 'delivered') {
        return res.status(400).json({ 
          message: "This vendor's fulfillment is not yet marked as delivered" 
        });
      }
      const { releaseVendorEscrow } = await import('../Services/escrowService.js');
      result = await releaseVendorEscrow(req.params.id, vendorId);
    } else {
      // Global confirmation (all vendors) - existing behavior
      if (order.escrowStatus !== 'held') {
        return res.status(400).json({
          message:
            order.escrowStatus === 'released'
              ? "Escrow for this order has already been released"
              : order.escrowStatus === 'none'
              ? "This order is not held in escrow"
              : `Cannot confirm receipt while escrow status is '${order.escrowStatus}'`,
        });
      }

      if (order.orderStatus !== 'delivered') {
        return res.status(400).json({
          message: "Order must be marked as delivered before receipt can be confirmed",
        });
      }

      result = await releaseEscrowForOrder(req.params.id);
    }

    const updatedOrder = await Order.findById(req.params.id);

    // Escrow-release confirmation email — once, when allocations actually moved.
    // Detached (N-20 class): the release is committed; SMTP must not
    // sequence the completion write or the response below.
    if (result.released > 0 || result.available > 0) {
      void sendEscrowReleasedEmail(req.params.id).catch((emailErr) => {
        console.warn(` Could not send escrow released email: ${emailErr.message}`);
      });
    }

    // Mark any custom kente request tied to this order as completed — the
    // buyer has confirmed receipt and the weaver is paid.
    try {
      await pool.execute(
        `UPDATE custom_requests SET status = 'completed'
         WHERE orderId = ? AND status IN ('paid', 'in_progress')`,
        [parseInt(req.params.id)]
      );
    } catch {
      /* non-fatal */ }

    const failed = result.failed > 0;
    res.status(200).json({
      message: failed
        ? "Receipt confirmed. Some vendor payouts failed — admin retry may be needed."
        : "Receipt confirmed. Funds released to vendors.",
      escrowStatus: updatedOrder?.escrowStatus,
      result,
    });

    // Issue an authenticity certificate on receipt confirmation (the "gift
    // buyers love the QR" use-case). Non-fatal: certs already exist for
    // custom orders issued at payment.
    try {
      const { issueCertificateForOrder } = await import('../Services/certificateService.js');
      await issueCertificateForOrder(req.params.id);
    } catch (certErr) {
 console.warn(` Receipt cert auto-issue skipped: ${certErr.message}`);
    }
  } catch (error) {
    console.error('Error confirming order received:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};


// @desc    Cancel order and void escrow
// @route   PUT /api/orders/:id/cancel
// @access  Private/Admin
/** @param {AppRequest} req @param {import("express").Response} res */
export const cancelOrder = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const cancellableStatuses = ['pending', 'processing'];
    if (!cancellableStatuses.includes(order.orderStatus)) {
      return res.status(400).json({
        message: `Cannot cancel order in '${order.orderStatus}' status. Order must be pending or processing.`,
      });
    }

    // Money integrity: never mark a paid order 'refunded' without actually
    // refunding the customer via Paystack. If payment succeeded, push a real
    // refund through Paystack first and only flip paymentStatus after it is
    // accepted. If the refund fails, the order is left untouched so the money
    // cannot silently disappear from the platform's books.
    if (order.paymentStatus === 'paid') {
      // SECURITY FIX (V-07): Atomic claim with shared dedupeKey `refund:${orderId}`.
      // Only the winner of this CAS proceeds to call Paystack. The order-level
      // refundReference is used as the claim marker. This prevents both the
      // return path and the cancel path from refunding the same order.
      // V-07b: the brackets are load-bearing, and were missing until a
      // FUNCTIONAL test looked for them rather than at them. pool.execute
      // resolves to `[rows, fields]`, so `claimResult` without brackets is the
      // ARRAY — `.affectedRows` on it is `undefined`, `undefined === 0` is
      // false, and this guard declined to refuse anything while the source
      // still read exactly as intended: the claim was written, the comparison
      // was present, a regex over the file counted both and called V-07 fixed.
      const [claimResult] = await pool.execute(
        `UPDATE orders SET refundReference = ? WHERE id = ? AND refundReference IS NULL`,
        [`refund:${order.id}:cancel:${order.paymentReference}`, req.params.id]
      );
      if (claimResult.affectedRows === 0) {
        return res.status(409).json({ message: 'Refund already claimed or in progress for this order' });
      }
      try {
        const refund = await paystackServices.refundTransaction(
          order.paymentReference,
          undefined,
          `Order ${req.params.id} cancelled`
        );
        if (!refund?.status) {
          await pool.execute(`UPDATE orders SET refundReference = NULL WHERE id = ?`, [req.params.id])
            .catch(() => {});
          return res.status(400).json({
            message: `Refund failed (${refund?.message || 'unknown reason'}). Order was not cancelled. Please refund the customer manually.`,
          });
        }
        // Immutable journal entry for the refund (idempotent per order).
        try {
          await recordFinancialEvent({
            eventType: 'refund',
            direction: 'out',
            amount: parseFloat(order.totalAmount) || 0,
            orderId: order.id,
            reference: order.paymentReference,
            providerReference: refund?.data?.failure_reference || order.paymentReference,
            dedupeKey: `refund:${order.id}`,
            payload: { reason: `Order ${req.params.id} cancelled` },
          });
        } catch { /* journal is best-effort */ }
      } catch (refundError) {
        return res.status(500).json({
          message: `Refund could not be initiated (${refundError.message}). Order was not cancelled.`,
        });
      }
    }

    const wasPaid = order.paymentStatus === 'paid';
    
    // RB-04: Use conditional update to detect if sweeper already cancelled this order.
    // Only update status if it's still 'pending' or 'processing'. If affectedRows === 0,
    // another process (sweeper or concurrent cancel) already cancelled it.
    const [statusUpdate] = await pool.execute(
      `UPDATE orders 
       SET orderStatus = 'cancelled', 
           paymentStatus = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND orderStatus IN ('pending', 'processing')`,
      [wasPaid ? 'refunded' : order.paymentStatus, req.params.id]
    );
    const statusChanged = statusUpdate.affectedRows > 0;
        
    if (!statusChanged) {
      // Lost the race: another process (sweeper or concurrent cancel) already
      // cancelled this order and already ran stock restore + escrow void.
      // Running coupon release or a second restore/void here would double-count.
      const current = await Order.findById(req.params.id);
      return res.json({ message: 'Order cancelled', order: current });
    }

    // P0-6: a use was consumed at payment; the refund frees it again. Only for
    // orders that were actually paid (pending orders never consumed a use).
    if (wasPaid && order.couponId) {
      try {
        await Coupon.decrementUses(order.couponId);
      } catch (couponErr) {
 console.warn(` Could not release coupon use for cancelled order ${req.params.id}: ${couponErr.message}`);
      }
    } else if (!wasPaid && order.couponId) {
      // N-7 / V-04: this order holds a RESERVED use taken at booking (not a
      // settled one — state 2 only ever exists on a paid order). Give it back
      // so an abandoned checkout cannot permanently burn a redemption. The
      // 1 -> 0 CAS inside releaseForOrder is the ownership test, so the
      // expiry sweeper cancelling the same order concurrently can never
      // release the same slot twice.
      try {
        await Coupon.releaseForOrder(order.id, order.couponId);
      } catch (couponErr) {
 console.warn(` Could not release coupon reservation for order ${req.params.id}: ${couponErr.message}`);
      }
    }

    // Restore in-stock inventory for a cancelled order. This covers BOTH:
    // - paid orders (their stock was decremented at payment), and
    // - pending orders that still hold a reservation (units were taken off
    //   `stock` at order creation and must go back now that the checkout is
    //   abandoned).
    // Products that were short at payment time (stock conflicts) were never
    // taken, so they are skipped to avoid inflating stock. Made-to-order items
    // are never restored.
    //
    // RB-04: Only restore stock if THIS cancellation actually changed the order
    // status (statusChanged === true). If statusChanged is false, the sweeper
    // already cancelled the order and restored the stock (and zeroed reserved markers).
    if (statusChanged) {
      // Re-fetch items to get current reserved markers
      const [[freshOrder]] = await pool.execute(
        `SELECT items FROM orders WHERE id = ?`,
        [req.params.id]
      );
      const freshItems = freshOrder?.items
        ? (typeof freshOrder.items === 'string' ? JSON.parse(freshOrder.items) : freshOrder.items)
        : (Array.isArray(order.items) ? order.items : []);
      const reservedTotal = freshItems.reduce(
        (/** @type {any} */ sum, /** @type {any} */ it) => sum + (parseInt(it?.reserved, 10) || 0),
        0
      );
      
      // For paid orders, always restore (stock was decremented at payment, not reserved).
      // For pending orders, only restore if reserved markers are still > 0
      // (meaning sweeper hasn't already released them).
      const shouldRestore = wasPaid || reservedTotal > 0;
            if (shouldRestore) {
        try {
          const skipProductIds = new Set();
          const storedConflicts = order.stockConflicts;
          const conflicts = Array.isArray(storedConflicts)
            ? storedConflicts
            : typeof storedConflicts === 'string'
            ? (() => { try { return JSON.parse(/** @type {string} */ (storedConflicts)); } catch { return []; } })()
            : [];
          for (const c of conflicts) {
            if (c?.productId) skipProductIds.add(c.productId);
          }
                    await restoreStockForOrder(freshItems, { skipProductIds, orderId: req.params.id });
          await pool.execute(
            `UPDATE orders SET stockShortfall = 0, stockConflicts = NULL WHERE id = ?`,
            [req.params.id]
          );
        } catch (restoreErr) {
 console.warn(` Could not restore stock for cancelled order ${req.params.id}: ${restoreErr.message}`);
        }
      }
    }
    // If statusChanged is false, the sweeper already cancelled the order and
    // restored the stock (and zeroed reserved markers). We skip restoration
    // to avoid double-counting.


    // Void any held escrow allocations so funds return to the platform
    if (order.escrowStatus === 'held' || order.escrowStatus === 'none') {
      await cancelEscrowForOrder(req.params.id);
    }

    const updatedOrder = await Order.findById(req.params.id);
    await auditFromRequest(req, {
      action: `order.cancel`,
      entityType: 'order',
      entityId: req.params.id,
      before: { orderStatus: order.orderStatus, paymentStatus: order.paymentStatus },
      after: { orderStatus: updatedOrder?.orderStatus, paymentStatus: updatedOrder?.paymentStatus },
    });
    res.json({ message: "Order cancelled", order: updatedOrder });
  } catch (error) {
    console.error('Error cancelling order:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Retry failed escrow payouts for an order
// @route   POST /api/orders/:id/retry-escrow
// @access  Private/Admin
/** @param {AppRequest} req @param {import("express").Response} res */
export const retryEscrowPayouts = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // RB-02: Do not allow retry for refunded/voided/cancelled orders
    if (order.paymentStatus === 'refunded' || order.orderStatus === 'cancelled') {
      return res.status(400).json({
        message: `Cannot retry escrow for a ${order.paymentStatus === 'refunded' ? 'refunded' : 'cancelled'} order.`,
      });
    }

    if (!['failed', 'releasing'].includes(order.escrowStatus)) {
      return res.status(400).json({
        message: `Order escrow status is '${order.escrowStatus}'. Only orders with failed or in-flight payouts can be retried.`,
      });
    }

    const result = await retryFailedAllocations(req.params.id);
    const updatedOrder = await Order.findById(req.params.id);

    await auditFromRequest(req, {
      action: 'payout.retry',
      entityType: 'order',
      entityId: req.params.id,
      before: { escrowStatus: order.escrowStatus },
      after: { escrowStatus: updatedOrder?.escrowStatus, retried: result.retried, failed: result.failed, skipped: result.skipped },
    });

    let message = `Retry complete: ${result.retried} payouts initiated, ${result.failed} failed.`;
    if (result.skipped > 0) {
      message += ` ${result.skipped} skipped (order refunded/voided).`;
    }

    res.status(200).json({
      message,
      result,
      escrowStatus: updatedOrder?.escrowStatus,
    });
  } catch (error) {
    console.error('Error retrying escrow payouts:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Get top product TYPES (categories) from orders — the "which kente
//          styles are selling a lot" signal for admin predictions.
// @route   GET /api/orders/top-product-types
// @access  Private/Admin
/** @param {AppRequest} req @param {import("express").Response} res */
export const getTopProductTypes = async (req, res) => {
  try {
    const { limit = 8 } = req.query;
    const insights = await computeTopProductTypes(parseInt(limit) || 8);
    res.json(insights);
  } catch (error) {
    console.error('Error fetching top product types:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Delete order
// @route   DELETE /api/orders/:id
// @access  Private/Admin
/** @param {AppRequest} req @param {import("express").Response} res */
export const deleteOrder = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    await Order.delete(req.params.id);
    res.json({ message: "Order deleted successfully" });
  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// ============================================
// ANALYTICS FUNCTIONS (Enhanced)
// ============================================

// @desc    Get order statistics
// @route   GET /api/orders/statistics
// @access  Private/Admin
/** @param {AppRequest} req @param {import("express").Response} res */
export const getOrderStatistics = async (req, res) => {
  try {
    const stats = await Order.getStatistics();
    
    // Calculate additional metrics
    const totalRevenue = parseFloat(stats.totalRevenue) || 0;
    const totalOrders = parseInt(stats.totalOrders) || 0;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    
    // Calculate conversion rate
    const deliveredOrders = parseInt(stats.deliveredOrders) || 0;
    const conversionRate = totalOrders > 0 ? (deliveredOrders / totalOrders) * 100 : 0;

    const response = {
      totalOrders,
      totalRevenue,
      avgOrderValue: parseFloat(avgOrderValue.toFixed(2)),
      conversionRate: parseFloat(conversionRate.toFixed(2)),
      pendingOrders: parseInt(stats.pendingOrders) || 0,
      processingOrders: parseInt(stats.processingOrders) || 0,
      deliveredOrders,
      cancelledOrders: parseInt(stats.cancelledOrders) || 0,
      paidOrders: parseInt(stats.paidOrders) || 0,
      unpaidOrders: parseInt(stats.unpaidOrders) || 0,
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Get sales analytics by date range
// @route   GET /api/orders/analytics
// @access  Private/Admin
/** @param {AppRequest} req @param {import("express").Response} res */
export const getSalesAnalytics = async (req, res) => {
  let connection;
  try {
    const { startDate, endDate, groupBy = 'month' } = req.query;
    
    connection = await pool.getConnection();
    
    let dateFormat;
    switch(groupBy) {
      case 'day':
        dateFormat = '%Y-%m-%d';
        break;
      case 'week':
        dateFormat = '%Y-%u';
        break;
      case 'month':
      default:
        dateFormat = '%Y-%m';
        break;
    }

    let query = `
      SELECT 
        DATE_FORMAT(created_at, ?) as period,
        COUNT(*) as orderCount,
        SUM(totalAmount) as revenue,
        AVG(totalAmount) as avgOrderValue
      FROM orders
      WHERE 1=1
    `;

    const params = [dateFormat];

    if (startDate) {
      query += ' AND created_at >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND created_at <= ?';
      params.push(endDate);
    }

    query += ' GROUP BY period ORDER BY period ASC';

    const [results] = await connection.execute(query, params);

    res.json(results);
  } catch (error) {
    console.error('Error fetching sales analytics:', error);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

// @desc    Get top selling products from orders
// @route   GET /api/orders/top-products
// @access  Private/Admin
/** @param {AppRequest} req @param {import("express").Response} res */
export const getTopProducts = async (req, res) => {
  let connection;
  try {
    const { limit = 10 } = req.query;
    
    connection = await pool.getConnection();
    
    const [orders] = await connection.execute(`
      SELECT id, items
      FROM orders
      WHERE orderStatus != 'cancelled'
      ORDER BY created_at DESC
      LIMIT 1000
    `);

    // Aggregate product sales
    const productSales = /** @type {Record<string, { productId: any, name: any, quantity: number, revenue: number }>} */ ({});

    (/** @type {Array<any>} */ (orders)).forEach(order => {
      try {
        // JSON columns come back already parsed (or as a raw string on some
        // drivers) — accept both, like Order.safeParse does.
        let items = order.items;
        if (typeof items === 'string') items = JSON.parse(items);
        if (!Array.isArray(items)) return;
        items.forEach(item => {
          // Standard lines: key by product id (name only as a last resort).
          // Custom lines reference their base product too, so keying them by
          // `product` would merge one-off custom orders into the base
          // product's row and relabel it with whichever line arrived first —
          // group those by their own title instead.
          const isCustom = item.customRequestId != null;
          const key = isCustom
            ? `custom:${item.name || item.title}`
            : (item.product ?? item.productId ?? item.id ?? item.name);
          if (!productSales[key]) {
            productSales[key] = {
              productId: key,
              name: item.name || item.title || 'Unknown Product',
              quantity: 0,
              revenue: 0
            };
          }
          // Standard lines store `qty`, custom lines store `quantity`.
          const qty = parseInt(item.quantity ?? item.qty, 10) || 1;
          productSales[key].quantity += qty;
          productSales[key].revenue += (item.price || 0) * qty;
        });
      } catch (e) {
        console.error('Error parsing order items:', e);
      }
    });

    // Sort by revenue and limit
    const topProducts = Object.values(productSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, parseInt(limit));

    res.json(topProducts);
  } catch (error) {
    console.error('Error fetching top products:', error);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};