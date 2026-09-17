// FILE LOCATION: backend/migrateHardening.js
// DESCRIPTION: Production-hardening migration (Phase 1). Additive and
//              idempotent — never drops or disturbs existing data.
//   - financial_events: append-only immutable money journal (double-entry
//     complement to wallet_transactions). Every settlement, reversal, refund,
//     escrow release and payout writes a deterministic, DB-unique journal row.
//   - wallet_transactions.type gains 'reversal' so a Paystack transfer reversal
//     can return funds to the vendor's balance exactly once per allocation.
//   - wallet_transactions withdrawal idempotency keyed by (type, reference) so
//     concurrent / redelivered settlements can never double-debit the wallet.
//   - payout_attempts index and webhook reconciliation support columns for the
//     stuck-transfer scheduler.
// Run from backend/:  node migrateHardening.js
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
  // 1. APPEND-ONLY FINANCIAL JOURNAL
  // ============================================================
  if (!(await tableExists('financial_events'))) {
    await connection.query(`
      CREATE TABLE financial_events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        eventType VARCHAR(80) NOT NULL COMMENT 'charge.collected | refund | escrow.hold | escrow.release | payout.claimed | payout.succeeded | payout.failed | payout.reversed | wallet.credit | wallet.withdrawal | wallet.reversal',
        currency CHAR(3) NOT NULL DEFAULT 'GHS',
        amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        direction ENUM('in','out','info') NOT NULL DEFAULT 'info'
          COMMENT '"in"/"out" = platform cash effect; "info" = notional bookkeeping',
        vendorId INT NULL,
        orderId INT NULL,
        allocationId INT NULL,
        payoutAttemptId BIGINT NULL,
        reference VARCHAR(120) NULL COMMENT 'local business reference (payout/withdrawal ref)',
        providerReference VARCHAR(255) NULL COMMENT 'Paystack reference',
        dedupeKey VARCHAR(255) NULL COMMENT 'deterministic idempotency key, unique per financial action',
        payload JSON NULL COMMENT 'raw provider/webhook snapshot',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_fe_dedupe (dedupeKey),
        INDEX idx_fe_created (created_at),
        INDEX idx_fe_order (orderId),
        INDEX idx_fe_vendor (vendorId),
        INDEX idx_fe_allocation (allocationId),
        INDEX idx_fe_event (eventType)
      ) ENGINE=InnoDB`);
    console.log('✅ Created financial_events journal');
  } else {
    console.log('ℹ️  financial_events already exists — skipping');
  }

  // ============================================================
  // 2. WALLET LEDGER: 'reversal' TYPE + WITHDRAWAL IDEMPOTENCY
  // ============================================================
  if (await tableExists('wallet_transactions')) {
    const [[enumRow]] = await connection.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wallet_transactions'
         AND COLUMN_NAME = 'type'`
    );
    const currentType = enumRow ? (enumRow.COLUMN_TYPE || '') : '';
    // MySQL stores enum as e.g. enum('credit','withdrawal','fee')
    if (currentType && currentType.indexOf('reversal') === -1) {
      const newType = currentType.replace(/\)$/, ',\'reversal\')');
      await connection.query(`ALTER TABLE wallet_transactions MODIFY type ${newType}`);
      console.log('✅ Extended wallet_transactions.type with reversal');
    }

    if (!(await indexExists('wallet_transactions', 'uq_wallet_withdrawal_reference'))) {
      // MySQL unique keys permit multiple NULLs, so the many credit rows with
      // reference = NULL are untouched; only real withdrawals (which always
      // carry a reference) are constrained. This makes a redelivered or racing
      // transfer.success unable to debit the wallet twice for one payout.
      await connection.query(
        `ALTER TABLE wallet_transactions
         ADD UNIQUE KEY uq_wallet_withdrawal_reference (type, reference)`
      );
      console.log('✅ Added wallet_transactions withdrawal idempotency key');
    }
  }

  // ============================================================
  // 3. PAYOUT RECONCILIATION SUPPORT
  // ============================================================
  if (await tableExists('payout_attempts')) {
    if (!(await indexExists('payout_attempts', 'idx_payout_reconcile'))) {
      await connection.query(
        `ALTER TABLE payout_attempts
         ADD INDEX idx_payout_reconcile (status, created_at)`
      );
      console.log('✅ Added payout_attempts reconciliation index');
    }
  }

  console.log('✅ Hardening migration complete');
} catch (err) {
  console.error('❌ Hardening migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await connection.end();
}