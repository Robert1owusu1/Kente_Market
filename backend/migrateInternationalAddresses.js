// @ts-check
// FILE: backend/migrateInternationalAddresses.js
// DESCRIPTION: Extend user_addresses with international address fields
// for multi-country support. Idempotent, additive.
import pool from './config/db.js';

const up = async () => {
  const connection = await pool.getConnection();
  try {
    const columns = [
      'addressLine3 VARCHAR(255) NULL AFTER addressLine2 COMMENT 'Apartment, suite, unit, etc.'',
      'province VARCHAR(100) NULL AFTER state COMMENT 'Alias for region/state/county'',
      'countryCode CHAR(2) GENERATED ALWAYS AS (CASE WHEN country = \'Ghana\' THEN \'GH\' WHEN country = \'United Kingdom\' THEN \'GB\' WHEN country = \'United States\' THEN \'US\' WHEN country = \'Canada\' THEN \'CA\' WHEN country = \'Germany\' THEN \'DE\' WHEN country = \'Netherlands\' THEN \'NL\' ELSE \'GH\' END) STORED',
    ];

    for (const col of columns) {
      try {
        await connection.execute(`ALTER TABLE user_addresses ADD COLUMN ${col}`);
        console.log(` Added user_addresses.${col.split(' ')[0]}`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(` user_addresses.${col.split(' ')[0]} already exists`);
        } else {
          console.warn(` Could not add user_addresses.${col.split(' ')[0]}: ${err.message}`);
        }
      }
    }

    // Add index for countryCode lookups
    try {
      await connection.execute(`CREATE INDEX idx_addresses_country ON user_addresses (countryCode)`);
      console.log(' Added idx_addresses_country');
    } catch (err) {
      if (err.code !== 'ER_DUP_KEYNAME') console.warn(` idx_addresses_country: ${err.message}`);
    }

    console.log('✅ International address columns added');
  } finally {
    connection.release();
  }
};

const down = async () => {
  const connection = await pool.getConnection();
  try {
    await connection.execute(`ALTER TABLE user_addresses DROP COLUMN IF EXISTS addressLine3`);
    await connection.execute(`ALTER TABLE user_addresses DROP COLUMN IF EXISTS province`);
    await connection.execute(`ALTER TABLE user_addresses DROP COLUMN IF EXISTS countryCode`);
    await connection.execute(`DROP INDEX IF EXISTS idx_addresses_country ON user_addresses`);
    console.log('✅ International address columns removed');
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