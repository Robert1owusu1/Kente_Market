// @ts-check
// FILE LOCATION: backend/Services/wishlistPriceDropService.js
// DESCRIPTION: Price-drop alerts. Each wishlist row snapshots the product price
//              it was saved at (lastAlertedPrice). When the live price drops
//              below that baseline we alert the buyer once (lastPriceDropNotifiedAt
//              debounce) and re-baseline to the new price, so a further drop
//              can trigger a fresh alert. Mirrors the restock service pattern:
//              fast path on product updates + hourly safety-net sweep.
import pool from '../config/db.js';
import Notification from '../models/notificationModel.js';
import { sendEmailSafely } from '../utils/emailService.js';

/**
 * Notify every wishlisted user for one product whose price has dropped below
 * the price it was saved at. Idempotent per (user, product, price level).
 * @param {number | string} productId
 * @returns {Promise<number>} number of users notified
 */
export const processPriceDropsForProduct = async (productId) => {
  const pid = Number(productId);
  if (!pid || Number.isNaN(pid)) return 0;

  const [[product]] = await pool.execute(
    `SELECT id, title, img, price, approvalStatus FROM product WHERE id = ?`,
    [pid]
  );
  if (!product || product.approvalStatus !== 'approved') return 0;
  const livePrice = parseFloat(product.price) || 0;
  if (livePrice <= 0) return 0;

  const [wishlistRows] = await pool.execute(
    `SELECT w.userId, w.lastAlertedPrice, u.email
     FROM wishlist w
     LEFT JOIN users u ON u.id = w.userId
     WHERE w.productId = ?
       AND w.lastAlertedPrice IS NOT NULL
       AND w.lastAlertedPrice > ?
       AND w.lastPriceDropNotifiedAt IS NULL`,
    [pid, livePrice]
  );
  if (wishlistRows.length === 0) return 0;

  let notified = 0;
  for (const row of wishlistRows) {
    try {
      const savedPrice = parseFloat(row.lastAlertedPrice) || 0;
      const dropped = savedPrice > livePrice;
      if (!dropped) continue;
      await Notification.create({
        userId: row.userId,
        type: 'system',
        title: `Price drop: ${product.title}`,
        message: `The Kente you saved for GH₵${savedPrice.toFixed(2)} is now GH₵${livePrice.toFixed(2)}.`,
        link: `/product/${pid}`,
      });
      if (row.email) {
        await sendEmailSafely(
          row.email,
          `Price drop: ${product.title}`,
          `<p>Good news! <strong>${product.title}</strong> dropped from <strong>GH₵${savedPrice.toFixed(2)}</strong> to <strong>GH₵${livePrice.toFixed(2)}</strong> on Bonwire Kente.</p><p>Grab it from your wishlist before the price climbs back up.</p>`
        );
      }
      // Re-baseline so the buyer is only re-alerted on a further drop.
      await pool.execute(
        `UPDATE wishlist
         SET lastAlertedPrice = ?, lastPriceDropNotifiedAt = NOW()
         WHERE userId = ? AND productId = ?`,
        [livePrice, row.userId, pid]
      );
      notified += 1;
    } catch (err) {
      console.warn(`⚠️ Price-drop alert failed for user ${row.userId}: ${err.message}`);
    }
  }
  return notified;
};

/**
 * Safety-net sweep: find every wishlist row whose saved price is higher than
 * the live price and was never alerted for a price change, then run the per-
 * product job. Called hourly by the scheduler to cover bulk imports and direct
 * SQL price edits.
 * @returns {Promise<number>} total users notified across all products
 */
export const scanWishlistPriceDrops = async () => {
  const [rows] = await pool.execute(
    `SELECT DISTINCT w.productId
     FROM wishlist w
     JOIN product p ON p.id = w.productId
     WHERE w.lastAlertedPrice IS NOT NULL
       AND p.price < w.lastAlertedPrice
       AND w.lastPriceDropNotifiedAt IS NULL
       AND p.approvalStatus = 'approved'`
  );

  let total = 0;
  for (const row of rows) {
    total += await processPriceDropsForProduct(row.productId);
  }
  if (total > 0) {
    console.log(`💰 Wishlist price-drop sweep alerted ${total} user(s)`);
  }
  return total;
};