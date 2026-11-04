// @ts-check
// FILE LOCATION: backend/migrateLastClickAttribution.js
// DESCRIPTION: Last-click affiliate attribution (follow-up). Captures the
//   referral-cookie's referrer on the order at checkout so a creator earns on
//   purchases they drove — even from EXISTING customers (not just new signups).
//   recordReferralForOrder prefers this over signup attribution. Additive.
// Run from backend/:  node migrateLastClickAttribution.js
import pool from './config/db.js';

const columnExists = async (/** @type {string} */ table, /** @type {string} */ column) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return /** @type {any[]} */ (rows).length > 0;
};

try {
  if (!(await columnExists('orders', 'referrerUserId'))) {
    await pool.query(`ALTER TABLE orders ADD COLUMN referrerUserId INT NULL COMMENT 'last-click referral attribution captured at checkout'`);
    await pool.query(`ALTER TABLE orders ADD INDEX idx_orders_referrer (referrerUserId)`);
    console.log(' Added orders.referrerUserId');
  }
  console.log('✅ last-click attribution schema ready');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`❌ migrateLastClickAttribution failed: ${/** @type {any} */ (err).message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
