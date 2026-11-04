// @ts-check
// FILE LOCATION: backend/migrateWholesale.js
// DESCRIPTION: B2B wholesale — Phase A (Phase 3, Step 9): bulk quote capture +
//   vendor negotiation. Adds product wholesale MOQ/enable flags (wholesalePrice
//   already exists) and a bulk_quote_requests table. A vendor needs the
//   `bulk_wholesale` plan feature to enable wholesale / answer quotes (enforced
//   in code). Converting an accepted quote into a paid on-platform order is the
//   follow-up phase. Additive; idempotent.
// Run from backend/:  node migrateWholesale.js
import pool from './config/db.js';

/** @param {string} table @param {string} column */
const columnExists = async (table, column) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return /** @type {any[]} */ (rows).length > 0;
};
/** @param {string} table @param {string} column @param {string} ddl */
const addColumn = async (table, column, ddl) => {
  if (await columnExists(table, column)) return;
  await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  console.log(` Added ${table}.${column}`);
};

try {
  await addColumn('product', 'wholesaleEnabled', `TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'vendor offers bulk/wholesale on this product'`);
  await addColumn('product', 'wholesaleMinQty', `INT NULL COMMENT 'minimum order quantity for wholesale'`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bulk_quote_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      buyerUserId INT NOT NULL,
      vendorId INT NULL COMMENT 'users.id of product owner; NULL = platform product (admin handles)',
      productId INT NOT NULL,
      quantity INT NOT NULL,
      companyName VARCHAR(200) NULL,
      contactPhone VARCHAR(50) NULL,
      message VARCHAR(2000) NULL,
      status ENUM('pending','quoted','accepted','declined','closed') NOT NULL DEFAULT 'pending',
      quotedUnitPrice DECIMAL(12,2) NULL,
      quoteNote VARCHAR(1000) NULL,
      quotedBy INT NULL,
      quotedAt DATETIME NULL,
      validUntil DATETIME NULL,
      buyerRespondedAt DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bqr_buyer (buyerUserId, status),
      INDEX idx_bqr_vendor (vendorId, status),
      INDEX idx_bqr_product (productId),
      CONSTRAINT fk_bqr_buyer FOREIGN KEY (buyerUserId) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_bqr_product FOREIGN KEY (productId) REFERENCES product (id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);

  // Phase B: link an accepted quote to the paid order it was converted into.
  await addColumn('bulk_quote_requests', 'orderId', `INT NULL COMMENT 'paid order created from this quote (Phase B)'`);

  console.log('✅ wholesale schema ready');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`❌ migrateWholesale failed: ${/** @type {any} */ (err).message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
