// FILE LOCATION: backend/routes/adminOpsRoutes.js
// DESCRIPTION: Read endpoints for the ops-hardening tables (Phase 4/5):
//   GET /api/admin/ops/audit-log      — latest admin audit entries
//   GET /api/admin/ops/scheduler-jobs — last-run status of every scheduler job
import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import pool from '../config/db.js';

const router = express.Router();

router.use(protect, admin);

router.get('/audit-log', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const [rows] = await pool.execute(
      `SELECT id, actorId, actorRole, actorEmail, action, entityType, entityId,
              beforeVal, afterVal, ip, created_at
       FROM admin_audit_log
       ORDER BY id DESC LIMIT ?`,
      [limit]
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

export default router;