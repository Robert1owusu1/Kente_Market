// @ts-check
// FILE LOCATION: backend/migrateFeaturedListings.js
// DESCRIPTION: Paid featured/sponsored listings (Phase 3, Step 8). Vendors on a
//   plan with `featured_eligible` pay to feature a product for N days. Adds
//   product.featuredUntil (expiry for paid placements; NULL = admin-featured,
//   no expiry), a featured_placements ledger, a 'featured' platform_revenue
//   source, and admin-set pricing/enable settings. Additive; idempotent.
// Run from backend/:  node migrateFeaturedListings.js
import pool from './config/db.js';

/** @param {string} table @param {string} column */
const columnExists = async (table, column) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return /** @type {any[]} */ (rows).length > 0;
};

try {
  // Expiry for paid placements (NULL = featured with no expiry, e.g. admin-set).
  if (!(await columnExists('product', 'featuredUntil'))) {
    await pool.query(`ALTER TABLE product ADD COLUMN featuredUntil DATETIME NULL COMMENT 'paid feature expiry; NULL = no expiry'`);
    console.log(' Added product.featuredUntil');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS featured_placements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      vendorId INT NOT NULL COMMENT 'users.id of the vendor',
      productId INT NOT NULL,
      days INT NOT NULL,
      amount DECIMAL(12,2) NOT NULL COMMENT 'fee paid (GHS)',
      currency CHAR(3) NOT NULL DEFAULT 'GHS',
      status ENUM('pending_payment','active','expired','cancelled') NOT NULL DEFAULT 'pending_payment',
      startsAt DATETIME NULL,
      expiresAt DATETIME NULL,
      purchaseReference VARCHAR(80) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_featured_ref (purchaseReference),
      INDEX idx_featured_vendor (vendorId, status),
      INDEX idx_featured_product (productId),
      INDEX idx_featured_expiry (status, expiresAt),
      CONSTRAINT fk_featured_vendor FOREIGN KEY (vendorId) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_featured_product FOREIGN KEY (productId) REFERENCES product (id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);

  // Add 'featured' to the platform_revenue source enum (idempotent-ish: only if missing).
  const [[col]] = /** @type {any} */ (await pool.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_revenue' AND COLUMN_NAME = 'source'`
  ));
  if (col && !String(col.t).includes("'featured'")) {
    await pool.query(
      `ALTER TABLE platform_revenue MODIFY COLUMN source ENUM('platform_product','commission','refund','featured') DEFAULT 'platform_product'`
    );
    console.log(" Added 'featured' to platform_revenue.source");
  }

  // Admin-set: price per featured day + a kill switch. Feature stays OFF/0 until
  // an admin sets a price and enables it.
  for (const [key, value, type] of [
    ['featured.enabled', 'false', 'boolean'],
    ['featured.pricePerDay', '0', 'number'],
    ['featured.maxDays', '30', 'number'],
  ]) {
    await pool.query(
      `INSERT IGNORE INTO settings (settingKey, settingValue, settingType) VALUES (?, ?, ?)`,
      [key, value, type]
    );
  }

  console.log('✅ featured listings schema ready');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`❌ migrateFeaturedListings failed: ${/** @type {any} */ (err).message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
