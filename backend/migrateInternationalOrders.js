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
          console.warn(` Could not add orders.${col.split(' ')[0]}: ${err.message}`);
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
          console.warn(` Could not add escrow_allocations.${col.split(' ')[0]}: ${err.message}`);
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
          console.warn(` Could not add financial_events.${col.split(' ')[0]}: ${err.message}`);
        }
      }
    }

    // Add index for currency lookups
    try {
      await connection.execute(`CREATE INDEX idx_orders_currency ON orders (currency)`);
      console.log(' Added idx_orders_currency');
    } catch (err) {
      if (err.code !== 'ER_DUP_KEYNAME') console.warn(` idx_orders_currency: ${err.message}`);
    }

    console.log('✅ International order currency columns added');
  } finally {
    connection.release();
  }
};

const down = async () => {
  const connection = await pool.getConnection();
  try {
    await connection.execute(`ALTER TABLE orders DROP COLUMN IF EXISTS currency`);
    await connection.execute(`ALTER TABLE orders DROP COLUMN IF EXISTS exchangeRate`);
    await connection.execute(`ALTER TABLE orders DROP COLUMN IF EXISTS originalCurrency`);
    await connection.execute(`ALTER TABLE orders DROP COLUMN IF EXISTS originalAmount`);
    await connection.execute(`ALTER TABLE escrow_allocations DROP COLUMN IF EXISTS currency`);
    await connection.execute(`ALTER TABLE escrow_allocations DROP COLUMN IF EXISTS exchangeRate`);
    await connection.execute(`ALTER TABLE financial_events DROP COLUMN IF EXISTS currency`);
    await connection.execute(`ALTER TABLE financial_events DROP COLUMN IF EXISTS exchangeRate`);
    await connection.execute(`DROP INDEX IF EXISTS idx_orders_currency ON orders`);
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