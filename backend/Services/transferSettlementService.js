// @ts-check
// SERVICES/transferSettlementService.js
// Idempotent settlement of Paystack transfer events (success / failed /
// reversed). Used BOTH by the signed webhook handler and by the stuck-transfer
// reconciliation scheduler, so a settlement executes exactly once no matter
// which path triggers it.
//
// All three paths follow the same shape:
//   1. Resolve the payout_attempt by local reference (or provider reference).
//   2. Claim the attempt with a status guard (processing -> terminal) inside a
//      transaction. A claim that affects zero rows means "already settled".
//   3. Mutate the escrow allocation + wallet + immutable financial_events
//      journal atomically in the same transaction.
//   4. Recompute the order-level escrow status after commit.
import pool from '../config/db.js';
import { recordFinancialEvent } from './ledgerService.js';
import {
  debitVendorBalanceInTransaction,
  reversalCreditVendorBalance,
} from './walletService.js';
import {
  recomputeOrderEscrowStatus,
  notifyVendorPayoutFailure,
} from './escrowService.js';

/**
 * Resolve a payout attempt by Paystack transfer reference.
 * @param {string} transferRef
 * @returns {Promise<import('mysql2').RowDataPacket | undefined>}
 */
const findAttempt = async (transferRef) => {
  const [rows] = await pool.execute(
    `SELECT pa.*, ea.orderId
     FROM payout_attempts pa
     JOIN escrow_allocations ea ON ea.id = pa.allocationId
     WHERE pa.reference = ? OR pa.providerReference = ?
     LIMIT 1`,
    [transferRef, transferRef]
  );
  return rows[0];
};

/**
 * Recompute and persist the order-level escrow status (finishes an order).
 * @param {number | string} orderId
 */
const refreshOrderEscrow = async (orderId) => {
  if (orderId == null) return;
  const escrowStatus = await recomputeOrderEscrowStatus(orderId);
  await pool.execute(
    `UPDATE orders SET escrowStatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [escrowStatus, orderId]
  );
};

/**
 * Settle a successful transfer: claim the attempt, mark the allocation
 * released (full payouts) and debit the vendor's wallet.
 * @param {string} transferRef Paystack transfer reference
 * @returns {Promise<'settled' | 'already' | 'unknown'>}
 */
export const settleTransferSuccess = async (transferRef) => {
  const attempt = await findAttempt(transferRef);
  if (!attempt) return 'unknown';

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [settled] = await connection.execute(
      `UPDATE payout_attempts SET status = 'succeeded', lastError = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'processing'`,
      [attempt.id]
    );
    if (settled.affectedRows !== 1) {
      await connection.rollback();
      return 'already';
    }
    if (attempt.isFull) {
      await connection.execute(
        `UPDATE escrow_allocations
         SET status = 'released', released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'releasing'`,
        [attempt.allocationId]
      );
    }
    const debited = await debitVendorBalanceInTransaction(
      connection,
      attempt.vendorId,
      attempt.amount,
      attempt.reference,
      `Withdrawal for order ${attempt.orderId}`
    );
    if (!debited) {
      // The wallet debit already exists for this reference (redelivery race) —
      // the attempt claim we just won still owns this event, so settle cleanly.
      console.warn(`⚠️ Transfer ${transferRef}: wallet already debited (idempotent) — continuing`);
    }
    await recordFinancialEvent({
      connection,
      eventType: 'payout.succeeded',
      direction: 'out',
      amount: attempt.amount,
      vendorId: attempt.vendorId,
      orderId: attempt.orderId,
      allocationId: attempt.allocationId,
      payoutAttemptId: attempt.id,
      reference: attempt.reference,
      providerReference: transferRef,
      dedupeKey: `payout.succeeded:${attempt.reference}`,
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await refreshOrderEscrow(attempt.orderId);
  return 'settled';
};

/**
 * Settle a failed transfer: return the reserved amount to the allocation so
 * the vendor can retry. Never runs for a client timeout — only when the
 * provider definitively says the transfer failed.
 * @param {string} transferRef Paystack transfer reference
 * @returns {Promise<'settled' | 'already' | 'unknown'>}
 */
export const settleTransferFailed = async (transferRef) => {
  const attempt = await findAttempt(transferRef);
  if (!attempt) return 'unknown';

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [failed] = await connection.execute(
      `UPDATE payout_attempts SET status = 'failed', lastError = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'processing'`,
      [attempt.id]
    );
    if (failed.affectedRows !== 1) {
      await connection.rollback();
      return 'already';
    }
    if (attempt.isFull) {
      const [restored] = await connection.execute(
        `UPDATE escrow_allocations SET status = 'available', payoutAmount = payoutAmount + ?,
           payoutReference = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'releasing'`,
        [attempt.amount, attempt.allocationId]
      );
      if (restored.affectedRows !== 1) {
        // The allocation is not in the state this restore expects. Marking
        // the attempt terminal anyway would silently swallow the vendor's
        // money (claimed at payout time, never returned) with no journal and
        // no way to re-run. Throw instead: the whole transaction (including
        // the attempt claim) rolls back, so the attempt stays 'processing'
        // and Paystack redelivery / the reconciler will retry it loudly.
        throw new Error(
          `Allocation ${attempt.allocationId} not in 'releasing' — cannot restore ${attempt.amount} for failed payout ${attempt.reference}`
        );
      }
    } else {
      const [restored] = await connection.execute(
        `UPDATE escrow_allocations SET payoutAmount = payoutAmount + ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'available'`,
        [attempt.amount, attempt.allocationId]
      );
      if (restored.affectedRows !== 1) {
        throw new Error(
          `Allocation ${attempt.allocationId} not in 'available' — cannot restore ${attempt.amount} for failed payout ${attempt.reference}`
        );
      }
    }
    await recordFinancialEvent({
      connection,
      eventType: 'payout.failed',
      direction: 'info',
      amount: attempt.amount,
      vendorId: attempt.vendorId,
      orderId: attempt.orderId,
      allocationId: attempt.allocationId,
      payoutAttemptId: attempt.id,
      reference: attempt.reference,
      providerReference: transferRef,
      dedupeKey: `payout.failed:${attempt.reference}`,
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await refreshOrderEscrow(attempt.orderId);
  await notifyVendorPayoutFailure(attempt.orderId, [attempt.allocationId]);
  return 'settled';
};

/**
 * Settle a reversed transfer. A reversed transfer means the funds returned to
 * the platform balance, so:
 *   - the payout_attempt is marked `reversed`,
 *   - if the wallet was debited at transfer.success the amount is credited
 *     back (one reversal credit per payout reference),
 *   - the allocation's available amount (redeemable again) is restored.
 * @param {string} transferRef Paystack transfer reference
 * @returns {Promise<'settled' | 'already' | 'unknown'>}
 */
export const settleTransferReversed = async (transferRef) => {
  const attempt = await findAttempt(transferRef);
  if (!attempt) return 'unknown';

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[locked]] = await connection.execute(
      `SELECT id, status FROM payout_attempts WHERE id = ? FOR UPDATE`,
      [attempt.id]
    );
    if (!locked || !['succeeded', 'processing', 'reversed'].includes(locked.status)) {
      await connection.rollback();
      return 'already';
    }
    if (locked.status === 'reversed') {
      await connection.rollback();
      return 'already';
    }
    // The wallet is debited only on a confirmed success, so only then must the
    // reversal credit compensate the vendor's balance.
    const wasDebited = locked.status === 'succeeded';

    await connection.execute(
      `UPDATE payout_attempts SET status = 'reversed', lastError = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [attempt.id]
    );

    if (attempt.isFull) {
      const [restored] = await connection.execute(
        `UPDATE escrow_allocations SET status = 'available', payoutAmount = payoutAmount + ?,
           payoutReference = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status IN ('released', 'releasing')`,
        [attempt.amount, attempt.allocationId]
      );
      if (restored.affectedRows !== 1) {
        // Same rule as settleTransferFailed: never mark the attempt terminal
        // without actually returning the money. Roll back so the reversal can
        // be re-settled (idempotently) once the allocation is back in a
        // restorable state — a terminal attempt here would double-charge the
        // vendor (wallet debit from transfer.success + no allocation restore).
        throw new Error(
          `Allocation ${attempt.allocationId} not in 'released/releasing' — cannot restore ${attempt.amount} for reversed payout ${attempt.reference}`
        );
      }
    } else {
      const [restored] = await connection.execute(
        `UPDATE escrow_allocations SET payoutAmount = payoutAmount + ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'available'`,
        [attempt.amount, attempt.allocationId]
      );
      if (restored.affectedRows !== 1) {
        throw new Error(
          `Allocation ${attempt.allocationId} not in 'available' — cannot restore ${attempt.amount} for reversed payout ${attempt.reference}`
        );
      }
    }

    if (wasDebited) {
      const credited = await reversalCreditVendorBalance({
        connection,
        vendorId: attempt.vendorId,
        allocationId: attempt.allocationId,
        amount: attempt.amount,
        reference: attempt.reference,
        note: `Transfer reversed for order ${attempt.orderId}`,
      });
      if (!credited) {
        console.warn(`⚠️ Transfer ${transferRef} reversal: wallet credit already recorded (idempotent)`);
      }
    }

    await recordFinancialEvent({
      connection,
      eventType: 'payout.reversed',
      direction: 'in',
      amount: attempt.amount,
      vendorId: attempt.vendorId,
      orderId: attempt.orderId,
      allocationId: attempt.allocationId,
      payoutAttemptId: attempt.id,
      reference: attempt.reference,
      providerReference: transferRef,
      dedupeKey: `payout.reversed:${attempt.reference}`,
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await refreshOrderEscrow(attempt.orderId);
  return 'settled';
};

/**
 * Used by the reconciliation scheduler to settle legacy/unknown transfers that
 * have no local payout_attempt (e.g. pre-outbox transfers). Safe no-op.
 * @param {string} transferRef
 */
export const settleUnknownTransfer = async (transferRef) => {
  console.warn(`ℹ️  Transfer ${transferRef} has no local payout attempt — manual reconciliation required`);
  return 'unknown';
};