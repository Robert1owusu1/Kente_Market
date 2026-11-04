// @ts-check
// FILE LOCATION: backend/Services/groupBuyService.js
// DESCRIPTION: Group-buy campaigns (follow-up). Buyers pledge by pre-ordering
//   (pay now, escrow held). At the deadline a sweep evaluates the committed
//   quantity: target met → campaign succeeds (orders proceed to fulfilment);
//   target missed → PURE single-product pledge orders are auto-refunded using
//   the same audited primitives the cancel flow uses. Mixed-cart orders are
//   flagged to admins (never auto-refunded whole).
import pool from '../config/db.js';
import paystack from './paystackservices.js';
import { recordFinancialEvent } from './ledgerService.js';
import { buildRefundClaim } from '../utils/refundClaim.js';
import { reversePlatformRevenueForRefund, cancelEscrowForOrder } from './escrowService.js';
import { returnStoreCreditForOrder } from './giftCardService.js';
import { notifyAdmins } from '../utils/adminAlerts.js';

/** Committed (paid, not cancelled/refunded) units for a product. @param {number} productId */
export const getGroupBuyCommitted = async (productId) => {
  const [[row]] = /** @type {any} */ (await pool.execute(
    `SELECT COALESCE(SUM(oi.qty), 0) AS units
       FROM order_items oi JOIN orders o ON o.id = oi.orderId
      WHERE oi.productId = ? AND o.paymentStatus = 'paid' AND o.orderStatus <> 'cancelled'`,
    [productId]
  ));
  return Number(row.units) || 0;
};

/** Public campaign status for a product (null when not a group buy).
 * @param {any} product */
export const getGroupBuyStatus = async (product) => {
  if (!product || !(Number(product.groupBuyTarget) > 0) || !product.groupBuyDeadline) return null;
  const committed = await getGroupBuyCommitted(product.id);
  const target = Number(product.groupBuyTarget);
  const deadline = product.groupBuyDeadline;
  return {
    target, committed, deadline,
    remaining: Math.max(0, target - committed),
    status: product.groupBuyStatus || 'pending',
    reached: committed >= target,
    deadlinePassed: new Date(deadline) < new Date(),
  };
};

/**
 * Auto-refund a paid order (group-buy failure). Mirrors the audited cancel
 * refund: claim → Paystack refund → journal → flip refunded → reverse platform
 * revenue → void escrow → return store credit. Idempotent via the refund claim.
 * @param {number} orderId
 */
export const autoRefundOrder = async (orderId, reason = 'group_buy_failed') => {
  const [[order]] = /** @type {any} */ (await pool.execute(
    `SELECT id, totalAmount, paymentStatus, orderStatus, paymentReference, paymentMethod FROM orders WHERE id = ?`, [orderId]
  ));
  if (!order || order.paymentStatus !== 'paid') return false;
  if (order.paymentMethod === 'referral_credit') return false; // final, never refunded
  if (!order.paymentReference) return false; // store-credit-only orders handled by returnStoreCredit + manual review

  // Atomic claim (shared dedupe with cancel/return paths).
  const [claim] = /** @type {any} */ (await pool.execute(
    `UPDATE orders SET refundReference = ? WHERE id = ? AND refundReference IS NULL`,
    [buildRefundClaim(order.id, 'groupbuy', order.paymentReference), orderId]
  ));
  if (claim.affectedRows === 0) return false; // already being refunded

  let refund;
  try {
    refund = await paystack.refundTransaction(order.paymentReference, undefined, `Group-buy did not reach its target — order ${orderId}`);
  } catch (err) {
    await pool.execute(`UPDATE orders SET refundReference = NULL WHERE id = ?`, [orderId]).catch(() => {});
    console.error(` group-buy refund error for order ${orderId}: ${err.message}`);
    return false;
  }
  if (!refund?.status) {
    await pool.execute(`UPDATE orders SET refundReference = NULL WHERE id = ?`, [orderId]).catch(() => {});
    return false;
  }
  try {
    await recordFinancialEvent({
      eventType: 'refund', direction: 'out', amount: parseFloat(order.totalAmount) || 0,
      orderId: order.id, reference: order.paymentReference,
      providerReference: refund?.data?.failure_reference || order.paymentReference,
      dedupeKey: `refund:${order.id}`, payload: { reason },
    });
  } catch { /* journal best-effort */ }

  const [flip] = /** @type {any} */ (await pool.execute(
    `UPDATE orders SET orderStatus = 'cancelled', paymentStatus = 'refunded', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND orderStatus IN ('pending','processing') AND paymentStatus = 'paid'`, [orderId]
  ));
  if (flip.affectedRows > 0) {
    await reversePlatformRevenueForRefund(orderId, 'group_buy').catch(() => {});
    await cancelEscrowForOrder(orderId).catch(() => {});
    await returnStoreCreditForOrder(orderId).catch(() => {});
  }
  return true;
};

/** Pure single-product pledge orders for a product (safe to auto-refund).
 * @param {number} productId */
const pledgeOrdersFor = async (productId) => {
  const [rows] = /** @type {any} */ (await pool.execute(
    `SELECT DISTINCT o.id FROM orders o JOIN order_items oi ON oi.orderId = o.id
      WHERE oi.productId = ? AND o.paymentStatus = 'paid' AND o.orderStatus IN ('processing','pending')
        AND NOT EXISTS (SELECT 1 FROM order_items oi2 WHERE oi2.orderId = o.id AND oi2.productId <> ?)`,
    [productId, productId]
  ));
  return rows.map((/** @type {any} */ r) => r.id);
};

/**
 * Deadline sweep: resolve pending group-buy campaigns past their deadline.
 */
export const evaluateGroupBuyCampaigns = async ({ limit = 50 } = {}) => {
  const [products] = /** @type {any} */ (await pool.execute(
    `SELECT id, title, groupBuyTarget, groupBuyDeadline FROM product
      WHERE groupBuyStatus = 'pending' AND groupBuyTarget > 0 AND groupBuyDeadline IS NOT NULL
        AND groupBuyDeadline < CURDATE() LIMIT ?`, [limit]
  ));
  let succeeded = 0, failed = 0, refunded = 0;
  for (const p of products) {
    const committed = await getGroupBuyCommitted(p.id);
    if (committed >= Number(p.groupBuyTarget)) {
      await pool.execute(`UPDATE product SET groupBuyStatus = 'succeeded' WHERE id = ?`, [p.id]);
      succeeded++;
    } else {
      await pool.execute(`UPDATE product SET groupBuyStatus = 'failed' WHERE id = ?`, [p.id]);
      failed++;
      const orderIds = await pledgeOrdersFor(p.id);
      for (const oid of orderIds) { if (await autoRefundOrder(oid)) refunded++; }
      await notifyAdmins(
        'Group-buy campaign failed — pledges refunded',
        `"${p.title}" reached ${committed}/${p.groupBuyTarget} units by its deadline. ` +
        `${orderIds.length} single-product pledge order(s) were auto-refunded. ` +
        `Review any MIXED-cart orders containing this product for manual refund.`,
        { link: '/admin/orders' }
      ).catch(() => {});
    }
  }
  return { evaluated: products.length, succeeded, failed, refunded };
};
