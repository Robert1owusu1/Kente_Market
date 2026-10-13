// @ts-check
// FILE LOCATION: backend/migratePaymentProcessingState.js
// DESCRIPTION: Adds payment processing state tracking and platform revenue gross/net accounting
// Run from backend/:  node migratePaymentProcessingState.js
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { mysqlTls } from './config/mysqlTls.js';

dotenv.config();

// mysql2's bundled typings do not resolve createConnection for this file's
// module mode (runtime export verified); cast only the import, not the result.
const connection = await /** @type {any} */ (mysql).createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  ssl: mysqlTls(),
  multipleStatements: true,
});

/** @param {string} table @param {string} column */
const colExists = async (table, column) => {
  const [[res]] = await connection.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return !!(res && res.c > 0);
};

try {
  // ============================================================
  // 1. ORDERS: paymentSideEffects JSON column for F-1
  // ============================================================
  if (!(await colExists('orders', 'paymentSideEffects'))) {
    await connection.query(
      `ALTER TABLE orders ADD COLUMN paymentSideEffects JSON NULL COMMENT 'Tracks completion of post-payment side effects: escrowHeld, stockDecremented, couponConsumed, financialEventRecorded, platformRevenueTracked'`
    );
    console.log(' Added orders.paymentSideEffects column');
  } else {
    console.log(' orders.paymentSideEffects already exists — skipping');
  }

  // ============================================================
  // 2. PLATFORM_REVENUE: gross/net accounting for F-5
  // ============================================================
  if (!(await colExists('platform_revenue', 'grossAmount'))) {
    await connection.query(
      `ALTER TABLE platform_revenue ADD COLUMN grossAmount DECIMAL(12,2) NULL COMMENT 'Gross amount before discount'`
    );
    console.log(' Added platform_revenue.grossAmount column');
  } else {
    console.log(' platform_revenue.grossAmount already exists — skipping');
  }

  if (!(await colExists('platform_revenue', 'discountAmount'))) {
    await connection.query(
      `ALTER TABLE platform_revenue ADD COLUMN discountAmount DECIMAL(12,2) NULL COMMENT 'Discount apportioned to platform items'`
    );
    console.log(' Added platform_revenue.discountAmount column');
  } else {
    console.log(' platform_revenue.discountAmount already exists — skipping');
  }

  // Backfill existing platform_revenue rows: grossAmount = amount (old net), discountAmount = 0
  // This preserves historical interpretation while enabling new net tracking
  await connection.query(
    `UPDATE platform_revenue SET grossAmount = amount, discountAmount = 0 WHERE grossAmount IS NULL`
  );
  console.log(' Backfilled platform_revenue grossAmount/discountAmount for existing rows');

  // ============================================================
  // 3. Index for recovery job queries
  // ============================================================
  // MySQL cannot index a JSON column directly (the previous attempt here
  // always failed and was swallowed). The recovery scan filters on
  // paymentStatus and is bounded by LIMIT, so the existing paymentStatus
  // index covers it; no JSON index is needed.

  console.log(' Payment processing state migration complete');
} catch (err) {
  console.error(' Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await connection.end();
}