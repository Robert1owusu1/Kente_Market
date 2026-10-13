// FILE LOCATION: backend/routes/adminOpsRoutes.js
// DESCRIPTION: Read endpoints for the ops-hardening tables (Phase 4/5):
//   GET /api/admin/ops/audit-log      — latest admin audit entries
//   GET /api/admin/ops/scheduler-jobs — last-run status of every scheduler job
//   GET /api/admin/ops/reconciliation-reviews — durable list of recovery items
//       that need a human (FV-6 stale refund claims, FV-7 stuck-pending orders)
import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import pool from '../config/db.js';

const router = express.Router();

router.use(protect, admin);

router.get('/audit-log', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    if (!Number.isFinite(limit) || limit < 1) {
      return res.status(400).json({ message: 'Invalid limit' });
    }
    // Inlined integer (TiDB rejects LIMIT ? parameter markers).
    const [rows] = await pool.execute(
      `SELECT id, actorId, actorRole, actorEmail, action, entityType, entityId,
              beforeVal, afterVal, ip, created_at
       FROM admin_audit_log
       ORDER BY id DESC LIMIT ${Math.min(limit, 500)}`,
    );
    // JSON columns come back as parsed objects via mysql2; keep them as-is.
    res.json({ count: rows.length, entries: rows });
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({ message: 'admin_audit_log table missing — run `node migrateOps.js`.' });
    }
    res.status(500).json({ message: 'Failed to load audit log' });
  }
});

router.get('/scheduler-jobs', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT jobName, lastStatus, lastRunAt, lastDurationMs, lastAffected, lastError, updatedAt
       FROM scheduler_job_status
       ORDER BY lastRunAt DESC`
    );
    res.json({ count: rows.length, entries: rows });
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({ message: 'scheduler_job_status table missing — run `node migrateOps.js`.' });
    }
    res.status(500).json({ message: 'Failed to load scheduler status' });
  }
});

const REVIEW_JOBS = ['staleRefundClaim', 'stuckPending', 'refundAfterRelease'];

router.get('/reconciliation-reviews', async (req, res) => {
  const job = req.query.job == null || req.query.job === '' ? null : String(req.query.job);
  if (job !== null && !REVIEW_JOBS.includes(job)) {
    return res.status(400).json({ message: `job must be one of ${REVIEW_JOBS.join(', ')}` });
  }
  const state = req.query.state == null || req.query.state === '' ? 'needs_review' : String(req.query.state);
  if (!['needs_review', 'waiting', 'resolved'].includes(state)) {
    return res.status(400).json({ message: 'state must be needs_review, waiting or resolved' });
  }
  try {
    const [rows] = await pool.execute(
      `SELECT rc.job, rc.entityId AS orderId, rc.state, rc.reviewReason, rc.detail, rc.checkCount,
              rc.firstSeenAt, rc.lastCheckedAt, rc.nextCheckAt, rc.alertedAt,
              o.paymentStatus, o.orderStatus, o.totalAmount, o.refundReference IS NOT NULL AS hasRefundClaim
         FROM reconciliation_checks rc
         LEFT JOIN orders o ON o.id = rc.entityId
        WHERE rc.state = ? ${job ? 'AND rc.job = ?' : ''}
        ORDER BY rc.firstSeenAt ASC
        LIMIT 500`,
      job ? [state, job] : [state]
    );
    res.json({ count: rows.length, items: rows });
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({ message: 'reconciliation_checks table missing — run `node migrateReconciliationChecks.js`.' });
    }
    res.status(500).json({ message: 'Failed to load reconciliation reviews' });
  }
});

export default router;