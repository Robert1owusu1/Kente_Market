// @ts-check
// FILE: backend/migrateInternationalAddresses.js
// DESCRIPTION: Extend user_addresses with international address fields
// for multi-country support. Idempotent, additive.
import pool from './config/db.js';

// countryCode is VIRTUAL, not STORED: TiDB rejects adding a STORED generated
// column with ALTER TABLE (the production engine), and on MySQL 8 a VIRTUAL
// add is an instant metadata change instead of a full table rewrite. Both
// engines can index a virtual generated column. No application code reads the
// column today; it exists for reporting/lookup by ISO code.
const up = async () => {
  const connection = await pool.getConnection();
  try {
    const columns = [
      "addressLine3 VARCHAR(255) NULL COMMENT 'Apartment, suite, unit, etc.' AFTER addressLine2",
      "province VARCHAR(100) NULL COMMENT 'Alias for region/state/county' AFTER state",
      'countryCode CHAR(2) GENERATED ALWAYS AS (CASE WHEN country = \'Ghana\' THEN \'GH\' WHEN country = \'United Kingdom\' THEN \'GB\' WHEN country = \'United States\' THEN \'US\' WHEN country = \'Canada\' THEN \'CA\' WHEN country = \'Germany\' THEN \'DE\' WHEN country = \'Netherlands\' THEN \'NL\' ELSE NULL END) VIRTUAL',
    ];

    for (const col of columns) {
      try {
        await connection.execute(`ALTER TABLE user_addresses ADD COLUMN ${col}`);
        console.log(` Added user_addresses.${col.split(' ')[0]}`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(` user_addresses.${col.split(' ')[0]} already exists`);
        } else {
          // Anything but "already exists" leaves the schema short of what the
          // checkout code reads, so fail the migration (and the db:migrate chain).
          throw err;
        }
      }
    }

    // Add index for countryCode lookups
    try {
      await connection.execute(`CREATE INDEX idx_addresses_country ON user_addresses (countryCode)`);
      console.log(' Added idx_addresses_country');
    } catch (err) {
      if (err.code !== 'ER_DUP_KEYNAME') throw err;
    }

    console.log('✅ International address columns added');
  } finally {
    connection.release();
  }
};

// Reverse of up(). `DROP COLUMN/INDEX IF EXISTS` is MariaDB-only syntax, so
// existence is checked in information_schema; the index goes before the
// column it covers. Only run from a reviewed rollback, never automatically.
const down = async () => {
  const connection = await pool.getConnection();
  try {
    const [idx] = await connection.execute(
      `SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_addresses' AND INDEX_NAME = 'idx_addresses_country' LIMIT 1`
    );
    if (/** @type {any[]} */ (idx).length) {
      await connection.execute(`DROP INDEX idx_addresses_country ON user_addresses`);
    }
    for (const col of ['countryCode', 'province', 'addressLine3']) {
      const [rows] = await connection.execute(
        `SELECT 1 FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_addresses' AND COLUMN_NAME = ? LIMIT 1`,
        [col]
      );
      if (/** @type {any[]} */ (rows).length) {
        await connection.execute(`ALTER TABLE user_addresses DROP COLUMN ${col}`);
      }
    }
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