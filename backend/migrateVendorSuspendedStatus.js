// @ts-check
// FILE LOCATION: backend/migrateVendorSuspendedStatus.js
// DESCRIPTION: Add 'suspended' to vendors.status. updateVendorStatus accepts
//   'suspended' and the storefront hides suspended vendors (N-6), but the enum
//   only had pending/approved/rejected — so suspending a vendor truncated to ''
//   / failed on a fresh DB (the value existed only on the old hosted DB).
//   Idempotent; safe enum widening.
// Run from backend/:  node migrateVendorSuspendedStatus.js
import pool from './config/db.js';

try {
  const [[col]] = /** @type {any} */ (await pool.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vendors' AND COLUMN_NAME = 'status'`
  ));
  if (col && !String(col.t).includes("'suspended'")) {
    await pool.query(
      `ALTER TABLE vendors MODIFY COLUMN status ENUM('pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending'`
    );
    console.log(" Added 'suspended' to vendors.status");
  }
  console.log('✅ vendor suspended status ready');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`❌ migrateVendorSuspendedStatus failed: ${/** @type {any} */ (err).message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
