// @ts-check
// SERVICES/transferReconciliationService.js
// Reconciliation + self-healing for the payout flow.
//
// 1. reconcileStuckTransfers: payout_attempts that remain 'processing' past
//    the provider SLA (e.g. a client timeout where Paystack accepted the
//    transfer but the response was lost) are verified directly against
//    Paystack and settled through the same idempotent settlement service the
//    webhook uses — success/failed/reversed can therefore never run twice.
// 2. reclaimStaleProcessingWebhooks: a webhook_events row stuck in
//    'processing' (e.g. the process died mid-settlement) is reset to 'failed'
//    so a redelivery — or the next reconciliation pass — can reclaim it.
//
// Both are safe to run from multiple replicas: every mutation is guarded by
// conditional claims and DB unique keys.
import axios from 'axios';
import pool from '../config/db.js';
import {
  settleTransferSuccess,
  settleTransferFailed,
  settleTransferReversed,
} from './transferSettlementService.js';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

/**
 * Reconcile payout_attempts stuck in 'processing' against Paystack.
 * @param {{ olderThanMinutes?: number, limit?: number }} [options]
 * @returns {Promise<{ verified: number, succeeded: number, failed: number, reversed: number, pending: number, errored: number }>}
 */
export const reconcileStuckTransfers = async ({
  olderThanMinutes = 30,
  limit = 25,
} = {}) => {
  const summary = { verified: 0, succeeded: 0, failed: 0, reversed: 0, pending: 0, errored: 0 };

  if (!PAYSTACK_SECRET_KEY) {
    console.warn('⚠️  PAYSTACK_SECRET_KEY not set — transfer reconciliation disabled');
    return summary;
  }

  let rows;
  try {
    [rows] = await pool.execute(
      `SELECT id, reference, providerReference, created_at
       FROM payout_attempts
       WHERE status = 'processing'
         AND created_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)
       ORDER BY created_at ASC
       LIMIT ?`,
      [String(Math.max(1, Number(olderThanMinutes) || 30)), String(Math.max(1, Number(limit) || 25))]
    );
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      console.warn('⚠️  payout_attempts table missing — run `node migrateHardening.js` / `db:migrate` (release gate). Reconciliation skipped.');
    } else {
      console.error('❌ Transfer reconciliation query failed:', error.message);
    }
    return summary;
  }

  for (const attempt of rows) {
    const queryRef = attempt.providerReference || attempt.reference;
    try {
      const resp = await axios.get(
        `https://api.paystack.co/transfer/verify/${encodeURIComponent(queryRef)}`,
        {
          headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
          timeout: 15000,
        }
      );
      const tx = resp.data?.data;
      if (!tx) {
        summary.errored += 1;
        continue;
      }
      summary.verified += 1;
      // Use the provider's own transfer reference so the settlement look-up
      // matches what transfer webhooks carry.
      const transferRef = tx.reference || queryRef;
      switch (String(tx.status).toLowerCase()) {
        case 'success':
          await settleTransferSuccess(transferRef);
          summary.succeeded += 1;
          break;
        case 'failed':
          await settleTransferFailed(transferRef);
          summary.failed += 1;
          break;
        case 'reversed':
          await settleTransferReversed(transferRef);
          summary.reversed += 1;
          break;
        default:
          // 'pending' / 'abandoned' / unknown — leave for the next pass.
          summary.pending += 1;
          break;
      }
    } catch (error) {
      summary.errored += 1;
      console.warn(`⚠️  Transfer reconciliation failed for ${queryRef}: ${error.message}`);
    }
  }

  if (rows.length > 0) {
    console.log(`🔁 Reconciled ${summary.verified}/${rows.length} stuck transfer(s)`, summary);
  }
  return summary;
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
      console.log(`🔁 Reclaimed ${result.affectedRows} stale processing webhook event(s)`);
    }
    return result.affectedRows;
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      console.warn('⚠️  webhook_events table missing — run `node migrateHardening.js` / `db:migrate` before enabling webhooks.');
    } else {
      console.error('❌ Webhook reclaim failed:', error.message);
    }
    return 0;
  }
};