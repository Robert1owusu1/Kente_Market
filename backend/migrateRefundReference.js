// backend/migrateRefundReference.js
// P1: refund initiation marker. cancelOrder / return-approve persist
// refundReference BEFORE calling Paystack so a crash between provider-accept
// and the status flip is detectable: refundReference set + still paid (+ a
// refund journal row) means the money left but the books still say paid.
// reconcileRefundedButPaid (scheduled) flips + voids + alerts; it never
// re-issues the refund (double-refund risk).
// Idempotent: safe to run more than once.
// NOTE: TiDB does not support ADD COLUMN ... UNIQUE inline, so the column
// and the unique index are added in two steps.
import pool from './config/db.js';

const run = async () => {
  const [[col]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'refundReference'`
  );
  if (Number(col.n) === 0) {
    await pool.execute(`ALTER TABLE orders ADD COLUMN refundReference VARCHAR(191) NULL`);
    console.log(' Added orders.refundReference column');
  } else {
    console.log(' orders.refundReference column already exists');
  }
  const [[idx]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND INDEX_NAME = 'uq_orders_refundReference'`
  );
  if (Number(idx.n) === 0) {
    await pool.execute(`CREATE UNIQUE INDEX uq_orders_refundReference ON orders (refundReference)`);
    console.log(' Added uq_orders_refundReference');
  } else {
    console.log(' uq_orders_refundReference already exists');
  }
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(' Migration failed:', err.message);
    process.exit(1);
  });
