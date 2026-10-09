// @ts-check
// FILE: backend/migrateShippingCarriersRates.js
// DESCRIPTION: Add shipping_carriers and shipping_rates tables for
// configurable carrier-based shipping rules. Idempotent, additive.
import pool from './config/db.js';

const up = async () => {
  const connection = await pool.getConnection();
  try {
    // Create shipping_carriers table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS shipping_carriers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE COMMENT 'Internal code: dhl, fedex, ups, local_gh, ems',
        name VARCHAR(100) NOT NULL COMMENT 'Display name',
        supportedCountries JSON NOT NULL COMMENT 'Array of ISO country codes this carrier serves',
        apiConfig JSON NULL COMMENT 'Credentials, account numbers, API endpoints',
        isActive BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_sc_active (isActive)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log('✅ shipping_carriers table created');

    // Create shipping_rates table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS shipping_rates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        carrierId INT NOT NULL,
        vendorId INT NULL COMMENT 'NULL = platform default rate; vendorId = vendor-specific override',
        originCountry CHAR(2) NOT NULL DEFAULT 'GH' COMMENT 'ISO 3166-1 alpha-2',
        destinationCountry CHAR(2) NOT NULL COMMENT 'ISO 3166-1 alpha-2',
        destinationRegion VARCHAR(100) NULL COMMENT 'NULL = all regions in destination country',
        serviceLevel VARCHAR(50) NOT NULL COMMENT 'standard, express, economy',
        minWeightKg DECIMAL(8,3) DEFAULT 0 COMMENT 'Minimum weight for this rate',
        maxWeightKg DECIMAL(8,3) DEFAULT 999 COMMENT 'Maximum weight for this rate',
        baseCost DECIMAL(10,2) NOT NULL COMMENT 'Base cost in rate currency',
        perKgCost DECIMAL(10,2) DEFAULT 0 COMMENT 'Additional cost per kg over minWeightKg',
        freeThreshold DECIMAL(10,2) NULL COMMENT 'Subtotal in rate currency for free shipping',
        transitDaysMin INT NOT NULL COMMENT 'Minimum transit days',
        transitDaysMax INT NOT NULL COMMENT 'Maximum transit days',
        currency CHAR(3) NOT NULL DEFAULT 'GHS' COMMENT 'Currency of this rate (usually order currency)',
        effectiveFrom DATE NOT NULL COMMENT 'Rate effective from this date',
        effectiveTo DATE NULL COMMENT 'Rate expires on this date (NULL = indefinite)',
        isActive BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (carrierId) REFERENCES shipping_carriers(id) ON DELETE CASCADE,
        FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_sr_lookup (originCountry, destinationCountry, destinationRegion, serviceLevel, isActive),
        INDEX idx_sr_vendor (vendorId),
        INDEX idx_sr_carrier (carrierId),
        INDEX idx_sr_dates (effectiveFrom, effectiveTo)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log('✅ shipping_rates table created');

    // Add foreign key constraints if not present
    for (const [name, sql] of [
      ['fk_sr_carrier', 'ALTER TABLE shipping_rates ADD CONSTRAINT fk_sr_carrier FOREIGN KEY (carrierId) REFERENCES shipping_carriers(id) ON DELETE CASCADE'],
      ['fk_sr_vendor', 'ALTER TABLE shipping_rates ADD CONSTRAINT fk_sr_vendor FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE CASCADE'],
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

    // Seed default carriers
    await connection.execute(`
      INSERT IGNORE INTO shipping_carriers (code, name, supportedCountries, isActive) VALUES
        ('local_gh', 'Ghana Local Delivery', '["GH"]', TRUE),
        ('ems', 'Ghana Post EMS', '["GH","GB","US","CA","DE","NL"]', TRUE),
        ('dhl', 'DHL Express', '["GB","US","CA","DE","NL"]', TRUE),
        ('fedex', 'FedEx International', '["GB","US","CA","DE","NL"]', TRUE),
        ('ups', 'UPS Worldwide', '["GB","US","CA","DE","NL"]', TRUE)
    `);

    console.log('✅ Default carriers seeded');

    // Seed default platform rates (vendorId = NULL)
    // Rates are in the destination country's currency (matching COUNTRY_CONFIG)
    const now = new Date().toISOString().split('T')[0];
    await connection.execute(`
      INSERT IGNORE INTO shipping_rates 
        (carrierId, vendorId, originCountry, destinationCountry, destinationRegion, serviceLevel,
         minWeightKg, maxWeightKg, baseCost, perKgCost, freeThreshold, transitDaysMin, transitDaysMax,
         currency, effectiveFrom, effectiveTo, isActive)
      SELECT c.id, NULL, 'GH', 'GH', NULL, 'standard', 0, 30, 15, 0, 200, 2, 5, 'GHS', ?, NULL, TRUE
      FROM shipping_carriers c WHERE c.code = 'local_gh'
    `, [now]);

    await connection.execute(`
      INSERT IGNORE INTO shipping_rates 
        (carrierId, vendorId, originCountry, destinationCountry, destinationRegion, serviceLevel,
         minWeightKg, maxWeightKg, baseCost, perKgCost, freeThreshold, transitDaysMin, transitDaysMax,
         currency, effectiveFrom, effectiveTo, isActive)
      SELECT c.id, NULL, 'GH', 'GB', NULL, 'standard', 0, 5, 12, 0, 100, 5, 10, 'GBP', ?, NULL, TRUE
      FROM shipping_carriers c WHERE c.code = 'dhl'
    `, [now]);

    await connection.execute(`
      INSERT IGNORE INTO shipping_rates 
        (carrierId, vendorId, originCountry, destinationCountry, destinationRegion, serviceLevel,
         minWeightKg, maxWeightKg, baseCost, perKgCost, freeThreshold, transitDaysMin, transitDaysMax,
         currency, effectiveFrom, effectiveTo, isActive)
      SELECT c.id, NULL, 'GH', 'US', NULL, 'standard', 0, 5, 18, 0, 150, 7, 14, 'USD', ?, NULL, TRUE
      FROM shipping_carriers c WHERE c.code = 'dhl'
    `, [now]);

    await connection.execute(`
      INSERT IGNORE INTO shipping_rates 
        (carrierId, vendorId, originCountry, destinationCountry, destinationRegion, serviceLevel,
         minWeightKg, maxWeightKg, baseCost, perKgCost, freeThreshold, transitDaysMin, transitDaysMax,
         currency, effectiveFrom, effectiveTo, isActive)
      SELECT c.id, NULL, 'GH', 'CA', NULL, 'standard', 0, 5, 20, 0, 180, 7, 14, 'CAD', ?, NULL, TRUE
      FROM shipping_carriers c WHERE c.code = 'dhl'
    `, [now]);

    await connection.execute(`
      INSERT IGNORE INTO shipping_rates 
        (carrierId, vendorId, originCountry, destinationCountry, destinationRegion, serviceLevel,
         minWeightKg, maxWeightKg, baseCost, perKgCost, freeThreshold, transitDaysMin, transitDaysMax,
         currency, effectiveFrom, effectiveTo, isActive)
      SELECT c.id, NULL, 'GH', 'DE', NULL, 'standard', 0, 5, 15, 0, 120, 5, 10, 'EUR', ?, NULL, TRUE
      FROM shipping_carriers c WHERE c.code = 'dhl'
    `, [now]);

    await connection.execute(`
      INSERT IGNORE INTO shipping_rates 
        (carrierId, vendorId, originCountry, destinationCountry, destinationRegion, serviceLevel,
         minWeightKg, maxWeightKg, baseCost, perKgCost, freeThreshold, transitDaysMin, transitDaysMax,
         currency, effectiveFrom, effectiveTo, isActive)
      SELECT c.id, NULL, 'GH', 'NL', NULL, 'standard', 0, 5, 14, 0, 110, 5, 10, 'EUR', ?, NULL, TRUE
      FROM shipping_carriers c WHERE c.code = 'dhl'
    `, [now]);

    console.log('✅ Default platform shipping rates seeded');
  } finally {
    connection.release();
  }
};

const down = async () => {
  const connection = await pool.getConnection();
  try {
    await connection.execute('DROP TABLE IF EXISTS shipping_rates');
    await connection.execute('DROP TABLE IF EXISTS shipping_carriers');
    console.log('✅ shipping_carriers and shipping_rates tables dropped');
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