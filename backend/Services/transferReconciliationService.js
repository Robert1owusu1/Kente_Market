// @ts-check
// SERVICES/transferReconciliationService.js
// Reconciliation + self-healing for the payout flow (PAYOUT_LIFECYCLE_DESIGN.md §5).
//
// 1. reconcileStuckTransfers: payout_attempts still 'processing' past the
//    provider SLA are verified against Paystack (GET /transfer/verify/:ref)
//    and settled through the SAME idempotent settlement service the webhook
//    uses. It never re-sends a transfer: verify is the only provider call.
//    Selection rotates by lastCheckedAt, so a backlog of attempts that cannot
//    settle yet can never starve newer ones, and every run is bounded.
// 2. reclaimStaleProcessingWebhooks: a webhook_events row stuck in
//    'processing' (e.g. the process died mid-settlement) is reset to 'failed'
//    so a redelivery — or the next reconciliation pass — can reclaim it.
//
// Both are safe to run from multiple replicas: every mutation is guarded by
// conditional claims, row locks and DB unique keys.
import axios from 'axios';
import pool from '../config/db.js';
import {
  settleTransferSuccess,
  settleTransferFailed,
  settleTransferReversed,
  alertPayoutAttempt,
  markReconciliationRequired,
  checkVendorPayoutConsistency,
} from './transferSettlementService.js';
import { notifyAdmins } from '../utils/adminAlerts.js';

/** Provider statuses that will not resolve without operator action at Paystack. */
const NEEDS_OPERATOR = new Set(['otp', 'abandoned', 'blocked', 'rejected']);
/** Unresolved this long → alert (age alone never fails a payout). */
const ALERT_AFTER_HOURS = 24;
/** "Transfer not found" grace when our initiate call got no answer (in flight). */
const NOT_FOUND_GRACE_MINUTES = 60;
/** Shorter grace when Paystack itself answered the initiate call with a 4xx. */
const NOT_FOUND_GRACE_AFTER_4XX_MINUTES = 10;

/**
 * Provider access, injectable for tests (no network in the suite).
 * verifyTransfer resolves the axios-style response or throws an axios-style
 * error (`error.response.status`).
 */
/** @param {string} reference */
const defaultVerifyTransfer = async (reference) => {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw Object.assign(new Error('PAYSTACK_SECRET_KEY not set'), { code: 'NO_PROVIDER_KEY' });
  return axios.get(
    `https://api.paystack.co/transfer/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${key}` }, timeout: 15000 }
  );
};

export const transferReconciliationHooks = {
  verifyTransfer: defaultVerifyTransfer,
};

/** @param {any} attempt */
const ageMinutes = (attempt) => (Date.now() - new Date(attempt.created_at).getTime()) / 60000;

/**
 * @param {any} attempt
 * @param {{ providerStatus?: string | null, error?: string | null }} check
 */
const recordCheck = async (attempt, { providerStatus = null, error = null }) => {
  await pool.execute(
    `UPDATE payout_attempts
        SET lastCheckedAt = CURRENT_TIMESTAMP, checkCount = checkCount + 1,
            providerStatus = COALESCE(?, providerStatus), lastError = ?
      WHERE id = ?`,
    [providerStatus, error ? String(error).slice(0, 500) : null, attempt.id]
  );
};

/**
 * Reconcile ONE payout attempt against the provider. Acts on a 'processing'
 * attempt; a 'reconciliation_required' one only when `allowReview` is set
 * (an admin's audited re-verification — design §7.1). For a parked attempt
 * a provider "not found" never releases funds.
 * @param {any} attempt full payout_attempts row
 * @param {{ allowReview?: boolean }} [opts]
 * @returns {Promise<'succeeded' | 'failed' | 'reversed' | 'pending' | 'attention' | 'review' | 'errored' | 'already' | 'skipped'>}
 */
export const reconcilePayoutAttempt = async (attempt, { allowReview = false } = {}) => {
  if (!attempt) return 'skipped';
  const fromReview = allowReview && attempt.status === 'reconciliation_required';
  if (attempt.status !== 'processing' && !fromReview) return 'skipped';
  const queryRef = attempt.providerReference || attempt.reference;
  const age = ageMinutes(attempt);

  let tx;
  try {
    const resp = await transferReconciliationHooks.verifyTransfer(queryRef);
    tx = resp?.data?.data;
    if (!tx || !tx.status) {
      await recordCheck(attempt, { error: 'provider returned no transfer data' });
      if (age > ALERT_AFTER_HOURS * 60) {
        await alertPayoutAttempt(attempt, 'provider_no_data', 'Paystack verify returned no transfer data');
      }
      return 'errored';
    }
  } catch (error) {
    const status = error?.response?.status;
    await recordCheck(attempt, { error: `verify failed${status ? ` (HTTP ${status})` : ''}: ${error.message}` });
    if (status === 404) {
      if (fromReview) return 'review';
      if (attempt.initiatedAt) {
        // Paystack acknowledged this exact reference, and now says it does not
        // exist: contradictory. Releasing the funds could pay twice.
        await markReconciliationRequired(attempt, 'provider_not_found_after_ack',
          'Paystack acknowledged the transfer but verify now reports it does not exist');
        return 'review';
      }
      const initiate4xx = Number(attempt.initiateHttpStatus) >= 400 && Number(attempt.initiateHttpStatus) < 500;
      const grace = initiate4xx ? NOT_FOUND_GRACE_AFTER_4XX_MINUTES : NOT_FOUND_GRACE_MINUTES;
      if (age > grace) {
        // The reference is stored before the call and sent with it, and our
        // initiate never got an acknowledgement: Paystack never created this
        // transfer, so no money was sent. Restore through the guarded path.
        const outcome = await settleTransferFailed(attempt.reference);
        console.log(` Released payout attempt ${attempt.reference}: no such transfer at Paystack (never acknowledged) → ${outcome}`);
        return outcome === 'settled' ? 'failed' : outcome === 'review' ? 'review' : 'already';
      }
      return 'pending';
    }
    // Provider unreachable / 5xx / auth: nothing changes, reservation kept.
    if (age > ALERT_AFTER_HOURS * 60) {
      await alertPayoutAttempt(attempt, 'provider_unreachable',
        `could not verify with Paystack for over ${ALERT_AFTER_HOURS}h (${status ? `HTTP ${status}` : error.message})`);
    }
    return 'errored';
  }

  const providerStatus = String(tx.status).toLowerCase();
  await recordCheck(attempt, { providerStatus });
  const evidence = {
    amountMinor: tx.amount != null && Number.isFinite(Number(tx.amount)) ? Number(tx.amount) : null,
    currency: tx.currency || null,
  };
  const transferRef = tx.reference || queryRef;
  /** @type {Record<string, 'succeeded' | 'failed' | 'reversed'>} */
  const settledAs = { success: 'succeeded', failed: 'failed', reversed: 'reversed' };
  if (providerStatus in settledAs) {
    const settle = providerStatus === 'success' ? settleTransferSuccess
      : providerStatus === 'failed' ? settleTransferFailed : settleTransferReversed;
    const outcome = await settle(transferRef, evidence, { fromReview });
    if (outcome === 'settled') return settledAs[providerStatus];
    if (outcome === 'review') return 'review';
    return 'already';
  }
  if (NEEDS_OPERATOR.has(providerStatus)) {
    await alertPayoutAttempt(attempt, `provider_${providerStatus}`,
      `Paystack reports status '${providerStatus}', which needs action in the Paystack dashboard`);
    return 'attention';
  }
  if (age > ALERT_AFTER_HOURS * 60) {
    await alertPayoutAttempt(attempt, 'provider_pending_too_long',
      `Paystack still reports '${providerStatus}' after ${ALERT_AFTER_HOURS}h`);
  }
  return 'pending';
};

/**
 * Reconcile payout_attempts stuck in 'processing' against Paystack.
 * Bounded (LIMIT, index idx_payout_lifecycle) and rotating (least recently
 * checked first). Provider calls are sequential: at most `limit` per run.
 * @param {{ olderThanMinutes?: number, limit?: number }} [options]
 */
export const reconcileStuckTransfers = async ({
  olderThanMinutes = 30,
  limit = 25,
} = {}) => {
  /** @type {Record<string, number>} */
  const summary = { verified: 0, succeeded: 0, failed: 0, reversed: 0, pending: 0, attention: 0, review: 0, errored: 0, already: 0 };

  if (!process.env.PAYSTACK_SECRET_KEY && transferReconciliationHooks.verifyTransfer === defaultVerifyTransfer) {
    console.warn('PAYSTACK_SECRET_KEY not set — transfer reconciliation disabled');
    return summary;
  }

  let rows;
  try {
    // Inlined, clamped integers (TiDB/MySQL reject a string for `LIMIT ?`).
    const safeOlderThanMinutes = Math.max(1, Math.floor(Number(olderThanMinutes)) || 30);
    const safeLimit = Math.min(200, Math.max(1, Math.floor(Number(limit)) || 25));
    [rows] = /** @type {any} */ (await pool.execute(
      `SELECT * FROM payout_attempts
        WHERE status = 'processing'
          AND created_at < DATE_SUB(NOW(), INTERVAL ${safeOlderThanMinutes} MINUTE)
        ORDER BY lastCheckedAt ASC, id ASC
        LIMIT ${safeLimit}`
    ));
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_FIELD_ERROR') {
      console.warn(`payout_attempts schema not ready (${error.code}) — run \`npm run db:migrate\` (release gate). Reconciliation skipped.`);
      return summary;
    }
    throw error; // the scheduler records the failure and alerts
  }

  const touchedVendors = new Set();
  for (const attempt of rows) {
    let outcome;
    try {
      outcome = await reconcilePayoutAttempt(attempt);
    } catch (error) {
      // A transient DB error during settlement: counted, logged, retried next run.
      outcome = 'errored';
      console.error(`Transfer reconciliation failed for ${attempt.reference}: ${error.message}`);
      await pool.execute(
        `UPDATE payout_attempts SET lastCheckedAt = CURRENT_TIMESTAMP, checkCount = checkCount + 1, lastError = ? WHERE id = ?`,
        [`reconcile error: ${String(error.message).slice(0, 480)}`, attempt.id]
      ).catch(() => {});
    }
    if (outcome !== 'errored' && outcome !== 'skipped') summary.verified += 1;
    if (outcome in summary) summary[outcome] += 1;
    if (['succeeded', 'failed', 'reversed', 'review'].includes(outcome)) touchedVendors.add(attempt.vendorId);
  }

  for (const vendorId of touchedVendors) {
    await alertIfVendorInconsistent(vendorId).catch((e) => console.error('consistency check failed:', e.message));
  }

  if (rows.length > 0) {
    console.log(` Reconciled ${summary.verified}/${rows.length} stuck transfer(s)`, summary);
  }
  return summary;
};

/**
 * Invariant I-15 check for one vendor; alerts at most once per vendor per day
 * (the unique financial_events.dedupeKey is the gate).
 * @param {number | string} vendorId
 */
export const alertIfVendorInconsistent = async (vendorId) => {
  const c = await checkVendorPayoutConsistency(vendorId);
  if (c.ok) return c;
  const day = new Date().toISOString().slice(0, 10);
  const [ins] = /** @type {any} */ (await pool.execute(
    `INSERT IGNORE INTO financial_events (eventType, currency, amount, direction, vendorId, dedupeKey, payload)
     VALUES ('payout.consistency_alert', 'GHS', ?, 'info', ?, ?, ?)`,
    [Math.abs(c.delta), vendorId, `payout.consistency:${vendorId}:${day}`, JSON.stringify(c)]
  ));
  if (ins.affectedRows === 1) {
    await notifyAdmins('Vendor wallet out of balance',
      `Vendor ${vendorId}: wallet GHS ${c.wallet.toFixed(2)} ≠ withdrawable GHS ${c.allocations.toFixed(2)} + in-flight GHS ${c.inFlight.toFixed(2)} (difference GHS ${c.delta.toFixed(2)}). Investigate before approving further payouts — see PAYOUT_RECONCILIATION_RUNBOOK.md.`,
      { link: '/admin?section=payouts', type: 'system' });
  }
  return c;
};

/**
 * Reset webhook events stuck in 'processing' back to 'failed' so Paystack
 * redelivery (or future webhooks) can reclaim them. Prevents a crash between
 * the claim and the processed-mark from wedging an event forever.
 * @param {{ olderThanMinutes?: number }} [options]
 * @returns {Promise<number>} number of events reclaimed
 */
export const reclaimStaleProcessingWebhooks = async ({ olderThanMinutes = 15 } = {}) => {
  try {
    const [result] = await pool.execute(
      `UPDATE webhook_events
       SET processing_status = 'failed',
           last_error = 'reclaimed by reconciliation (stale processing)'
       WHERE processing_status = 'processing'
         AND processed_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [String(Math.max(5, Number(olderThanMinutes) || 15))]
    );
    if (result.affectedRows > 0) {
 console.log(` Reclaimed ${result.affectedRows} stale processing webhook event(s)`);
    }
    return result.affectedRows;
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
 console.warn('webhook_events table missing — run `node migrateHardening.js` / `db:migrate` before enabling webhooks.');
    } else {
 console.error(' Webhook reclaim failed:', error.message);
    }
    return 0;
  }
};