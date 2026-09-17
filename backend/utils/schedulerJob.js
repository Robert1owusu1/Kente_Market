// FILE LOCATION: backend/utils/schedulerJob.js
// DESCRIPTION: Wraps every scheduled job so it (a) runs with the distributed
//              lock (one replica), (b) persists last-run status for admin
//              visibility (/api/admin/ops/scheduler-jobs), and (c) alerts the
//              admins by email when a job fails — throttled to once/day/job.
import pool from '../config/db.js';
import { withLock } from './schedulerLock.js';
import { recordAdminAction } from './auditLog.js';

const FAILURE_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Record (or update) a job's last run in scheduler_job_status.
 */
const recordJobStatus = async (jobName, status, { error, affected, durationMs } = {}) => {
  try {
    await pool.execute(
      `INSERT INTO scheduler_job_status (jobName, lastStatus, lastRunAt, lastDurationMs, lastAffected, lastError)
       VALUES (?, ?, NOW(), ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         lastStatus = VALUES(lastStatus),
         lastRunAt = VALUES(lastRunAt),
         lastDurationMs = VALUES(lastDurationMs),
         lastAffected = VALUES(lastAffected),
         lastError = VALUES(lastError)`,
      [jobName, status, durationMs ?? null, affected ?? null, error ? String(error).slice(0, 2000) : null]
    );
  } catch (err) {
    console.warn(`⚠️  Could not record status for "${jobName}":`, err.message);
  }
};

const maybeAlertAdmins = async (jobName, errorMessage) => {
  try {
    const [rows] = await pool.execute(
      `SELECT lastFailureAlertAt FROM scheduler_job_status WHERE jobName = ?`,
      [jobName]
    );
    const lastAlert = rows[0]?.lastFailureAlertAt ? new Date(rows[0].lastFailureAlertAt).getTime() : 0;
    if (Date.now() - lastAlert < FAILURE_ALERT_COOLDOWN_MS) return;

    // Throttle FIRST (atomic), then email — so racing failures send one mail.
    const [claim] = await pool.execute(
      `UPDATE scheduler_job_status
       SET lastFailureAlertAt = NOW()
       WHERE jobName = ? AND (lastFailureAlertAt IS NULL OR lastFailureAlertAt < DATE_SUB(NOW(), INTERVAL 24 HOUR))`,
      [jobName]
    );
    if (claim.affectedRows !== 1) return;

    const [adminUsers] = await pool.execute(
      `SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL LIMIT 3`
    );
    const { sendEmailSafely } = await import('./emailService.js');
    for (const admin of adminUsers) {
      await sendEmailSafely(
        admin.email,
        `⚠️ Scheduled job failed: ${jobName}`,
        `<p>A production scheduled job failed:</p><pre>${String(errorMessage).slice(0, 2000)}</pre><p>Check backend logs and the scheduler status table.</p>`
      );
    }
    try {
      await recordAdminAction({
        actor: { id: null, role: 'system', email: null },
        action: 'job.alert',
        entityType: 'scheduler_job',
        entityId: jobName,
        after: { error: String(errorMessage).slice(0, 500) },
      });
    } catch { /* best-effort */ }
  } catch (err) {
    console.warn(`⚠️  Admin failure alert could not be sent for "${jobName}":`, err.message);
  }
};

/**
 * Run a scheduled job under the distributed lock, persist status, alert on
 * failure. Returns true when THIS process executed the job, false when another
 * replica holds the lock (or the job simply isn't due).
 * @param {string} jobName lock + status identity, e.g. 'reconcileStuckTransfers'
 * @param {() => Promise<any>} jobFn resolves to a count/result when useful
 * @param {{ ttlMs?: number }} [opts]
 */
export const runScheduledJob = async (jobName, jobFn, opts = {}) => {
  const lockName = `job:${jobName}`;
  let executed = false;
  try {
    await withLock(lockName, async () => {
      const started = Date.now();
      executed = true;
      try {
        const affected = await jobFn();
        await recordJobStatus(jobName, 'ok', { affected, durationMs: Date.now() - started });
      } catch (error) {
        console.error(`❌ Scheduled job "${jobName}" failed:`, error.message);
        await recordJobStatus(jobName, 'failed', { error: error.message, durationMs: Date.now() - started });
        await maybeAlertAdmins(jobName, error.message);
      }
    }, { ttlMs: opts.ttlMs });
  } catch (error) {
    // e.g. lock infra unavailable → fail-open by running directly.
    console.warn(`⚠️  Lock unavailable for "${jobName}" — running unlocked:`, error.message);
    try {
      await jobFn();
      executed = true;
    } catch (runError) {
      console.error(`❌ Scheduled job "${jobName}" failed (unlocked):`, runError.message);
      await recordJobStatus(jobName, 'failed', { error: runError.message });
      await maybeAlertAdmins(jobName, runError.message);
    }
  }
  return executed;
};