// @ts-check
// FILE LOCATION: backend/migrateStoreCreditSplit.js
// DESCRIPTION: Gift-card SPLIT payment (follow-up). Store credit can cover PART
//   of an order; Paystack pays the remainder. orders.storeCreditApplied records
//   the credit leg; the Paystack amount checks subtract it. Credit is returned
//   (idempotently) if the order is cancelled/refunded/expired. Additive.
// Run from backend/:  node migrateStoreCreditSplit.js
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
  if (!(await columnExists('orders', 'storeCreditApplied'))) {
    await pool.query(`ALTER TABLE orders ADD COLUMN storeCreditApplied DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'store credit paid toward this order (gift cards)'`);
    console.log(' Added orders.storeCreditApplied');
  }
  console.log('✅ store credit split schema ready');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`❌ migrateStoreCreditSplit failed: ${/** @type {any} */ (err).message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
