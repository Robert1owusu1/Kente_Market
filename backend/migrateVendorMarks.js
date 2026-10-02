// backend/migrateVendorMarks.js
// P0-3: per-vendor fulfilment marks. One row per (order, vendor): each vendor
// advances ONLY their own mark; the global orders.orderStatus follows the
// minimum pipeline position across all vendors on the order (consensus), so
// Vendor A can never push Vendor B's items — or the shared escrow clock —
// forward on their own.
// Backfill: active-pipeline orders get one mark per vendor at the CURRENT
// global status (no display regression, no escrow behavior change; new writes
// follow consensus going forward).
// Idempotent: safe to run more than once.
import pool from './config/db.js';

const PIPELINE = ['processing', 'packaging', 'shipped', 'arrived', 'delivered'];

const run = async () => {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS order_vendor_marks (
      orderId INT NOT NULL COMMENT 'orders.id',
      vendorId INT NOT NULL COMMENT 'Owner vendor user id (matches product.vendorId)',
      status ENUM('processing','packaging','shipped','arrived','delivered') NOT NULL DEFAULT 'processing',
      note TEXT NULL,
      expectedCompletionDate DATETIME NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (orderId, vendorId),
      INDEX idx_marks_order (orderId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log(' order_vendor_marks table ready');

  for (const [name, sql] of [
    ['fk_marks_order', 'ALTER TABLE order_vendor_marks ADD CONSTRAINT fk_marks_order FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE'],
    ['fk_marks_vendor', 'ALTER TABLE order_vendor_marks ADD CONSTRAINT fk_marks_vendor FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE CASCADE'],
  ]) {
    try {
      await pool.execute(sql);
      console.log(` Added ${name}`);
    } catch (err) {
      if (err.code === 'ER_DUP_KEYNAME' || err.code === 'ER_FK_DUP_NAME' || /Duplicate/i.test(err.message)) {
        console.log(` ${name} already exists`);
      } else {
        console.warn(` Could not add ${name} (non-fatal): ${err.message}`);
      }
    }
  }

  // Backfill active orders: resolve each order's vendor set (inline item
  // vendorId wins, else the product row — same rule as the vendor panel).
  const [orders] = await pool.execute(
    `SELECT id, orderStatus, items FROM orders
      WHERE orderStatus IN ('processing','packaging','shipped','arrived','delivered')`
  );
  let marks = 0;
  for (const order of orders) {
    const status = PIPELINE.includes(order.orderStatus) ? order.orderStatus : 'processing';
    let items = order.items;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch { items = []; }
    }
    if (!Array.isArray(items) || items.length === 0) continue;
    const inlineIds = [...new Set(items.map((it) => parseInt(it?.vendorId, 10)).filter(Number.isFinite))];
    const needLookup = items.some((it) => it?.vendorId == null && (it?.product ?? it?.productId ?? it?.id) != null);
    const vendorIds = new Set(inlineIds);
    if (needLookup) {
      const pids = [...new Set(items.map((it) => it?.product ?? it?.productId ?? it?.id).filter((v) => v != null))];
      if (pids.length > 0) {
        const placeholders = pids.map(() => '?').join(', ');
        const [prows] = await pool.execute(
          `SELECT id, vendorId FROM product WHERE id IN (${placeholders})`,
          pids
        );
        for (const r of prows) {
          if (r.vendorId != null) vendorIds.add(parseInt(r.vendorId, 10));
        }
      }
    }
    for (const vendorId of vendorIds) {
      if (!Number.isFinite(vendorId)) continue;
      const [r] = await pool.execute(
        `INSERT IGNORE INTO order_vendor_marks (orderId, vendorId, status) VALUES (?, ?, ?)`,
        [order.id, vendorId, status]
      );
      marks += r.affectedRows;
    }
  }
  console.log(` Backfilled ${marks} vendor mark(s) across ${orders.length} active order(s)`);
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(' Migration failed:', err.message);
    process.exit(1);
  });
