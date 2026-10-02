// backend/migratePartialRefunds.js
// P1: per-vendor partial refunds. orders.refundedAmount tracks the running
// refunded total so a paid order can carry one partial vendor refund (stays
// paid) or a full refund (flips to refunded) without losing the books.
// Idempotent: safe to run more than once.
import pool from './config/db.js';

const run = async () => {
  const [[col]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'refundedAmount'`
  );
  if (Number(col.n) === 0) {
    await pool.execute(`ALTER TABLE orders ADD COLUMN refundedAmount DECIMAL(10,2) NOT NULL DEFAULT 0`);
    console.log(' Added orders.refundedAmount column');
  } else {
    console.log(' orders.refundedAmount column already exists');
  }
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(' Migration failed:', err.message);
    process.exit(1);
  });
