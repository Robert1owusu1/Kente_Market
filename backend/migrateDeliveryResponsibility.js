// @ts-check
// FILE: backend/migrateDeliveryResponsibility.js
// DESCRIPTION: Who delivers a seller's parcels — the seller or the platform.
//   vendors.domesticDelivery / internationalDelivery
//                         'seller'   = the seller delivers and is paid the delivery fee
//                         'platform' = the seller drops the parcel at the platform hub;
//                                      the platform delivers and keeps the fee
//                         Chosen when applying; NULL only for rows created before this.
//   order_delivery_parts  The choice and the fee frozen per (order, seller) at checkout,
//                         plus the hub hand-over timestamps.
//   custom_requests.pricedDeliveredBy  the choice a custom order was priced with.
//   escrow_allocations.allocationType gains 'shipping': the delivery fee owed to a
//                         seller who delivers themselves (no commission on it).
//   settings.delivery.hubAddress  where sellers drop parcels (admin Shipping page).
// Idempotent, additive. Run: node migrateDeliveryResponsibility.js (part of npm run db:migrate)
import pool from './config/db.js';

/** @param {string} table @param {string} column */
const columnType = async (table, column) => {
  const [rows] = /** @type {[any[], any]} */ (await pool.execute(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  ));
  return rows.length > 0 ? String(rows[0].t) : null;
};

const up = async () => {
  for (const col of ['domesticDelivery', 'internationalDelivery']) {
    if (!(await columnType('vendors', col))) {
      await pool.execute(`ALTER TABLE vendors ADD COLUMN ${col} ENUM('seller','platform') NULL`);
      console.log(`✅ vendors.${col} added`);
    }
  }

  // A custom order is priced before payment; who delivers is saved with that
  // price so the order is booked exactly as it was priced.
  if (!(await columnType('custom_requests', 'pricedDeliveredBy'))) {
    await pool.execute(`ALTER TABLE custom_requests ADD COLUMN pricedDeliveredBy ENUM('seller','platform') NULL`);
    console.log('✅ custom_requests.pricedDeliveredBy added');
  }

  const allocType = await columnType('escrow_allocations', 'allocationType');
  if (allocType && !allocType.includes("'shipping'")) {
    await pool.execute(
      `ALTER TABLE escrow_allocations
       MODIFY COLUMN allocationType ENUM('standard','advance','balance','shipping') NOT NULL DEFAULT 'standard'`
    );
    console.log("✅ escrow_allocations.allocationType accepts 'shipping'");
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS order_delivery_parts (
      orderId INT NOT NULL,
      vendorId INT NOT NULL COMMENT 'Seller user id (product.vendorId)',
      deliveredBy ENUM('seller','platform') NOT NULL,
      shippingFee DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'GHS charged to the customer for this seller parcel',
      handedOverAt DATETIME NULL COMMENT 'Seller says the parcel was dropped at the hub',
      hubReceivedAt DATETIME NULL COMMENT 'Platform confirmed the parcel arrived at the hub',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (orderId, vendorId),
      INDEX idx_odp_hub (deliveredBy, hubReceivedAt),
      CONSTRAINT fk_odp_order FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE,
      CONSTRAINT fk_odp_vendor FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('✅ order_delivery_parts table ready');

  await pool.execute(
    `INSERT IGNORE INTO settings (settingKey, settingValue, settingType) VALUES ('delivery.hubAddress', '', 'string')`
  );
  console.log('✅ delivery.hubAddress setting present');
};

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await up();
  } catch (err) {
    console.error('❌ migrateDeliveryResponsibility failed:', /** @type {any} */ (err).message);
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}

export { up };
