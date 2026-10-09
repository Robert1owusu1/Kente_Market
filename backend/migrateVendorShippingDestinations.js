// @ts-check
// FILE: backend/migrateVendorShippingDestinations.js
// DESCRIPTION: Add vendor_shipping_destinations table for vendor-controlled
// shipping eligibility per country/region. Idempotent, additive.
import pool from './config/db.js';

const up = async () => {
  const connection = await pool.getConnection();
  try {
    // Create vendor_shipping_destinations table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS vendor_shipping_destinations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        vendorId INT NOT NULL COMMENT 'vendors.userId (users.id of the vendor owner)',
        countryCode CHAR(2) NOT NULL COMMENT 'ISO 3166-1 alpha-2, e.g., GH, GB, US',
        region VARCHAR(100) NULL COMMENT 'NULL = all regions in the country',
        isActive BOOLEAN DEFAULT TRUE COMMENT 'Vendor can enable/disable without deleting',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY uq_vendor_country_region (vendorId, countryCode, region),
        INDEX idx_vsd_vendor (vendorId),
        INDEX idx_vsd_country (countryCode),
        INDEX idx_vsd_active (isActive)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log('✅ vendor_shipping_destinations table created');

    // Add foreign key constraints if not present
    for (const [name, sql] of [
      ['fk_vsd_vendor', 'ALTER TABLE vendor_shipping_destinations ADD CONSTRAINT fk_vsd_vendor FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE CASCADE'],
    ]) {
      try {
        await connection.execute(sql);
        console.log(` Added ${name}`);
      } catch (err) {
        if (err.code === 'ER_DUP_KEYNAME' || err.code === 'ER_FK_DUP_NAME' || /Duplicate/i.test(err.message)) {
          console.log(` ${name} already exists`);
        } else {
          console.warn(` Could not add ${name} (non-fatal): ${err.message}`);
        }
      }
    }

    // Backfill: existing approved vendors get Ghana (GH) as default active destination
    // This preserves current behavior where all vendors ship domestically
    await connection.execute(`
      INSERT IGNORE INTO vendor_shipping_destinations (vendorId, countryCode, region, isActive, created_at)
      SELECT v.userId, 'GH', NULL, TRUE, NOW()
      FROM vendors v
      WHERE v.status = 'approved'
    `);

    console.log('✅ Backfilled domestic (GH) destinations for approved vendors');
  } finally {
    connection.release();
  }
};

const down = async () => {
  const connection = await pool.getConnection();
  try {
    await connection.execute('DROP TABLE IF EXISTS vendor_shipping_destinations');
    console.log('✅ vendor_shipping_destinations table dropped');
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