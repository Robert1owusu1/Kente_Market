// @ts-check
// FILE: backend/migrateOrderItems.js
// DESCRIPTION: Add normalized order_items table for vendor-scoped queries
// Run: node migrateOrderItems.js (part of npm run db:migrate)

import pool from './config/db.js';

// N-5: `db:migrate` is a 21-script `&&` chain — any process exiting non-zero
// skips EVERY migration after it and leaves the schema half-applied. So a
// failure has to be classified before it is allowed to propagate:
//   * a lost connection cannot be worked around -> rethrow, stop the chain,
//     because nothing after this can run anyway;
//   * anything else is one bad ROW -> skip it, keep going, report it. The
//     remaining orders still get backfilled and the schema stays complete.
/**
 * @param {{ code?: string } | null | undefined} err
 * @returns {boolean}
 */
export const isFatalConnectionError = (err) => {
  const code = err?.code ?? '';
  return ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'PROTOCOL_CONNECTION_LOOST'].includes(code);
};

const up = async () => {
  const connection = await pool.getConnection();
  try {
    // Create order_items table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS order_items (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        orderId INT NOT NULL,
        vendorId INT NULL COMMENT 'Denormalized vendor for fast vendor-scoped queries',
        productId INT NULL,
        name VARCHAR(255) NOT NULL,
        qty INT NOT NULL DEFAULT 1,
        price DECIMAL(10,2) NOT NULL,
        image VARCHAR(500) NULL,
        selectedColor VARCHAR(100) NULL,
        selectedSize VARCHAR(100) NULL,
        yards DECIMAL(6,2) NULL,
        isCustomizable BOOLEAN DEFAULT FALSE,
        productionTime INT DEFAULT 1,
        reserved INT DEFAULT 0,
        customRequestId INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (productId) REFERENCES product(id) ON DELETE SET NULL,
        INDEX idx_oi_vendor_created (vendorId, created_at),
        INDEX idx_oi_order (orderId),
        INDEX idx_oi_product (productId)
      ) ENGINE=InnoDB
    `);

    console.log('✅ order_items table created');
  } finally {
    connection.release();
  }
};

const backfill = async () => {
  const connection = await pool.getConnection();
  try {
    // Check if already backfilled
    const [[count]] = await connection.execute(`SELECT COUNT(*) as c FROM order_items`);
    if (count.c > 0) {
      console.log(`✅ order_items already has ${count.c} rows, skipping backfill`);
      return;
    }

    // Backfill from existing orders.items JSON
    const batchSize = 100;
    let offset = 0;
    let totalInserted = 0;

    // N-5: one bad row used to throw straight out of this loop, which
    // exited non-zero and aborted the rest of the && chain.
    const failedOrderIds = [];
    let rowsFailed = 0;

    await connection.beginTransaction();
    try {
      while (true) {
        // mysql2's execute() speaks the server-side prepared-statement protocol,
        // which rejects a placeholder in LIMIT/OFFSET ("Incorrect arguments to
        // LIMIT"). That threw here and aborted `npm run db:migrate`, so every
        // migration after this one — including the coupon-use and login-window
        // ones — never ran from the chain. Both values are internal integers.
        const [orders] = await connection.execute(
          `SELECT id, items, created_at FROM orders ORDER BY id LIMIT ${Number(batchSize)} OFFSET ${Number(offset)}`,
          []
        );

        if (orders.length === 0) break;

        for (const order of orders) {
          try {
            let items = order.items;
            if (typeof items === 'string') {
              try { items = JSON.parse(items); } catch { items = []; }
            }
            if (!Array.isArray(items) || items.length === 0) continue;

            // Build product -> vendorId map for this order
            const productIds = [...new Set(
              items.map(it => it.product ?? it.productId ?? it.id).filter(v => v != null)
            )];

            let productVendorMap = new Map();
            if (productIds.length > 0) {
              const placeholders = productIds.map(() => '?').join(',');
              const [prows] = await connection.execute(
                `SELECT id, vendorId FROM product WHERE id IN (${placeholders})`,
                productIds
              );
              for (const pr of prows) {
                productVendorMap.set(String(pr.id), pr.vendorId);
              }
            }

            // Insert order_items
            for (const item of items) {
              const productId = item.product ?? item.productId ?? item.id;
              const vendorId = item.vendorId ?? productVendorMap.get(String(productId)) ?? null;

              await connection.execute(`
                INSERT INTO order_items
                (orderId, vendorId, productId, name, qty, price, image, selectedColor, selectedSize, yards, isCustomizable, productionTime, reserved, customRequestId, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `, [
                order.id,
                vendorId,
                productId || null,
                item.name || item.title || 'Product',
                parseInt(item.qty ?? item.quantity ?? 1, 10) || 1,
                parseFloat(item.price) || 0,
                item.image || null,
                item.selectedColor || item.color || null,
                item.selectedSize || item.size || null,
                item.yards ?? null,
                item.isCustomizable ? 1 : 0,
                parseInt(item.productionTime ?? 1, 10) || 1,
                parseInt(item.reserved ?? 0, 10) || 0,
                item.customRequestId ?? null,
                order.created_at
              ]);
              totalInserted++;
            }
          } catch (rowErr) {
            if (isFatalConnectionError(rowErr)) throw rowErr;
            rowsFailed++;
            failedOrderIds.push(order.id);
            console.error(`   order ${order.id} skipped: ${rowErr.message}`);
          }
        }

        offset += batchSize;
        if (orders.length < batchSize) break;
      }
      await connection.commit();
    } catch (fatalErr) {
      await connection.rollback().catch(() => {});
      throw fatalErr;
    }

    if (rowsFailed > 0) {
      const shown = failedOrderIds.slice(0, 10).join(', ');
      const more = failedOrderIds.length > 10 ? ` (+${failedOrderIds.length - 10} more)` : '';
      console.error(`   order_items backfilled PARTIALLY: ${totalInserted} inserted, ${rowsFailed} order(s) skipped: ${shown}${more}`);
      console.error(`   These rows will NOT be retried on the next run — the idempotency guard sees a non-empty table and skips. Investigate them manually.`);
    } else {
      console.log(`✅ order_items backfilled: ${totalInserted} items inserted`);
    }
  } finally {
    connection.release();
  }
};

const down = async () => {
  const connection = await pool.getConnection();
  try {
    await connection.execute('DROP TABLE IF EXISTS order_items');
    console.log('✅ order_items table dropped');
  } finally {
    connection.release();
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const direction = process.argv[2] || 'up';
  if (direction === 'down') {
    await down();
  } else if (direction === 'backfill') {
    await backfill();
  } else {
    await up();
    await backfill();
  }
  process.exit(0);
}

export { up, down, backfill };