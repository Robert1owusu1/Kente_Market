// @ts-check
// FILE LOCATION: backend/migrateGroupBuy.js
// DESCRIPTION: Group-buy campaigns (follow-up to pre-orders). A product can set
//   a target quantity + deadline; buyers pledge (pay now, escrow held). At the
//   deadline a sweep evaluates: target met → campaign succeeds (orders proceed);
//   target missed → pure single-product pledge orders are auto-refunded.
//   Additive; idempotent.
// Run from backend/:  node migrateGroupBuy.js
import pool from './config/db.js';

const columnExists = async (/** @type {string} */ table, /** @type {string} */ column) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return /** @type {any[]} */ (rows).length > 0;
};
const addColumn = async (/** @type {string} */ table, /** @type {string} */ column, /** @type {string} */ ddl) => {
  if (await columnExists(table, column)) return;
  await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  console.log(` Added ${table}.${column}`);
};

try {
  await addColumn('product', 'groupBuyTarget', `INT NULL COMMENT 'units needed for the run to proceed'`);
  await addColumn('product', 'groupBuyDeadline', `DATE NULL COMMENT 'campaign deadline'`);
  await addColumn('product', 'groupBuyStatus', `ENUM('pending','succeeded','failed') NULL COMMENT 'campaign resolution; NULL = not a group buy'`);
  console.log('✅ group-buy schema ready');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`❌ migrateGroupBuy failed: ${/** @type {any} */ (err).message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
