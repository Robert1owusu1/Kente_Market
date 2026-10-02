// backend/migrateTrackingNumber.js
// P1: per-vendor tracking numbers live on order_vendor_marks (one per vendor
// per order — the fulfilment grain). Nullable, no backfill needed.
// Idempotent: safe to run more than once.
import pool from './config/db.js';

const run = async () => {
  const [[col]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_vendor_marks' AND COLUMN_NAME = 'trackingNumber'`
  );
  if (Number(col.n) === 0) {
    await pool.execute(`ALTER TABLE order_vendor_marks ADD COLUMN trackingNumber VARCHAR(191) NULL`);
    console.log(' Added order_vendor_marks.trackingNumber column');
  } else {
    console.log(' order_vendor_marks.trackingNumber column already exists');
  }
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(' Migration failed:', err.message);
    process.exit(1);
  });
