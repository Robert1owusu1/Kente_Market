// @ts-check
// FILE: backend/migrateInternationalOrders.js
// DESCRIPTION: Add currency tracking columns to orders, escrow_allocations,
// and financial_events for multi-currency support.
// Idempotent, additive.
import pool from './config/db.js';

const up = async () => {
  const connection = await pool.getConnection();
  try {
    // Add currency columns to orders table
    const orderColumns = [
      'currency CHAR(3) NOT NULL DEFAULT \'GHS\' AFTER totalAmount',
      'exchangeRate DECIMAL(12,6) NULL AFTER currency',
      'originalCurrency CHAR(3) NULL AFTER exchangeRate',
      'originalAmount DECIMAL(12,2) NULL AFTER originalCurrency',
    ];

    for (const col of orderColumns) {
      try {
        await connection.execute(`ALTER TABLE orders ADD COLUMN ${col}`);
        console.log(` Added orders.${col.split(' ')[0]}`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(` orders.${col.split(' ')[0]} already exists`);
        } else {
          // Anything but "already exists" leaves the schema short of what the
          // checkout code reads, so fail the migration (and the db:migrate chain).
          throw err;
        }
      }
    }

    // Add currency columns to escrow_allocations
    const escrowColumns = [
      'currency CHAR(3) NOT NULL DEFAULT \'GHS\' AFTER amount',
      'exchangeRate DECIMAL(12,6) NULL AFTER currency',
    ];

    for (const col of escrowColumns) {
      try {
        await connection.execute(`ALTER TABLE escrow_allocations ADD COLUMN ${col}`);
        console.log(` Added escrow_allocations.${col.split(' ')[0]}`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(` escrow_allocations.${col.split(' ')[0]} already exists`);
        } else {
          // Anything but "already exists" leaves the schema short of what the
          // checkout code reads, so fail the migration (and the db:migrate chain).
          throw err;
        }
      }
    }

    // Add currency columns to financial_events
    const feColumns = [
      'currency CHAR(3) NOT NULL DEFAULT \'GHS\' AFTER amount',
      'exchangeRate DECIMAL(12,6) NULL AFTER currency',
    ];

    for (const col of feColumns) {
      try {
        await connection.execute(`ALTER TABLE financial_events ADD COLUMN ${col}`);
        console.log(` Added financial_events.${col.split(' ')[0]}`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(` financial_events.${col.split(' ')[0]} already exists`);
        } else {
          // Anything but "already exists" leaves the schema short of what the
          // checkout code reads, so fail the migration (and the db:migrate chain).
          throw err;
        }
      }
    }

    // Add index for currency lookups
    try {
      await connection.execute(`CREATE INDEX idx_orders_currency ON orders (currency)`);
      console.log(' Added idx_orders_currency');
    } catch (err) {
      if (err.code !== 'ER_DUP_KEYNAME') throw err;
    }

    console.log('✅ International order currency columns added');
  } finally {
    connection.release();
  }
};

// Reverse of up(). `DROP COLUMN/INDEX IF EXISTS` is not valid on MySQL 8, so
// existence is checked in information_schema; the index goes before the
// column it covers. Every column dropped here was added by up() on this
// branch. Only run from a reviewed rollback, never automatically.
const down = async () => {
  const connection = await pool.getConnection();
  /** @param {string} sql @param {any[]} params */
  const exists = async (sql, params) => {
    const [rows] = await connection.execute(sql, params);
    return /** @type {any[]} */ (rows).length > 0;
  };
  try {
    if (await exists(
      `SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND INDEX_NAME = 'idx_orders_currency' LIMIT 1`, [])) {
      await connection.execute(`DROP INDEX idx_orders_currency ON orders`);
    }
    const drops = [
      ['orders', 'currency'], ['orders', 'exchangeRate'], ['orders', 'originalCurrency'], ['orders', 'originalAmount'],
      ['escrow_allocations', 'currency'], ['escrow_allocations', 'exchangeRate'],
      ['financial_events', 'currency'], ['financial_events', 'exchangeRate'],
    ];
    for (const [table, column] of drops) {
      if (await exists(
        `SELECT 1 FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`, [table, column])) {
        await connection.execute(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      }
    }
    console.log('✅ International order currency columns removed');
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