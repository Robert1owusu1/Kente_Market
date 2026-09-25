// @ts-check
// FILE LOCATION: backend/Services/fulfilmentService.js
// DESCRIPTION: Fulfilment scorecard — how often a weaver delivers on time.
//              "On time" = deliveredAt <= expectedCompletionDate for orders
//              that carried a promised completion date (standard AND custom).
import pool from '../config/db.js';

/** @param {unknown} v @returns {any[]} */
const safeParse = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { return JSON.parse(/** @type {string} */ (v)); } catch { return []; }
};

/**
 * Compute a vendor's on-time delivery scorecard from completed orders.
 * Only orders the vendor actually fulfilled (items owned by them) count.
 * @param {number | string} vendorId - vendor *user* id (matches product.vendorId)
 * @returns {Promise<{ fulfilled: number, withDeadline: number, onTime: number, onTimeRate: number, avgDaysEarly: number }>}
 */
export const getVendorFulfilment = async (vendorId) => {
  const vid = Number(vendorId);
  const scorecard = { fulfilled: 0, withDeadline: 0, onTime: 0, onTimeRate: 0, avgDaysEarly: 0 };

  // Ownership: items may carry an inline vendorId, but rows written before
  // that field existed don't — fall back to the product's vendorId (same
  // rule the orders list and analytics use), otherwise delivered orders
  // predating the inline field vanish from the scorecard.
  const [ownedProducts] = await pool.execute(
    `SELECT id FROM product WHERE vendorId = ?`, [vid]
  );
  const ownedProductIds = new Set(ownedProducts.map((p) => String(p.id)));

  const [orders] = await pool.execute(
    `SELECT id, items, expectedCompletionDate, deliveredAt, orderStatus
     FROM orders
     WHERE orderStatus = 'delivered'
     ORDER BY deliveredAt DESC
     LIMIT 2000`
  );

  let dayDiffSum = 0;
  let diffCount = 0;
  for (const order of orders) {
    const items = safeParse(order.items);
    const owned = items.some((it) => {
      if (it.vendorId != null && parseInt(it.vendorId, 10) === vid) return true;
      return ownedProductIds.has(String(it.product ?? it.productId ?? it.id));
    });
    if (!owned) continue;
    scorecard.fulfilled += 1;

    const deadline = order.expectedCompletionDate ? new Date(order.expectedCompletionDate) : null;
    const delivered = order.deliveredAt ? new Date(order.deliveredAt) : null;
    if (!deadline || !delivered) continue;

    scorecard.withDeadline += 1;
    if (delivered <= deadline) {
      scorecard.onTime += 1;
    }
    dayDiffSum += (delivered.getTime() - deadline.getTime()) / 86400000;
    diffCount += 1;
  }

  if (scorecard.withDeadline > 0) {
    scorecard.onTimeRate = parseFloat(((scorecard.onTime / scorecard.withDeadline) * 100).toFixed(1));
  }
  if (diffCount > 0) {
    scorecard.avgDaysEarly = parseFloat((dayDiffSum / diffCount).toFixed(1));
  }
  return scorecard;
};