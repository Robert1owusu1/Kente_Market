// @ts-check
// FILE LOCATION: backend/migrateVendorOrigin.js
// DESCRIPTION: Bonwire origin verification (Phase 2, Step 3). A vendor must be
//   from Bonwire (where Kente is woven); the admin contacts them and confirms
//   before approval. Additive only: origin fields on `vendors`, all nullable /
//   defaulted so existing vendors are untouched. The hard-gate toggle itself
//   lives in settings (`vendorPlans.bonwireVerificationRequired`, seeded by
//   migratePlans.js). Idempotent; fails loudly (exit 1).
// Run from backend/:  node migrateVendorOrigin.js
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
  // Vendor-submitted origin claim.
  await addColumn('vendors', 'originTown', `VARCHAR(120) NULL COMMENT 'town/village the weaver claims (should be Bonwire)'`);
  await addColumn('vendors', 'originRegion', `VARCHAR(120) NULL COMMENT 'region, e.g. Ashanti'`);
  await addColumn('vendors', 'originEvidence', `TEXT NULL COMMENT 'vendor-submitted proof/notes/references of Bonwire origin'`);
  // Admin verification (the hard gate). originVerified = 1 is required before
  // approval when vendorPlans.bonwireVerificationRequired is true.
  await addColumn('vendors', 'originVerified', `TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'admin-confirmed Bonwire origin'`);
  await addColumn('vendors', 'originVerifiedBy', `INT NULL COMMENT 'admin users.id who verified'`);
  await addColumn('vendors', 'originVerifiedAt', `DATETIME NULL`);
  await addColumn('vendors', 'originVerificationNote', `VARCHAR(1000) NULL COMMENT 'how the admin confirmed (call, referral, visit)'`);

  console.log('✅ vendor origin schema ready');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`❌ migrateVendorOrigin failed: ${/** @type {any} */ (err).message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
