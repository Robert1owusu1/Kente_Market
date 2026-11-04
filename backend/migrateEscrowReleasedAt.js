// @ts-check
// FILE LOCATION: backend/migrateEscrowReleasedAt.js
// DESCRIPTION: Add escrow_allocations.released_at — used by production payout/
//   settlement code (transferSettlementService.js, adminPayoutController.js) but
//   never captured in a migration (it existed only on the old hosted DB). A
//   fresh database broke every payout/settlement/refund-release path with
//   "Unknown column 'released_at'". Additive, nullable; idempotent.
// Run from backend/:  node migrateEscrowReleasedAt.js
import pool from './config/db.js';

const columnExists = async (/** @type {string} */ table, /** @type {string} */ column) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return /** @type {any[]} */ (rows).length > 0;
};

try {
  if (!(await columnExists('escrow_allocations', 'released_at'))) {
    await pool.query(`ALTER TABLE escrow_allocations ADD COLUMN released_at DATETIME NULL COMMENT 'when the allocation was released/paid out'`);
    // Backfill: rows already released get a timestamp so reports are not null.
    await pool.query(`UPDATE escrow_allocations SET released_at = updated_at WHERE status IN ('released','releasing') AND released_at IS NULL`);
    console.log(' Added escrow_allocations.released_at (+ backfilled released rows)');
  }
  console.log('✅ escrow released_at schema ready');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`❌ migrateEscrowReleasedAt failed: ${/** @type {any} */ (err).message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
