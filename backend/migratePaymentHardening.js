// FILE LOCATION: backend/migratePaymentHardening.js
// DESCRIPTION: Payment-integrity migration (audit 2026-09-24). Additive and
//              idempotent — never drops or disturbs existing data beyond
//              normalizing duplicate/blank payment references so the UNIQUE
//              key can be created.
//   - escrow_allocations.reason: the column voidEscrowForOrder/clawback has
//     written since the clawback feature landed — it never existed in the
//     schema, so every clawback UPDATE failed with ER_BAD_FIELD_ERROR BEFORE
//     any money could be recovered (customer refunded, vendor kept the
//     advance). The catch swallowed it as "manual recovery needed".
//   - wallet_transactions.type gains 'clawback' so clawbackVendorBalance can
//     actually insert its ledger row under strict SQL mode.
//   - orders.paymentReference becomes UNIQUE: one Paystack charge must never
//     be able to mark two orders paid. Blanks are normalized to NULL (MySQL
//     unique keys allow many NULLs) and pre-existing duplicates are suffixed
//     with `_dup<id>` (keeping the lowest id authoritative) so forensic data
//     is preserved but only ONE order can ever match the real reference.
// Run from backend/:  node migratePaymentHardening.js
// (included in `npm run db:migrate`)
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
  multipleStatements: true,
});

const colExists = async (table, column) => {
  const [[res]] = await connection.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return !!(res && res.c > 0);
};

const tableExists = async (table) => {
  const [[res]] = await connection.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return !!(res && res.c > 0);
};

const indexExists = async (table, indexName) => {
  const [[res]] = await connection.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  );
  return !!(res && res.c > 0);
};

try {
  // ============================================================
  // 1. escrow_allocations.reason — required by the clawback/void SQL
  // ============================================================
  if (await tableExists('escrow_allocations')) {
    if (!(await colExists('escrow_allocations', 'reason'))) {
      await connection.query(
        `ALTER TABLE escrow_allocations ADD COLUMN reason VARCHAR(255) NULL
         COMMENT 'Why the allocation is failed/voided (clawback, no payout, ...)'`
      );
      console.log('✅ Added escrow_allocations.reason (clawback/void bookkeeping)');
    } else {
      console.log('ℹ️  escrow_allocations.reason already exists — skipping');
    }
  }

  // ============================================================
  // 2. wallet_transactions.type gains 'clawback'
  // ============================================================
  if (await tableExists('wallet_transactions')) {
    const [[enumRow]] = await connection.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wallet_transactions'
         AND COLUMN_NAME = 'type'`
    );
    const currentType = enumRow ? (enumRow.COLUMN_TYPE || '') : '';
    if (currentType && currentType.indexOf('clawback') === -1) {
      const newType = currentType.replace(/\)$/, `,'clawback')`);
      await connection.query(`ALTER TABLE wallet_transactions MODIFY type ${newType}`);
      console.log('✅ Extended wallet_transactions.type with clawback');
    } else {
      console.log('ℹ️  wallet_transactions.type already knows clawback — skipping');
    }
  }

  // ============================================================
  // 3. orders.paymentReference UNIQUE — one charge, one order
  // ============================================================
  if (await tableExists('orders')) {
    if (!(await indexExists('orders', 'uq_orders_paymentReference'))) {
      // Blank strings would all collide under a UNIQUE key (only NULLs are
      // exempt), so normalize them first.
      await connection.query(
        `UPDATE orders SET paymentReference = NULL WHERE paymentReference = ''`
      );
      // Pre-existing duplicates: keep the lowest id on the original value and
      // suffix the rest so they remain visible for support/forensics but can
      // never be matched by a webhook or verify call again.
      const [dupes] = await connection.query(
        `SELECT paymentReference, MIN(id) AS keepId
         FROM orders
         WHERE paymentReference IS NOT NULL
         GROUP BY paymentReference
         HAVING COUNT(*) > 1`
      );
      if (Array.isArray(dupes) && dupes.length > 0) {
        for (const d of dupes) {
          await connection.query(
            `UPDATE orders
             SET paymentReference = CONCAT(paymentReference, '_dup', id)
             WHERE paymentReference = ? AND id <> ?`,
            [d.paymentReference, d.keepId]
          );
        }
        console.log(`⚠️  Disambiguated ${dupes.length} duplicated payment reference(s) (kept lowest id)`);
      }
      await connection.query(
        `ALTER TABLE orders ADD UNIQUE KEY uq_orders_paymentReference (paymentReference)`
      );
      console.log('✅ Added UNIQUE KEY uq_orders_paymentReference (one charge → one order)');
    } else {
      console.log('ℹ️  uq_orders_paymentReference already exists — skipping');
    }
  }

  console.log('✅ Payment hardening migration complete');
} catch (err) {
  console.error('❌ Payment hardening migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await connection.end();
}
