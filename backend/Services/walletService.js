// SERVICES/walletService.js
// Vendor wallet: funds released from escrow (customer confirmed delivery) are
// credited to the vendor's available balance *instead of* being auto-transferred.
// The vendor draws down the balance manually via a withdrawal.
import pool from '../config/db.js';
import { round2 } from '../../shared/pricing.js';

/**
 * Ensure a vendor wallet row exists (lazy-create).
 */
export const ensureWallet = async (vendorId) => {
  await pool.execute(
    `INSERT IGNORE INTO vendor_wallets (vendorId)
     VALUES (?)`,
    [vendorId]
  );
  const [rows] = await pool.execute(
    `SELECT * FROM vendor_wallets WHERE vendorId = ?`,
    [vendorId]
  );
  return rows[0];
};

/**
 * Get a vendor's wallet balance (lazy-creating the row).
 */
export const getWallet = async (vendorId) => {
  return ensureWallet(vendorId);
};

/**
 * Credit a vendor's available balance when an escrow allocation becomes
 * available (customer confirmed delivery). Idempotent per allocation.
 */
export const creditVendorBalance = async (vendorId, allocationId, payoutAmount, orderNumber) => {
  await ensureWallet(vendorId);
  const [existing] = await pool.execute(
    `SELECT id FROM wallet_transactions
     WHERE vendorId = ? AND allocationId = ? AND type = 'credit'`,
    [vendorId, allocationId]
  );
  if (existing.length > 0) return false; // already credited

  const amount = round2(parseFloat(payoutAmount) || 0);
  await pool.execute(
    `UPDATE vendor_wallets
     SET available_balance = available_balance + ?,
         total_earned = total_earned + ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE vendorId = ?`,
    [amount, amount, vendorId]
  );
  await pool.execute(
    `INSERT INTO wallet_transactions (vendorId, type, amount, allocationId, note, status)
     VALUES (?, 'credit', ?, ?, ?, 'succeeded')`,
    [vendorId, amount, allocationId, `Escrow release for order ${orderNumber || ''}`.trim()]
  );
  return true;
};

/**
 * Debit a vendor's available balance after a successful withdrawal.
 */
export const debitVendorBalance = async (vendorId, amount, reference, note) => {
  const amt = round2(parseFloat(amount) || 0);
  if (amt <= 0) throw new Error('Withdrawal amount must be positive');
  await pool.execute(
    `UPDATE vendor_wallets
     SET available_balance = available_balance - ?,
         total_withdrawn = total_withdrawn + ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE vendorId = ? AND available_balance >= ?`,
    [amt, amt, vendorId, amt]
  );
  await pool.execute(
    `INSERT INTO wallet_transactions (vendorId, type, amount, reference, note, status)
     VALUES (?, 'withdrawal', ?, ?, ?, 'succeeded')`,
    [vendorId, amt, reference, note || 'Withdrawal']
  );
};
