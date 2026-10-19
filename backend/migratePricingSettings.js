// migratePricingSettings.js - Money settings that used to be hard-coded.
// Run from backend/:  node migratePricingSettings.js   (part of npm run db:migrate)
//
//   settings.tax_rate               VAT in PERCENT (admin Settings page). Seeded
//                                   at Ghana's 15%; order pricing reads it.
//   settings.referral.minWithdrawal Minimum referral withdrawal in GHS (admin
//                                   Referrals page). Seeded at the design default 10.
//   custom_requests.priced*         The full price of a custom order (seller's
//                                   quote + VAT + delivery) is computed and SAVED
//                                   before payment, and the payment is checked
//                                   against that saved figure.
//   shipping_rates                  The seeded platform defaults were capped at
//                                   5 kg (abroad) / 30 kg (Ghana); heavier orders
//                                   fell through to a hard-coded fallback table
//                                   holding the SAME prices. That table is gone,
//                                   so the seeded defaults now cover any weight
//                                   (their per-kg cost is 0, so no price moves).
//
// Idempotent and data-safe: INSERT IGNORE never overwrites an operator's value;
// the weight update only touches the untouched seed rows.
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { mysqlTls } from './config/mysqlTls.js';

dotenv.config();

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  ssl: mysqlTls(),
});

try {
  for (const [key, value, type] of [
    ['tax_rate', '15', 'number'],
    ['referral.minWithdrawal', '10', 'number'],
  ]) {
    await connection.execute(
      `INSERT IGNORE INTO settings (settingKey, settingValue, settingType) VALUES (?, ?, ?)`,
      [key, value, type]
    );
  }
  console.log('✅ pricing settings present (tax_rate, referral.minWithdrawal)');

  for (const [col, def] of [
    ['pricedSubtotal', 'DECIMAL(10,2) NULL'],
    ['pricedTax', 'DECIMAL(10,2) NULL'],
    ['pricedShipping', 'DECIMAL(10,2) NULL'],
    ['pricedTotal', 'DECIMAL(10,2) NULL'],
    ['pricedCountry', 'CHAR(2) NULL'],
    ['pricedAt', 'DATETIME NULL'],
  ]) {
    const [[{ n }]] = await connection.execute(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_requests' AND COLUMN_NAME = ?`,
      [col]
    );
    if (!Number(n)) await connection.execute(`ALTER TABLE custom_requests ADD COLUMN ${col} ${def}`);
  }
  console.log('✅ custom_requests priced* columns present (custom-order VAT + delivery)');

  const [res] = await connection.execute(
    `UPDATE shipping_rates
        SET maxWeightKg = 999
      WHERE vendorId IS NULL AND destinationRegion IS NULL AND serviceLevel = 'standard'
        AND perKgCost = 0 AND minWeightKg = 0 AND maxWeightKg IN (5, 30)`
  );
  console.log(`✅ platform default shipping rates cover all weights (${res.affectedRows} seed row(s) updated)`);
} catch (err) {
  console.error('❌ migratePricingSettings failed:', err.message);
  process.exitCode = 1;
} finally {
  await connection.end();
}
