// @ts-check
// FILE LOCATION: backend/migratePayoutLifecycle.js
// DESCRIPTION: Schema for the vendor payout lifecycle redesign (R-8, see
//              PAYOUT_LIFECYCLE_DESIGN.md). Additive and idempotent:
//   - payout_attempts.status gains 'reconciliation_required' (appended enum
//     member — existing values and their order are unchanged);
//   - payout_attempts gains evidence/reconciliation columns (all nullable or
//     defaulted, so existing rows stay valid);
//   - index (status, lastCheckedAt) for the bounded, rotating reconciler scan;
//   - vendor_withdrawals: one row per vendor withdrawal request (idempotency
//     key + stable internal id). No status column: status is derived from the
//     request's payout_attempts.
// Unlike most older migrations this one FAILS LOUDLY (exit 1) — a silently
// skipped statement here would leave the new payout code without its columns.
// Run from backend/:  node migratePayoutLifecycle.js
import pool from './config/db.js';

/** @param {string} table @param {string} column */
const colExists = async (table, column) => {
  const [rows] = /** @type {any} */ (await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  ));
  return rows.length > 0;
};

/** @param {string} table @param {string} index */
const indexExists = async (table, index) => {
  const [rows] = /** @type {any} */ (await pool.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, index]
  ));
  return rows.length > 0;
};

const ATTEMPT_COLUMNS = [
  ['currency', `CHAR(3) NOT NULL DEFAULT 'GHS'`],
  ['amountMinor', `BIGINT NULL COMMENT 'amount sent to the provider, in pesewas'`],
  ['withdrawalId', `BIGINT NULL COMMENT 'vendor_withdrawals.id that created this attempt'`],
  ['initiatedAt', `TIMESTAMP NULL COMMENT 'provider acknowledged POST /transfer'`],
  ['initiateHttpStatus', `SMALLINT NULL COMMENT 'HTTP status of a failed initiate call, if any'`],
  ['providerStatus', `VARCHAR(32) NULL COMMENT 'last status reported by provider verify/webhook'`],
  ['checkCount', `INT NOT NULL DEFAULT 0`],
  ['lastCheckedAt', `TIMESTAMP NULL`],
  ['reviewReason', `VARCHAR(255) NULL COMMENT 'why automation stopped (reconciliation_required) or what is pending'`],
  ['alertedReason', `VARCHAR(64) NULL`],
  ['alertedAt', `TIMESTAMP NULL`],
  ['resolutionNote', `VARCHAR(1000) NULL`],
  ['resolvedBy', `INT NULL`],
  ['resolvedAt', `TIMESTAMP NULL`],
];

try {
  const [[tbl]] = /** @type {any} */ (await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payout_attempts'`
  ));
  if (!tbl.c) throw new Error('payout_attempts does not exist — run migrateMarketplace.js first');

  const [[statusCol]] = /** @type {any} */ (await pool.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payout_attempts' AND COLUMN_NAME = 'status'`
  ));
  if (!String(statusCol.t).includes("'reconciliation_required'")) {
    await pool.query(
      `ALTER TABLE payout_attempts MODIFY COLUMN status
         ENUM('processing','succeeded','failed','reversed','reconciliation_required')
         NOT NULL DEFAULT 'processing'`
    );
    console.log(" payout_attempts.status: added 'reconciliation_required'");
  } else {
    console.log(" payout_attempts.status already has 'reconciliation_required'");
  }

  for (const [name, ddl] of ATTEMPT_COLUMNS) {
    if (await colExists('payout_attempts', name)) {
      console.log(` payout_attempts.${name} already exists`);
      continue;
    }
    await pool.query(`ALTER TABLE payout_attempts ADD COLUMN ${name} ${ddl}`);
    console.log(` Added payout_attempts.${name}`);
  }

  for (const [name, cols] of [['idx_payout_lifecycle', '(status, lastCheckedAt)'], ['idx_payout_withdrawal', '(withdrawalId)']]) {
    if (await indexExists('payout_attempts', name)) {
      console.log(` ${name} already exists`);
      continue;
    }
    await pool.query(`CREATE INDEX ${name} ON payout_attempts ${cols}`);
    console.log(` Added ${name}`);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendor_withdrawals (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      vendorId INT NOT NULL,
      requestKey VARCHAR(64) NULL COMMENT 'client idempotency key, unique per vendor',
      amountMinor BIGINT NOT NULL COMMENT 'requested amount in pesewas',
      currency CHAR(3) NOT NULL DEFAULT 'GHS',
      requestedBy INT NULL COMMENT 'staff id when a staff member made the request',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_vendor_withdrawal_request (vendorId, requestKey),
      INDEX idx_vendor_withdrawals_vendor (vendorId, created_at),
      FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB`);
  console.log(' vendor_withdrawals ready');

  console.log('✅ Payout lifecycle schema ready');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`❌ migratePayoutLifecycle failed: ${err.message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
