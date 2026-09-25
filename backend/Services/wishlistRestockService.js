// @ts-check
// FILE LOCATION: backend/Services/wishlistRestockService.js
// DESCRIPTION: Back-in-stock alerts. A product is "restocked" the moment it has
//              stock > 0 after having none. Wishlist rows are debounced with
//              lastRestockNotifiedAt so each wishlisted user is alerted once per
//              out-of-stock episode (not spammed on every inventory tweak).
//
// Two callers share this logic:
//   1. Fast path — product update endpoints call processRestockForProduct()
//      right after a successful write, so alerts feel immediate.
//   2. Safety net — the hourly scheduler scans for any missed transitions.
import pool from '../config/db.js';
import Notification from '../models/notificationModel.js';
import { sendEmailSafely } from '../utils/emailService.js';

/**
 * Notify every wishlisted user for one product that it is back in stock.
 * Idempotent per (user, product) via lastRestockNotifiedAt.
 * @param {number | string} productId
 * @returns {Promise<number>} number of users notified
 */
export const processRestockForProduct = async (productId) => {
  const pid = Number(productId);
  if (!pid || Number.isNaN(pid)) return 0;

  const [[product]] = await pool.execute(
    `SELECT id, title, img, stock, approvalStatus FROM product WHERE id = ?`,
    [pid]
  );
  if (!product || parseInt(product.stock) <= 0) return 0;
  // Only stock a customer can actually buy merits an alert.
  if (product.approvalStatus !== 'approved') return 0;

  const [wishlistRows] = await pool.execute(
    `SELECT w.userId, u.email
     FROM wishlist w
     LEFT JOIN users u ON u.id = w.userId
     WHERE w.productId = ? AND w.lastRestockNotifiedAt IS NULL`,
    [pid]
  );
  if (wishlistRows.length === 0) return 0;

  let notified = 0;
  for (const row of wishlistRows) {
    try {
      await Notification.create({
        userId: row.userId,
        type: 'system',
        title: `Back in stock: ${product.title}`,
        message: `The Kente you've been waiting for is available again. Order before it's gone.`,
        link: `/product/${pid}`,
      });
      if (row.email) {
        await sendEmailSafely(
          row.email,
          `Back in stock: ${product.title}`,
          `<p>Good news! <strong>${product.title}</strong> is back in stock at Bonwire Kente.</p><p>Visit your wishlist to grab it before it sells out again.</p>`
        );
      }
      await pool.execute(
        `UPDATE wishlist SET lastRestockNotifiedAt = NOW() WHERE userId = ? AND productId = ?`,
        [row.userId, pid]
      );
      notified += 1;
    } catch (err) {
      console.warn(`⚠️ Restock alert failed for user ${row.userId}: ${err.message}`);
    }
  }
  return notified;
};

/**
 * Safety-net sweep: find every (wishlist row, product) pair that has stock
 * today but has never been notified, then run the per-product job.
 * Called hourly by the scheduler — covers stock increases that happened while
 * no update endpoint was on the request path (bulk imports, direct SQL…).
 * @returns {Promise<number>} total users notified across all products
 */
export const scanWishlistRestocks = async () => {
  const [rows] = await pool.execute(
    `SELECT DISTINCT w.productId
     FROM wishlist w
     JOIN product p ON p.id = w.productId
     WHERE w.lastRestockNotifiedAt IS NULL
       AND p.stock > 0
       AND p.approvalStatus = 'approved'`
  );

  let total = 0;
  for (const row of rows) {
    total += await processRestockForProduct(row.productId);
  }
  if (total > 0) {
    console.log(`🔔 Wishlist restock sweep notified ${total} user(s)`);
  }
  return total;
};