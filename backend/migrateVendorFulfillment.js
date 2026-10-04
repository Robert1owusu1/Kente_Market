// @ts-check
// FILE: backend/migrateVendorFulfillment.js
// DESCRIPTION: Add vendor_order_fulfillment table for per-vendor fulfillment tracking
// Run: node migrateVendorFulfillment.js (part of npm run db:migrate)

import pool from './config/db.js';
import { ESCROW_RELEASE_DAYS } from './config/businessConfig.js';

const up = async () => {
  const connection = await pool.getConnection();
  try {
    // Create vendor_order_fulfillment table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS vendor_order_fulfillment (
        id INT AUTO_INCREMENT PRIMARY KEY,
        orderId INT NOT NULL,
        vendorId INT NOT NULL,
        status ENUM('pending','packaging','shipped','delivered','cancelled') DEFAULT 'pending',
        trackingNumber VARCHAR(255) NULL,
        shippedAt DATETIME NULL,
        deliveredAt DATETIME NULL,
        escrowReleaseDeadline DATETIME NULL COMMENT 'Auto-release deadline for this vendor escrow',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY uq_vendor_order (orderId, vendorId),
        INDEX idx_vof_vendor_status (vendorId, status),
        INDEX idx_vof_order (orderId),
        INDEX idx_vof_deadline (escrowReleaseDeadline)
      ) ENGINE=InnoDB
    `);

    // Backfill from existing orders for delivered orders
    // For orders already delivered, create fulfillment records for each vendor
    await connection.execute(`
      INSERT IGNORE INTO vendor_order_fulfillment (orderId, vendorId, status, deliveredAt, escrowReleaseDeadline, created_at)
      SELECT o.id, ea.vendorId, 'delivered', o.deliveredAt, 
        DATE_ADD(o.deliveredAt, INTERVAL ? DAY), o.created_at
      FROM orders o
      JOIN escrow_allocations ea ON ea.orderId = o.id
      WHERE o.orderStatus = 'delivered' 
        AND o.deliveredAt IS NOT NULL
        AND ea.vendorId IS NOT NULL
    `, [ESCROW_RELEASE_DAYS]);

    // For orders in processing/shipped, create pending fulfillment records
    await connection.execute(`
      INSERT IGNORE INTO vendor_order_fulfillment (orderId, vendorId, status, created_at)
      SELECT o.id, ea.vendorId, 
        CASE 
          WHEN o.orderStatus IN ('shipped','arrived') THEN 'shipped'
          WHEN o.orderStatus = 'processing' THEN 'packaging'
          ELSE 'pending'
        END,
        o.created_at
      FROM orders o
      JOIN escrow_allocations ea ON ea.orderId = o.id
      WHERE o.orderStatus IN ('processing','packaging','shipped','arrived')
        AND ea.vendorId IS NOT NULL
    `);

    console.log('✅ vendor_order_fulfillment table created and backfilled');
  } finally {
    connection.release();
  }
};

const down = async () => {
  const connection = await pool.getConnection();
  try {
    await connection.execute('DROP TABLE IF EXISTS vendor_order_fulfillment');
    console.log('✅ vendor_order_fulfillment table dropped');
  } finally {
    connection.release();
  }
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const direction = process.argv[2] || 'up';
  if (direction === 'down') {
    await down();
  } else {
    await up();
  }
  process.exit(0);
}

export { up, down };