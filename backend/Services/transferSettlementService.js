// @ts-check
// SERVICES/transferSettlementService.js
// Idempotent settlement of Paystack transfer events (success / failed /
// reversed). Used by the signed webhook handler, the stuck-transfer
// reconciler and the admin verify action, so a settlement executes exactly
// once no matter which path triggers it. Design: PAYOUT_LIFECYCLE_DESIGN.md.
//
// Every settlement has the same shape, in ONE transaction:
//   1. Lock the escrow ALLOCATION row first. Withdrawal claims, settlements
//      and refund clawbacks all serialize on this one row, so the attempts
//      of an allocation can never be settled concurrently (and the lock
//      order allocation -> attempt is the same everywhere: no deadlock).
//   2. Lock the payout_attempt and claim it with a status guard
//      (processing -> terminal). Zero rows means "already settled".
//   3. Check the provider evidence (amount in pesewas, currency) when the
//      caller has it. A mismatch is never settled automatically.
//   4. Apply the money effect (wallet debit / restore / clawback / reversal
//      credit) + the immutable financial_events journal row.
//   5. Recompute the allocation's state from its remainder and in-flight
//      attempts (instead of EXPECTING a state, which is what stranded R-8).
// Anything that makes the money effect impossible (invariant violation, not a
// transient DB error) rolls the transaction back and parks the attempt in
// 'reconciliation_required' with a deduplicated admin alert. Transient errors
// still throw, so the webhook answers 500 and Paystack redelivers.
import pool from '../config/db.js';
import { round2 } from '../../shared/pricing.js';
import { recordFinancialEvent } from './ledgerService.js';
import {
  debitVendorBalanceInTransaction,
  reversalCreditVendorBalance,
  clawbackVendorBalanceInTransaction,
} from './walletService.js';
import {
  recomputeOrderEscrowStatus,
  notifyVendorPayoutFailure,
} from './escrowService.js';
import { notifyAdmins } from '../utils/adminAlerts.js';

/** Attempt states that still hold a reservation on their allocation. */
export const IN_FLIGHT_STATUSES = ['processing', 'reconciliation_required'];
const RESTORABLE_ALLOCATION_STATUSES = new Set(['available', 'releasing', 'released']);
/** Currency every payout is reserved and sent in (Paystack GHS balance). */
export const PAYOUT_CURRENCY = 'GHS';
const REALERT_AFTER_HOURS = 24;

/** Thrown inside a settlement when automation must stop (no money moves). */
class ReviewRequired extends Error {
  /** @param {string} reason short machine reason @param {string} detail */
  constructor(reason, detail) {
    super(detail);
    this.reason = reason;
  }
}

/**
 * Settlement options. `fromReview` lets an admin's audited re-verification
 * settle an attempt parked in reconciliation_required — through exactly the
 * same evidence and invariant checks (PAYOUT_LIFECYCLE_DESIGN.md §7.1).
 * Webhooks and the scheduler never pass it.
 * @typedef {{ fromReview?: boolean }} SettleOptions
 */

/** @param {any} attempt @param {SettleOptions} [opts] */
const isOpen = (attempt, opts) =>
  attempt.status === 'processing' || (!!opts?.fromReview && attempt.status === 'reconciliation_required');

/** @param {any} attempt */
export const attemptAmountMinor = (attempt) =>
  attempt.amountMinor != null ? Number(attempt.amountMinor) : Math.round(Number(attempt.amount) * 100);

/**
 * Resolve a payout attempt by local or provider reference (no lock).
 * @param {string} transferRef
 */
const findAttempt = async (transferRef) => {
  const [rows] = /** @type {any} */ (await pool.execute(
    `SELECT pa.*, ea.orderId
     FROM payout_attempts pa
     JOIN escrow_allocations ea ON ea.id = pa.allocationId
     WHERE pa.reference = ? OR pa.providerReference = ?
     LIMIT 1`,
    [transferRef, transferRef]
  ));
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
 * Derive a released allocation's state from its remainder and in-flight
 * attempts. Caller holds the allocation row lock (and every writer of this
 * allocation's attempts takes that lock first), so the count is stable.
 * Never touches 'failed' (voided/clawed back) or pre-release states.
 * @param {any} connection
 * @param {number} allocationId
 */
export const recomputeAllocationPayoutStatus = async (connection, allocationId) => {
  const [[alloc]] = await connection.execute(
    `SELECT status, payoutAmount FROM escrow_allocations WHERE id = ? FOR UPDATE`,
    [allocationId]
  );
  if (!alloc || !RESTORABLE_ALLOCATION_STATUSES.has(alloc.status)) return alloc?.status ?? null;
  const [inflight] = await connection.execute(
    `SELECT id FROM payout_attempts WHERE allocationId = ? AND status IN ('processing','reconciliation_required') FOR UPDATE`,
    [allocationId]
  );
  const remainder = round2(parseFloat(String(alloc.payoutAmount ?? 0)) || 0);
  const next = remainder > 0 ? 'available' : (inflight.length > 0 ? 'releasing' : 'released');
  if (next !== alloc.status) {
    await connection.execute(
      `UPDATE escrow_allocations
         SET status = ?, released_at = CASE WHEN ? = 'released' THEN COALESCE(released_at, CURRENT_TIMESTAMP) ELSE released_at END,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [next, next, allocationId]
    );
  }
  return next;
};

/**
 * Has the customer been refunded for this vendor's lines on this order?
 * Full refund (order refunded) or a partial refund journaled for the vendor.
 * @param {any} connection
 * @param {number} orderId
 * @param {number} vendorId
 */
const isRefundedForVendor = async (connection, orderId, vendorId) => {
  const [[order]] = await connection.execute(`SELECT paymentStatus FROM orders WHERE id = ?`, [orderId]);
  if (order?.paymentStatus === 'refunded') return true;
  const [partial] = await connection.execute(
    `SELECT 1 FROM financial_events WHERE orderId = ? AND eventType = 'refund' AND vendorId = ? LIMIT 1`,
    [orderId, vendorId]
  );
  return partial.length > 0;
};

/**
 * Return a failed/reversed attempt's money (design §4.3). Caller holds the
 * allocation lock and has already moved the attempt to its terminal status.
 * @param {any} connection
 * @param {any} attempt
 * @param {{ wasDebited: boolean }} opts
 * @returns {Promise<'restored' | 'clawed-back' | 'voided-already-debited'>}
 */
const restoreAttemptFunds = async (connection, attempt, { wasDebited }) => {
  const [[alloc]] = await connection.execute(
    `SELECT id, status, orderId FROM escrow_allocations WHERE id = ? FOR UPDATE`,
    [attempt.allocationId]
  );
  if (!alloc) throw new ReviewRequired('allocation_missing', `allocation ${attempt.allocationId} not found`);

  // INT-1: an in-flight payout is not voided by a refund (only pending/held/
  // available allocations are). If the customer has since been refunded for
  // this vendor's lines — full refund, or a partial refund naming this vendor
  // — money coming back from that payout must not become withdrawable.
  const refundedForVendor = RESTORABLE_ALLOCATION_STATUSES.has(alloc.status)
    && await isRefundedForVendor(connection, alloc.orderId, attempt.vendorId);

  if (RESTORABLE_ALLOCATION_STATUSES.has(alloc.status) && !refundedForVendor) {
    await connection.execute(
      `UPDATE escrow_allocations
         SET payoutAmount = payoutAmount + ?,
             payoutReference = CASE WHEN payoutReference = ? THEN NULL ELSE payoutReference END,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [attempt.amount, attempt.reference, attempt.allocationId]
    );
    await recomputeAllocationPayoutStatus(connection, attempt.allocationId);
    return 'restored';
  }

  if (alloc.status === 'failed' || refundedForVendor) {
    // The order was refunded/returned while this transfer was in flight and
    // the allocation's remainder was already clawed back. The returned money
    // must not become withdrawable (existing void policy). The wallet was
    // never debited for a transfer that did not succeed, so it still holds
    // the amount: claw it back. After a reversal of a SUCCEEDED transfer the
    // wallet was debited already, and simply not crediting it is the clawback.
    if (wasDebited) return 'voided-already-debited';
    try {
      await clawbackVendorBalanceInTransaction(
        connection, attempt.vendorId, attempt.amount, `clawback:payout:${attempt.reference}`,
        `Returned payout clawed back (order ${alloc.orderId} refunded/voided)`
      );
    } catch (err) {
      if (err?.code === 'INSUFFICIENT_BALANCE') {
        throw new ReviewRequired('clawback_insufficient_balance',
          `wallet cannot absorb the clawback of ${attempt.amount} for voided allocation ${attempt.allocationId}`);
      }
      throw err;
    }
    await recordFinancialEvent({
      connection,
      eventType: 'escrow.clawback',
      direction: 'out',
      amount: attempt.amount,
      vendorId: attempt.vendorId,
      orderId: alloc.orderId,
      allocationId: attempt.allocationId,
      payoutAttemptId: attempt.id,
      reference: attempt.reference,
      dedupeKey: `escrow.clawback:payout:${attempt.reference}`,
      payload: { reason: refundedForVendor ? 'returned payout after the customer was refunded' : 'returned payout on a voided allocation' },
    });
    if (refundedForVendor) {
      // Close the allocation once nothing remains on it (a remainder, if any,
      // belongs to the refund/void flow, which claws back 'available' rows).
      await connection.execute(
        `UPDATE escrow_allocations
            SET status = 'failed', reason = 'clawed back (refunded) — returned payout', updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND payoutAmount <= 0`,
        [attempt.allocationId]
      );
      await recomputeAllocationPayoutStatus(connection, attempt.allocationId);
    }
    return 'clawed-back';
  }

  throw new ReviewRequired(`allocation_state_${alloc.status}`,
    `allocation ${attempt.allocationId} is '${alloc.status}' — cannot place returned funds automatically`);
};

/**
 * Deduplicated admin alert for one payout attempt: at most one alert per
 * (attempt, reason) every REALERT_AFTER_HOURS. The conditional UPDATE is the
 * dedupe gate, so concurrent workers alert once.
 * @param {any} attempt row with id, reference, vendorId, amount
 * @param {string} reason short machine reason
 * @param {string} detail human explanation
 * @returns {Promise<boolean>} true if an alert was sent
 */
export const alertPayoutAttempt = async (attempt, reason, detail) => {
  const code = String(reason).slice(0, 64);
  const [res] = /** @type {any} */ (await pool.execute(
    `UPDATE payout_attempts SET alertedReason = ?, alertedAt = CURRENT_TIMESTAMP
     WHERE id = ? AND (alertedReason IS NULL OR alertedReason <> ?
                       OR alertedAt < DATE_SUB(NOW(), INTERVAL ${REALERT_AFTER_HOURS} HOUR))`,
    [code, attempt.id, code]
  ));
  if (res.affectedRows !== 1) return false;
  await notifyAdmins(
    'Vendor payout needs attention',
    `Payout attempt #${attempt.id} (ref ${attempt.reference}, vendor ${attempt.vendorId}, GHS ${round2(Number(attempt.amount)).toFixed(2)}): ${detail} [${code}]. Funds stay reserved. Do NOT re-send this payout — see PAYOUT_RECONCILIATION_RUNBOOK.md.`,
    { link: '/admin?section=payouts', type: 'system' }
  );
  return true;
};

/**
 * Park an attempt in reconciliation_required (only from processing). No
 * money moves; the reservation stays. Alerts admins (deduplicated).
 * @param {any} attempt
 * @param {string} reason
 * @param {string} detail
 * @param {string | null} [providerStatus]
 * @returns {Promise<boolean>} true if this call parked it
 */
export const markReconciliationRequired = async (attempt, reason, detail, providerStatus = null) => {
  const [res] = /** @type {any} */ (await pool.execute(
    `UPDATE payout_attempts
       SET status = 'reconciliation_required', reviewReason = ?,
           providerStatus = COALESCE(?, providerStatus), updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status IN ('processing', 'reconciliation_required')`,
    [`${reason}: ${detail}`.slice(0, 255), providerStatus, attempt.id]
  ));
  if (res.affectedRows === 1 && attempt.status !== 'reconciliation_required') {
    console.error(`PAYOUT RECONCILIATION REQUIRED attempt=${attempt.id} ref=${attempt.reference}: ${reason} — ${detail}`);
    await recordFinancialEvent({
      eventType: 'payout.review_required',
      direction: 'info',
      amount: attempt.amount,
      vendorId: attempt.vendorId,
      allocationId: attempt.allocationId,
      payoutAttemptId: attempt.id,
      reference: attempt.reference,
      dedupeKey: `payout.review_required:${attempt.reference}`,
      payload: { reason, detail, providerStatus },
    }).catch(() => {});
  }
  await alertPayoutAttempt(attempt, reason, detail);
  return res.affectedRows === 1;
};

/**
 * Compare provider evidence with what was reserved. Only fields the caller
 * actually has are compared (a webhook always carries both).
 * @param {any} attempt
 * @param {{ amountMinor?: number | null, currency?: string | null }} [evidence]
 */
const assertEvidenceMatches = (attempt, evidence) => {
  if (!evidence) return;
  if (evidence.amountMinor != null && Number(evidence.amountMinor) !== attemptAmountMinor(attempt)) {
    throw new ReviewRequired('amount_mismatch',
      `provider reports ${evidence.amountMinor} pesewas, reserved ${attemptAmountMinor(attempt)}`);
  }
  const expectedCurrency = String(attempt.currency || PAYOUT_CURRENCY).toUpperCase();
  if (evidence.currency && String(evidence.currency).toUpperCase() !== expectedCurrency) {
    throw new ReviewRequired('currency_mismatch',
      `provider reports ${String(evidence.currency).toUpperCase()}, reserved ${expectedCurrency}`);
  }
};

/**
 * Shared transaction runner. `work` runs with the allocation and attempt
 * locked; it returns 'settled' or 'already'.
 * @param {string} transferRef
 * @param {string} providerStatus
 * @param {(connection: any, attempt: any) => Promise<'settled' | 'already'>} work
 * @returns {Promise<{ outcome: 'settled' | 'already' | 'unknown' | 'review', attempt?: any }>}
 */
const runSettlement = async (transferRef, providerStatus, work) => {
  const found = await findAttempt(transferRef);
  if (!found) return { outcome: 'unknown' };

  const connection = await pool.getConnection();
  /** @type {ReviewRequired | null} */
  let review = null;
  let outcome;
  let attempt = found;
  try {
    await connection.beginTransaction();
    // Lock order: allocation, then attempt (same as claims and clawbacks).
    await connection.execute(`SELECT id FROM escrow_allocations WHERE id = ? FOR UPDATE`, [found.allocationId]);
    const [[locked]] = await connection.execute(
      `SELECT * FROM payout_attempts WHERE id = ? FOR UPDATE`, [found.id]
    );
    attempt = { ...locked, orderId: found.orderId };
    outcome = await work(connection, attempt);
    if (outcome === 'settled') {
      await connection.execute(
        `UPDATE payout_attempts SET providerStatus = ?, lastError = NULL WHERE id = ?`,
        [providerStatus, attempt.id]
      );
      await connection.commit();
    } else {
      await connection.rollback();
    }
  } catch (error) {
    await connection.rollback();
    if (!(error instanceof ReviewRequired)) throw error;
    review = error;
  } finally {
    connection.release();
  }

  if (review) {
    await markReconciliationRequired(attempt, review.reason, review.message, providerStatus);
    return { outcome: 'review', attempt };
  }
  if (outcome === 'settled') await refreshOrderEscrow(found.orderId);
  return { outcome: outcome ?? 'already', attempt };
};

/**
 * Settle a successful transfer: claim the attempt, debit the vendor's wallet,
 * recompute the allocation (released once nothing else is in flight).
 * A confirmed success that cannot be booked is NEVER treated as failed: it
 * goes to reconciliation_required with the reservation intact.
 * @param {string} transferRef Paystack transfer reference
 * @param {{ amountMinor?: number | null, currency?: string | null }} [evidence]
 * @param {SettleOptions} [opts]
 * @returns {Promise<'settled' | 'already' | 'unknown' | 'review'>}
 */
export const settleTransferSuccess = async (transferRef, evidence, opts) => {
  if (typeof transferRef === 'string' && transferRef.startsWith('kente_rtr_')) {
    // Referral-earnings withdrawal (referralPayoutService), not a vendor payout.
    const { settleReferralWithdrawal } = await import('./referralPayoutService.js');
    return settleReferralWithdrawal(transferRef, 'success', evidence || {});
  }
  const { outcome } = await runSettlement(transferRef, 'success', async (connection, attempt) => {
    if (!isOpen(attempt, opts)) return 'already';
    assertEvidenceMatches(attempt, evidence);
    await connection.execute(
      `UPDATE payout_attempts SET status = 'succeeded', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [attempt.id]
    );
    let debited;
    try {
      debited = await debitVendorBalanceInTransaction(
        connection, attempt.vendorId, attempt.amount, attempt.reference, `Withdrawal for order ${attempt.orderId}`
      );
    } catch (err) {
      if (err?.code === 'INSUFFICIENT_BALANCE') {
        throw new ReviewRequired('confirmed_success_unbookable',
          'Paystack confirmed the transfer but the vendor wallet holds less than the amount — ledger inconsistency');
      }
      throw err;
    }
    if (!debited) {
      console.warn(` Transfer ${transferRef}: wallet already debited (idempotent) — continuing`);
    }
    await recomputeAllocationPayoutStatus(connection, attempt.allocationId);
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
    return 'settled';
  });
  return outcome;
};

/**
 * Settle a definitively failed transfer: return exactly the reserved amount
 * once (to the allocation, or clawed back if the order was refunded since).
 * Only called on provider evidence — never for a client timeout.
 * @param {string} transferRef Paystack transfer reference
 * @param {{ amountMinor?: number | null, currency?: string | null }} [evidence]
 * @param {SettleOptions} [opts]
 * @returns {Promise<'settled' | 'already' | 'unknown' | 'review'>}
 */
export const settleTransferFailed = async (transferRef, evidence, opts) => {
  if (typeof transferRef === 'string' && transferRef.startsWith('kente_rtr_')) {
    // Referral-earnings withdrawal (referralPayoutService), not a vendor payout.
    const { settleReferralWithdrawal } = await import('./referralPayoutService.js');
    return settleReferralWithdrawal(transferRef, 'failed', evidence || {});
  }
  const { outcome, attempt } = await runSettlement(transferRef, 'failed', async (connection, attempt) => {
    if (!isOpen(attempt, opts)) return 'already';
    assertEvidenceMatches(attempt, evidence);
    await connection.execute(
      `UPDATE payout_attempts SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [attempt.id]
    );
    const placed = await restoreAttemptFunds(connection, attempt, { wasDebited: false });
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
      payload: { funds: placed },
    });
    return 'settled';
  });
  if (outcome === 'settled' && attempt) {
    await notifyVendorPayoutFailure(attempt.orderId, [attempt.allocationId]);
  }
  return outcome;
};

/**
 * Settle a reversed transfer (funds returned to the platform balance). The
 * wallet is credited back only if it was debited (attempt had succeeded).
 * @param {string} transferRef Paystack transfer reference
 * @param {{ amountMinor?: number | null, currency?: string | null }} [evidence]
 * @param {SettleOptions} [opts]
 * @returns {Promise<'settled' | 'already' | 'unknown' | 'review'>}
 */
export const settleTransferReversed = async (transferRef, evidence, opts) => {
  if (typeof transferRef === 'string' && transferRef.startsWith('kente_rtr_')) {
    // Referral-earnings withdrawal (referralPayoutService), not a vendor payout.
    const { settleReferralWithdrawal } = await import('./referralPayoutService.js');
    return settleReferralWithdrawal(transferRef, 'reversed', evidence || {});
  }
  const { outcome } = await runSettlement(transferRef, 'reversed', async (connection, attempt) => {
    if (!isOpen(attempt, opts) && attempt.status !== 'succeeded') return 'already';
    assertEvidenceMatches(attempt, evidence);
    const wasDebited = attempt.status === 'succeeded';
    await connection.execute(
      `UPDATE payout_attempts SET status = 'reversed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [attempt.id]
    );
    const placed = await restoreAttemptFunds(connection, attempt, { wasDebited });
    if (wasDebited && placed === 'restored') {
      const credited = await reversalCreditVendorBalance({
        connection,
        vendorId: attempt.vendorId,
        allocationId: attempt.allocationId,
        amount: attempt.amount,
        reference: attempt.reference,
        note: `Transfer reversed for order ${attempt.orderId}`,
      });
      if (!credited) {
        console.warn(` Transfer ${transferRef} reversal: wallet credit already recorded (idempotent)`);
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
      payload: { funds: placed, wasDebited },
    });
    return 'settled';
  });
  return outcome;
};

/**
 * Wallet vs reservation consistency for one vendor (invariant I-15):
 *   wallet.available_balance == Σ remainder of credited released allocations
 *                               + Σ in-flight attempt amounts
 * @param {number | string} vendorId
 * @returns {Promise<{ vendorId: number, wallet: number, allocations: number, inFlight: number, delta: number, ok: boolean }>}
 */
export const checkVendorPayoutConsistency = async (vendorId) => {
  const [[w]] = /** @type {any} */ (await pool.execute(
    `SELECT COALESCE(MAX(available_balance), 0) AS bal FROM vendor_wallets WHERE vendorId = ?`, [vendorId]
  ));
  const [[a]] = /** @type {any} */ (await pool.execute(
    `SELECT COALESCE(SUM(ea.payoutAmount), 0) AS s
       FROM escrow_allocations ea
      WHERE ea.vendorId = ? AND ea.status IN ('available','releasing','released')
        AND EXISTS (SELECT 1 FROM wallet_transactions wt WHERE wt.type = 'credit' AND wt.allocationId = ea.id)`,
    [vendorId]
  ));
  const [[f]] = /** @type {any} */ (await pool.execute(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM payout_attempts
      WHERE vendorId = ? AND status IN ('processing','reconciliation_required')`,
    [vendorId]
  ));
  const wallet = round2(Number(w.bal));
  const allocations = round2(Number(a.s));
  const inFlight = round2(Number(f.s));
  const delta = round2(wallet - allocations - inFlight);
  return { vendorId: Number(vendorId), wallet, allocations, inFlight, delta, ok: Math.abs(delta) < 0.005 };
};

/**
 * Used by the reconciliation scheduler to settle legacy/unknown transfers that
 * have no local payout_attempt (e.g. pre-outbox transfers). Safe no-op.
 * @param {string} transferRef
 */
export const settleUnknownTransfer = async (transferRef) => {
  console.warn(`Transfer ${transferRef} has no local payout attempt — manual reconciliation required`);
  return 'unknown';
};
