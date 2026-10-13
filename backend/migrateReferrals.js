// @ts-check
// FILE LOCATION: backend/migrateReferrals.js
// DESCRIPTION: Referral (ambassador) commission system + per-order commission
//              snapshot (REFERRAL_SYSTEM_DESIGN.md §4). Additive only: new
//              tables, new nullable/defaulted columns, seeded settings that keep
//              the feature OFF until an admin sets a rate. Idempotent (every
//              step is guarded by information_schema); fails loudly (exit 1).
// Run from backend/:  node migrateReferrals.js
import pool from './config/db.js';

/** @param {string} table @param {string} column */
const columnExists = async (table, column) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return /** @type {any[]} */ (rows).length > 0;
};
/** @param {string} table @param {string} index */
const indexExists = async (table, index) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index]
  );
  return /** @type {any[]} */ (rows).length > 0;
};
/** @param {string} table @param {string} column @param {string} ddl */
const addColumn = async (table, column, ddl) => {
  if (await columnExists(table, column)) return;
  await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  console.log(` Added ${table}.${column}`);
};
/** @param {string} table @param {string} index @param {string} ddl */
const addIndex = async (table, index, ddl) => {
  if (await indexExists(table, index)) return;
  await pool.query(`ALTER TABLE ${table} ADD ${ddl}`);
  console.log(` Added index ${table}.${index}`);
};

try {
  // Per-order commission snapshot (P, r, F, Da, Ds per line) frozen at allocation.
  await addColumn('orders', 'commissionSnapshot', 'JSON NULL');
  // Keyed hash of the paying card/MoMo (never the raw value): referral abuse signal.
  await addColumn('orders', 'paymentInstrumentHash', 'CHAR(64) NULL');
  await addIndex('orders', 'idx_orders_instrument_hash', 'INDEX idx_orders_instrument_hash (paymentInstrumentHash)');

  // Ambassador fields on users.
  await addColumn('users', 'referralCode', 'VARCHAR(16) NULL');
  await addIndex('users', 'uq_users_referral_code', 'UNIQUE INDEX uq_users_referral_code (referralCode)');
  await addColumn('users', 'referredBy', 'INT NULL');
  await addIndex('users', 'idx_users_referred_by', 'INDEX idx_users_referred_by (referredBy)');
  await addColumn('users', 'referredAt', 'DATETIME NULL');
  await addColumn('users', 'ambassadorTier', `ENUM('standard','super') NOT NULL DEFAULT 'standard'`);
  await addColumn('users', 'ambassadorRate', 'DECIMAL(5,4) NULL');
  await addColumn('users', 'ambassadorSuspended', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('users', 'emailCanonical', 'VARCHAR(255) NULL');
  await addIndex('users', 'idx_users_email_canonical', 'INDEX idx_users_email_canonical (emailCanonical)');
  await addColumn('users', 'signupIpHash', 'CHAR(64) NULL');
  await addColumn('users', 'referralRecipientCode', 'VARCHAR(100) NULL');
  await addColumn('users', 'referralRecipientLabel', 'VARCHAR(120) NULL');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_devices (
      userId INT NOT NULL,
      deviceHash CHAR(64) NOT NULL,
      firstSeenAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      lastSeenAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (userId, deviceHash),
      INDEX idx_user_devices_hash (deviceHash)
    ) ENGINE=InnoDB`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_commissions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      orderId INT NOT NULL,
      referrerId INT NOT NULL,
      customerId INT NOT NULL,
      base DECIMAL(12,2) NOT NULL COMMENT 'sum of list value P of the order lines',
      rate DECIMAL(5,4) NOT NULL COMMENT 'referrer rate frozen at qualification',
      cap DECIMAL(12,2) NOT NULL COMMENT 'sum of (F - Da): platform commission left after admin coupon',
      amount DECIMAL(12,2) NOT NULL COMMENT 'original commission',
      currentAmount DECIMAL(12,2) NOT NULL COMMENT 'after refund adjustments',
      creditedAmount DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'net amount booked to the wallet',
      status ENUM('pending','under_review','available','cancelled','reversed') NOT NULL DEFAULT 'pending',
      reviewReasons JSON NULL,
      reviewedBy INT NULL,
      reviewedAt DATETIME NULL,
      reviewNote VARCHAR(1000) NULL,
      availableAt DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_referral_commission_order (orderId),
      INDEX idx_referral_commission_referrer (referrerId, status),
      INDEX idx_referral_commission_status (status, created_at)
    ) ENGINE=InnoDB`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_wallets (
      userId INT PRIMARY KEY,
      balance DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'spendable/withdrawable; negative = debt from reversals',
      reserved DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'held by in-flight withdrawals',
      totalEarned DECIMAL(12,2) NOT NULL DEFAULT 0,
      totalWithdrawn DECIMAL(12,2) NOT NULL DEFAULT 0,
      totalSpent DECIMAL(12,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_ledger (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      type ENUM('earn','reverse','withdraw_reserve','withdraw_paid','withdraw_return','spend') NOT NULL,
      amount DECIMAL(12,2) NOT NULL COMMENT 'signed effect on balance',
      commissionId INT NULL,
      orderId INT NULL,
      withdrawalId INT NULL,
      dedupeKey VARCHAR(128) NOT NULL,
      note VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_referral_ledger_dedupe (dedupeKey),
      INDEX idx_referral_ledger_user (userId, created_at)
    ) ENGINE=InnoDB`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_withdrawals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      currency CHAR(3) NOT NULL DEFAULT 'GHS',
      reference VARCHAR(80) NOT NULL,
      idempotencyKey VARCHAR(80) NOT NULL,
      recipientCode VARCHAR(100) NOT NULL,
      status ENUM('processing','paid','failed','reconciliation_required') NOT NULL DEFAULT 'processing',
      providerStatus VARCHAR(40) NULL,
      providerTransferCode VARCHAR(100) NULL,
      lastError VARCHAR(500) NULL,
      checkCount INT NOT NULL DEFAULT 0,
      lastCheckedAt TIMESTAMP NULL,
      settledAt TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_referral_withdrawal_ref (reference),
      UNIQUE KEY uq_referral_withdrawal_idem (userId, idempotencyKey),
      INDEX idx_referral_withdrawal_status (status, lastCheckedAt)
    ) ENGINE=InnoDB`);

  // Feature stays OFF until an admin sets a rate and enables it.
  for (const [key, value, type] of [
    ['referral.enabled', 'false', 'boolean'],
    ['referral.standardRate', '', 'number'],
    ['referral.windowDays', '30', 'number'],
  ]) {
    await pool.query(
      `INSERT IGNORE INTO settings (settingKey, settingValue, settingType) VALUES (?, ?, ?)`,
      [key, value, type]
    );
  }

  console.log('✅ referral schema ready');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`❌ migrateReferrals failed: ${/** @type {any} */ (err).message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
