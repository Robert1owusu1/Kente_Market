// @ts-check
// FILE LOCATION: backend/migratePreorders.js
// DESCRIPTION: Pre-orders / limited runs (Phase 3, Step 11). A product can be
//   marked a pre-order with an expected availability date; the run size is the
//   product's stock, so ordering flows through the normal checkout/escrow (funds
//   collected now, held in escrow until delivery). Group-buy with conditional
//   refunds is a separate follow-up. Additive; idempotent.
// Run from backend/:  node migratePreorders.js
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
  await addColumn('product', 'isPreorder', `TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'sold as a pre-order / limited run'`);
  await addColumn('product', 'preorderAvailableOn', `DATE NULL COMMENT 'expected availability / ship date'`);

  console.log('✅ pre-order schema ready');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`❌ migratePreorders failed: ${/** @type {any} */ (err).message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
