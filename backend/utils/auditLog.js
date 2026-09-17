// FILE LOCATION: backend/utils/auditLog.js
// DESCRIPTION: Append-only audit log for privileged / financial admin actions.
//              Best-effort: a logging failure must never fail the admin action
//              being audited. Wired into retryEscrowPayouts, cancelOrder,
//              coupon/promotion/settings/moderation mutation controllers and
//              the scheduler failure alert path.
import pool from '../config/db.js';

/** Guard against a req that may be undefined (scheduler/system callers). */
const safeStr = (v) => (v == null ? null : String(v).slice(0, 2000));

/**
 * Record one admin action row.
 * @param {{
 *   actor?: { id: number | string | null, role?: string, email?: string | null } | null,
 *   action: string,
 *   entityType?: string | null,
 *   entityId?: string | number | null,
 *   before?: any,
 *   after?: any,
 *   req?: import('express').Request,
 * }} params
 */
export const recordAdminAction = async ({ actor, action, entityType, entityId, before, after, req }) => {
  try {
    await pool.execute(
      `INSERT INTO admin_audit_log
         (actorId, actorRole, actorEmail, action, entityType, entityId, beforeVal, afterVal, ip, userAgent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actor?.id ?? null,
        actor?.role ?? null,
        safeStr(actor?.email),
        action,
        safeStr(entityType),
        safeStr(entityId),
        before == null ? null : JSON.stringify(before),
        after == null ? null : JSON.stringify(after),
        safeStr(req?.ip),
        safeStr(req?.get?.('user-agent')),
      ]
    );
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      console.warn('⚠️  admin_audit_log table missing — run `node migrateOps.js`. Skipping audit entry.');
    } else {
      console.warn(`⚠️  Could not write admin audit log: ${error.message}`);
    }
  }
};

/**
 * Convenience wrapper when acting on a request: derives the actor from
 * req.user and captures ip/useragent automatically.
 * @param {import('express').Request} req
 * @param {{ action: string, entityType?: string, entityId?: string | number, before?: any, after?: any }} params
 */
export const auditFromRequest = (req, { action, entityType, entityId, before, after }) =>
  recordAdminAction({
    actor: req.user ? { id: req.user.id, role: req.user.role, email: req.user.email } : null,
    action,
    entityType,
    entityId,
    before,
    after,
    req,
  });