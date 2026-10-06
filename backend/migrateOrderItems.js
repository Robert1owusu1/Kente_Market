// @ts-check
// FILE: backend/migrateOrderItems.js
// DESCRIPTION: Add normalized order_items table for vendor-scoped queries
// Run: node migrateOrderItems.js (part of npm run db:migrate)

import pool from './config/db.js';

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
      }

      offset += batchSize;
      if (orders.length < batchSize) break;
    }

    console.log(`✅ order_items backfilled: ${totalInserted} items inserted`);
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