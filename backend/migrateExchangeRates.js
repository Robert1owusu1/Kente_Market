// @ts-check
// FILE: backend/migrateExchangeRates.js
// DESCRIPTION: Add exchange_rates table for historical currency conversion
// rates. Rates are stored per day to preserve audit integrity.
// Never recalculate a historical transaction using today's rate.
import pool from './config/db.js';

const up = async () => {
  const connection = await pool.getConnection();
  try {
    // Create exchange_rates table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS exchange_rates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        baseCurrency CHAR(3) NOT NULL DEFAULT 'GHS' COMMENT 'Base currency (platform currency)',
        targetCurrency CHAR(3) NOT NULL COMMENT 'Target currency (customer currency)',
        rate DECIMAL(12,6) NOT NULL COMMENT '1 base = X target (e.g., 1 GHS = 0.054 GBP)',
        source VARCHAR(50) NOT NULL DEFAULT 'manual' COMMENT 'manual, api, paystack, bank',
        effectiveDate DATE NOT NULL COMMENT 'Date this rate applies to',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_exchange_rate (baseCurrency, targetCurrency, effectiveDate),
        INDEX idx_er_date (effectiveDate),
        INDEX idx_er_currencies (baseCurrency, targetCurrency)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log('✅ exchange_rates table created');

    // Seed initial rates for supported currencies (approximate rates as of 2024)
    // These are just seed values; production should use a real FX API
    const today = new Date().toISOString().split('T')[0];
    const rates = [
      { base: 'GHS', target: 'GHS', rate: 1.0 },
      { base: 'GHS', target: 'GBP', rate: 0.054 },
      { base: 'GHS', target: 'USD', rate: 0.068 },
      { base: 'GHS', target: 'CAD', rate: 0.092 },
      { base: 'GHS', target: 'EUR', rate: 0.063 },
    ];

    for (const r of rates) {
      await connection.execute(
        `INSERT IGNORE INTO exchange_rates (baseCurrency, targetCurrency, rate, source, effectiveDate) VALUES (?, ?, ?, 'manual', ?)`,
        [r.base, r.target, r.rate, today]
      );
    }

    console.log('✅ Initial exchange rates seeded');
  } finally {
    connection.release();
  }
};

const down = async () => {
  const connection = await pool.getConnection();
  try {
    await connection.execute('DROP TABLE IF EXISTS exchange_rates');
    console.log('✅ exchange_rates table dropped');
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