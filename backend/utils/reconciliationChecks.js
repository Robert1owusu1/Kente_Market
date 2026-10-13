// @ts-check
// FILE LOCATION: backend/utils/reconciliationChecks.js
// DESCRIPTION: Durable per-entity state for recovery/reconciliation jobs
//              (FV-6, FV-7). Table `reconciliation_checks`, keyed (job, entityId):
//   - lastCheckedAt / nextCheckAt / checkCount → jobs select "due, least
//     recently checked first", so rows that never resolve cannot starve the
//     rest, and each job can back off on rows that keep giving the same answer;
//   - state + reviewReason → a durable list of items that need a human
//     (`needs_review`), queryable by operators instead of living only in logs;
//   - alertedReason / alertedAt → at most one admin alert per (entity, reason)
//     per REALERT_HOURS (the conditional UPDATE is the dedupe gate, so
//     concurrent workers alert once).
// Missing table (migration not run) degrades to the old behaviour: the job
// still runs, nothing is recorded, alerts are sent un-deduplicated.
import pool from '../config/db.js';
import { notifyAdmins } from './adminAlerts.js';

const REALERT_HOURS = 24;

/** @typedef {'waiting' | 'needs_review' | 'resolved'} CheckState */

/**
 * Record the outcome of one check.
 * @param {string} job e.g. 'staleRefundClaim', 'stuckPending'
 * @param {number} entityId e.g. order id
 * @param {{ state: CheckState, reason?: string | null, detail?: string | null, nextCheckMinutes?: number }} outcome
 */
export const recordCheck = async (job, entityId, { state, reason = null, detail = null, nextCheckMinutes = 15 }) => {
  const minutes = Math.max(1, Math.floor(Number(nextCheckMinutes) || 15));
  try {
    await pool.execute(
      `INSERT INTO reconciliation_checks (job, entityId, state, reviewReason, detail, checkCount, lastCheckedAt, nextCheckAt, resolvedAt)
       VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, DATE_ADD(NOW(), INTERVAL ${minutes} MINUTE),
               CASE WHEN ? = 'resolved' THEN CURRENT_TIMESTAMP ELSE NULL END)
       ON DUPLICATE KEY UPDATE
         state = VALUES(state), reviewReason = VALUES(reviewReason), detail = VALUES(detail),
         checkCount = checkCount + 1, lastCheckedAt = CURRENT_TIMESTAMP, nextCheckAt = VALUES(nextCheckAt),
         resolvedAt = CASE WHEN VALUES(state) = 'resolved' THEN COALESCE(resolvedAt, CURRENT_TIMESTAMP) ELSE NULL END`,
      [job, entityId, state, reason ? String(reason).slice(0, 64) : null, detail ? String(detail).slice(0, 500) : null, state]
    );
    return true;
  } catch (err) {
    if (err?.code !== 'ER_NO_SUCH_TABLE') console.error(`reconciliation_checks write failed (${job}/${entityId}): ${err?.message}`);
    return false;
  }
};

/**
 * Admin alert at most once per (job, entity, reason) per REALERT_HOURS.
 * @param {string} job
 * @param {number} entityId
 * @param {string} reason
 * @param {string} title
 * @param {string} message
 * @returns {Promise<boolean>} true if an alert was sent
 */
export const alertOnce = async (job, entityId, reason, title, message) => {
  const code = String(reason).slice(0, 64);
  try {
    const [res] = /** @type {any} */ (await pool.execute(
      `UPDATE reconciliation_checks SET alertedReason = ?, alertedAt = CURRENT_TIMESTAMP
        WHERE job = ? AND entityId = ?
          AND (alertedReason IS NULL OR alertedReason <> ? OR alertedAt < DATE_SUB(NOW(), INTERVAL ${REALERT_HOURS} HOUR))`,
      [code, job, entityId, code]
    ));
    if (res.affectedRows !== 1) return false;
  } catch (err) {
    if (err?.code !== 'ER_NO_SUCH_TABLE') throw err;
    // Table missing: fall through and alert (pre-migration behaviour).
  }
  await notifyAdmins(title, message, { link: '/admin?section=orders', type: 'system' });
  return true;
};

/**
 * Record a check AND (optionally) alert, deduplicated.
 * @param {string} job
 * @param {number} entityId
 * @param {{ state: CheckState, reason: string, detail?: string, nextCheckMinutes?: number, alert?: { title: string, message: string } | null }} outcome
 */
export const recordCheckAndAlert = async (job, entityId, { state, reason, detail, nextCheckMinutes, alert = null }) => {
  const recorded = await recordCheck(job, entityId, { state, reason, detail: detail ?? alert?.message ?? null, nextCheckMinutes });
  if (!alert) return;
  // No row to dedupe against (table missing / write failed): never swallow the alert.
  if (recorded) await alertOnce(job, entityId, reason, alert.title, alert.message);
  else await notifyAdmins(alert.title, alert.message, { link: '/admin?section=orders', type: 'system' });
};

/**
 * SQL fragments for a job's candidate query: LEFT JOIN + "due" filter +
 * fair ordering (never checked first, then least recently checked).
 * @param {string} job literal job name (validated)
 * @param {string} entityColumn e.g. 'o.id'
 */
export const dueJoin = (job, entityColumn) => {
  if (!/^[A-Za-z]+$/.test(job) || !/^[a-z]+\.[A-Za-z]+$/.test(entityColumn)) throw new Error('invalid job/column');
  return {
    join: `LEFT JOIN reconciliation_checks rc ON rc.job = '${job}' AND rc.entityId = ${entityColumn}`,
    due: `(rc.nextCheckAt IS NULL OR rc.nextCheckAt <= NOW())`,
    order: `(rc.lastCheckedAt IS NOT NULL) ASC, rc.lastCheckedAt ASC, ${entityColumn} ASC`,
  };
};
