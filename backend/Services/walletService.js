// @ts-check
// SERVICES/walletService.js
// Vendor wallet: funds released from escrow (customer confirmed delivery) are
// credited to the vendor's available balance *instead of* being auto-transferred.
// The vendor draws down the balance manually via a withdrawal.
import pool from '../config/db.js';
import { round2 } from '../../shared/pricing.js';
import { recordFinancialEvent } from './ledgerService.js';

/**
 * Ensure a vendor wallet row exists (lazy-create).
 * @param {number | string} vendorId - vendor user id
 * @returns {Promise<{ vendorId?: number; available_balance?: number; total_earned?: number; total_withdrawn?: number } | undefined>}
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
 * @param {number | string} vendorId - vendor user id
 * @returns {Promise<{ vendorId?: number; available_balance?: number; total_earned?: number; total_withdrawn?: number } | undefined>}
 */
export const getWallet = async (vendorId) => {
  return ensureWallet(vendorId);
};

/**
 * Credit a vendor's available balance when an escrow allocation becomes
 * available (customer confirmed delivery). Idempotent per allocation.
 * @param {number | string} vendorId - vendor user id
 * @param {number | string} allocationId - escrow allocation id
 * @param {number | string} payoutAmount - amount to credit (GHS)
 * @param {string | undefined} orderNumber - human-friendly order ref for the note
 * @returns {Promise<boolean>} true if credited, false if already credited
 */
export const creditVendorBalance = async (vendorId, allocationId, payoutAmount, orderNumber) => {
  const amount = round2(parseFloat(String(payoutAmount)) || 0);
  if (amount <= 0) throw new Error('Escrow credit amount must be positive');

  // The ledger insert is the idempotency gate.  Do not do a SELECT followed by
  // an UPDATE: two delivery-release workers can otherwise both credit the same
  // allocation. uq_wallet_credit_allocation makes this durable at the DB layer.
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(`INSERT IGNORE INTO vendor_wallets (vendorId) VALUES (?)`, [vendorId]);
    const [ledger] = await connection.execute(
      `INSERT IGNORE INTO wallet_transactions (vendorId, type, amount, allocationId, note, status)
       VALUES (?, 'credit', ?, ?, ?, 'succeeded')`,
      [vendorId, amount, allocationId, `Escrow release for order ${orderNumber || ''}`.trim()]
    );
    if (ledger.affectedRows !== 1) {
      await connection.rollback();
      return false;
    }
    await connection.execute(
      `UPDATE vendor_wallets
       SET available_balance = available_balance + ?, total_earned = total_earned + ?,
           updated_at = CURRENT_TIMESTAMP WHERE vendorId = ?`,
      [amount, amount, vendorId]
    );
    await connection.commit();

    // Immutable audit event for this release (idempotent per allocation).
    try {
      await recordFinancialEvent({
        eventType: 'escrow.release',
        direction: 'info',
        amount,
        vendorId,
        allocationId,
        reference: allocationId != null ? `escrow.release:${allocationId}` : undefined,
        dedupeKey: `escrow.release:${allocationId}`,
        payload: { orderNumber: orderNumber || null },
      });
    } catch { /* journal is best-effort; the unique key already guards the credit */ }

    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Debit a vendor's available balance after a successful withdrawal.
 * @param {number | string} vendorId - vendor user id
 * @param {number | string} amount - amount to debit (GHS), must be > 0
 * @param {string} reference - payment/transaction reference
 * @param {string} [note] - transaction note
 * @returns {Promise<boolean>} true if the debit was applied
 */
export const debitVendorBalance = async (vendorId, amount, reference, note) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const debited = await debitVendorBalanceInTransaction(connection, vendorId, amount, reference, note);
    await connection.commit();
    return debited;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Transaction-scoped debit used by transfer settlement so the payout_attempt
 * claim, the wallet debit and the journal entry commit atomically.
 * @param {any} connection
 * @param {number | string} vendorId
 * @param {number | string} amount
 * @param {string} reference
 * @param {string} [note]
 * @returns {Promise<boolean>} true if the debit was applied
 */
export const debitVendorBalanceInTransaction = async (connection, vendorId, amount, reference, note) => {
  const amt = round2(parseFloat(String(amount)) || 0);
  if (amt <= 0) throw new Error('Withdrawal amount must be positive');
  // A transfer webhook can be redelivered. The reference is globally unique
  // in the payout-attempt table and is also the withdrawal-ledger key
  // (uq_wallet_withdrawal_reference (type, reference)).
  const [alreadyDebited] = await connection.execute(
    `SELECT id FROM wallet_transactions WHERE type = 'withdrawal' AND reference = ? FOR UPDATE`,
    [reference]
  );
  if (alreadyDebited.length > 0) {
    return false;
  }
  const [debit] = await connection.execute(
    `UPDATE vendor_wallets SET available_balance = available_balance - ?,
        total_withdrawn = total_withdrawn + ?, updated_at = CURRENT_TIMESTAMP
     WHERE vendorId = ? AND available_balance >= ?`,
    [amt, amt, vendorId, amt]
  );
  if (debit.affectedRows !== 1) {
    throw new Error('Insufficient available balance while recording withdrawal');
  }
  await connection.execute(
    `INSERT INTO wallet_transactions (vendorId, type, amount, reference, note, status)
     VALUES (?, 'withdrawal', ?, ?, ?, 'succeeded')`,
    [vendorId, amt, reference, note || 'Withdrawal']
  );
  // Immutable audit event for this withdrawal (idempotent per reference).
  await recordFinancialEvent({
    connection,
    eventType: 'wallet.withdrawal',
    direction: 'out',
    amount: amt,
    vendorId,
    reference,
    dedupeKey: `wallet.withdrawal:${reference}`,
    payload: { note: note || null },
  });
  return true;
};

/**
 * Credit a vendor's available balance after a Paystack transfer was reversed
 * (the money has returned to the platform). Must be called inside the payer's
 * transaction so the payout_attempt claim, allocation restore and wallet
 * credit commit atomically.
 *
 * Idempotency: one reversal row per (vendor, transfer reference). Reversal rows
 * deliberately keep `allocationId = NULL` so the pre-existing
 * `uq_wallet_credit_allocation (vendorId, allocationId, type)` key — which must
 * allow many withdrawals per allocation — never collides, and a *second* payout
 * of the same allocation that is subsequently reversed can be credited again.
 * Redelivery of the same reversal is stopped upstream by the payout_attempt
 * status guard (succeeded -> reversed) inside the same transaction.
 * @param {{
 *   connection: any,
 *   vendorId: number | string,
 *   allocationId: number | string,
 *   amount: number | string,
 *   reference: string,
 *   note?: string,
 * }} param0
 * @returns {Promise<boolean>} true if a new reversal credit was applied
 */
export const reversalCreditVendorBalance = async ({
  connection,
  vendorId,
  allocationId,
  amount,
  reference,
  note,
}) => {
  const amt = round2(parseFloat(String(amount)) || 0);
  if (amt <= 0) throw new Error('Reversal credit amount must be positive');

  await connection.execute(`INSERT IGNORE INTO vendor_wallets (vendorId) VALUES (?)`, [vendorId]);
  // MySQL unique keys treat NULLs as distinct, so the (vendorId, allocationId,
  // type) allocation-uniqueness key is not tripped by reversal rows.
  const [ledger] = await connection.execute(
    `INSERT IGNORE INTO wallet_transactions (vendorId, type, amount, allocationId, reference, note, status)
     VALUES (?, 'reversal', ?, NULL, ?, ?, 'succeeded')`,
    [vendorId, amt, reference, note || 'Transfer reversal (funds returned to platform)']
  );
  if (ledger.affectedRows !== 1) {
    return false;
  }
  await connection.execute(
    `UPDATE vendor_wallets
     SET available_balance = available_balance + ?, updated_at = CURRENT_TIMESTAMP
     WHERE vendorId = ?`,
    [amt, vendorId]
  );
  // Written inside the caller's transaction for atomicity with the claim.
  await recordFinancialEvent({
    connection,
    eventType: 'wallet.reversal',
    direction: 'in',
    amount: amt,
    vendorId,
    allocationId,
    reference,
    dedupeKey: `escrow.reversal:${reference}`,
    payload: { note: note || null },
  });
  return true;
};
