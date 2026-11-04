// @ts-check
// FILE LOCATION: backend/migrateGiftCards.js
// DESCRIPTION: Gift cards + store credit (Phase 3, Step 7). A buyer pays for a
//   gift card (Paystack); on payment a code is issued and emailed to the
//   recipient. Redeeming the code tops up the recipient's SPEND-ONLY store
//   credit (never withdrawable to cash), which pays a whole order the same way
//   referral earnings do. Additive; idempotent; fails loudly.
// Run from backend/:  node migrateGiftCards.js
import pool from './config/db.js';

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gift_cards (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(32) NULL COMMENT 'issued on successful payment',
      initialAmount DECIMAL(12,2) NOT NULL,
      balance DECIMAL(12,2) NOT NULL COMMENT 'card face value until redeemed to a wallet',
      currency CHAR(3) NOT NULL DEFAULT 'GHS',
      status ENUM('pending_payment','active','redeemed','disabled') NOT NULL DEFAULT 'pending_payment',
      purchaserUserId INT NULL,
      recipientEmail VARCHAR(255) NULL,
      message VARCHAR(500) NULL,
      purchaseReference VARCHAR(80) NOT NULL COMMENT 'our Paystack init reference',
      redeemedByUserId INT NULL,
      issuedAt DATETIME NULL,
      redeemedAt DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_gift_card_code (code),
      UNIQUE KEY uq_gift_card_purchase_ref (purchaseReference),
      INDEX idx_gift_card_status (status),
      CONSTRAINT fk_gift_purchaser FOREIGN KEY (purchaserUserId) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_gift_redeemer FOREIGN KEY (redeemedByUserId) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB`);

  // Spend-only store credit (gift-card redemptions land here). NOT withdrawable.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS store_credit_wallets (
      userId INT PRIMARY KEY,
      balance DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'spendable store credit',
      totalReceived DECIMAL(12,2) NOT NULL DEFAULT 0,
      totalSpent DECIMAL(12,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_sc_wallet_user FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS store_credit_transactions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      type ENUM('redeem','spend','reverse') NOT NULL,
      amount DECIMAL(12,2) NOT NULL COMMENT 'signed effect on balance',
      giftCardId INT NULL,
      orderId INT NULL,
      dedupeKey VARCHAR(128) NOT NULL,
      note VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_sc_txn_dedupe (dedupeKey),
      INDEX idx_sc_txn_user (userId, created_at)
    ) ENGINE=InnoDB`);

  console.log('✅ gift card + store credit schema ready');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`❌ migrateGiftCards failed: ${/** @type {any} */ (err).message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
