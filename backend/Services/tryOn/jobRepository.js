// FILE LOCATION: backend/Services/tryOn/jobRepository.js
// DESCRIPTION: SQL for ai_tryon_jobs (see migrateTryOnJobs.js). Every state
//              change is a compare-and-set on the current status, so a
//              repeated webhook, a racing poll and the sweeper can all touch
//              the same job and only the first legal transition lands.
//              No photo bytes, provider URLs or provider error text are ever
//              written here.
import pool from '../../config/db.js';

export const ACTIVE_STATUSES = Object.freeze(['queued', 'processing']);

const COLUMNS = `id, userId, productId, vendorId, provider, providerJobId, idempotencyKey,
  status, garmentCategory, errorCode, resultKey, pollAttempts, nextPollAt,
  consentAt, createdAt, updatedAt, completedAt, deadlineAt, expiresAt`;

const one = async (sql, params) => {
  const [rows] = await pool.execute(sql, params);
  return rows[0] || null;
};

const jobRepository = {
  /** Insert a queued job. Throws ER_DUP_ENTRY on a repeated idempotency key. */
  async insert({ id, userId, productId, vendorId, provider, idempotencyKey, garmentCategory, timeoutMinutes }) {
    await pool.execute(
      `INSERT INTO ai_tryon_jobs
         (id, userId, productId, vendorId, provider, idempotencyKey, status, garmentCategory,
          consentAt, deadlineAt)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, NOW(), DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
      [id, userId, productId, vendorId ?? null, provider, idempotencyKey, garmentCategory, timeoutMinutes],
    );
  },

  findById(id) {
    return one(`SELECT ${COLUMNS} FROM ai_tryon_jobs WHERE id = ?`, [id]);
  },

  findForUser(id, userId) {
    return one(`SELECT ${COLUMNS} FROM ai_tryon_jobs WHERE id = ? AND userId = ?`, [id, userId]);
  },

  findByIdempotencyKey(userId, idempotencyKey) {
    return one(
      `SELECT ${COLUMNS} FROM ai_tryon_jobs WHERE userId = ? AND idempotencyKey = ?`,
      [userId, idempotencyKey],
    );
  },

  findByProviderJob(provider, providerJobId) {
    return one(
      `SELECT ${COLUMNS} FROM ai_tryon_jobs WHERE provider = ? AND providerJobId = ?`,
      [provider, providerJobId],
    );
  },

  /** Only a job that never reached the provider may be deleted (pre-submit refusal). */
  async deleteUnsubmitted(id) {
    await pool.execute(
      `DELETE FROM ai_tryon_jobs WHERE id = ? AND status = 'queued' AND providerJobId IS NULL`,
      [id],
    );
  },

  /** Jobs still holding provider capacity (not past their deadline). */
  async countActive(userId = null) {
    const [[row]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM ai_tryon_jobs
       WHERE status IN ('queued', 'processing') AND deadlineAt > NOW()
         ${userId === null ? '' : 'AND userId = ?'}`,
      userId === null ? [] : [userId],
    );
    return Number(row?.n || 0);
  },

  /** queued -> processing once the provider accepted the job. */
  async markSubmitted(id, providerJobId, firstPollSeconds) {
    const [r] = await pool.execute(
      `UPDATE ai_tryon_jobs
       SET status = 'processing', providerJobId = ?, nextPollAt = DATE_ADD(NOW(), INTERVAL ? SECOND)
       WHERE id = ? AND status = 'queued'`,
      [providerJobId, firstPollSeconds, id],
    );
    return r.affectedRows === 1;
  },

  /**
   * Claim the right to poll the provider for this job now. Exactly one
   * caller wins per interval, so client polling, the sweeper and webhooks
   * cannot stampede the provider. Backoff grows with the attempt count.
   */
  async claimPoll(id) {
    // nextPollAt is assigned FIRST so it reads the pre-increment attempt
    // count under both MySQL's left-to-right SET evaluation and standard SQL
    // (old values): backoff 5, 10, 20, 30, 30 ... seconds.
    const [r] = await pool.execute(
      `UPDATE ai_tryon_jobs
       SET nextPollAt = DATE_ADD(NOW(), INTERVAL LEAST(30, 5 * POW(2, LEAST(pollAttempts, 3))) SECOND),
           pollAttempts = pollAttempts + 1
       WHERE id = ? AND status = 'processing'
         AND (nextPollAt IS NULL OR nextPollAt <= NOW())`,
      [id],
    );
    return r.affectedRows === 1;
  },

  /** queued|processing -> succeeded with a stored result. */
  async markSucceeded(id, resultKey, ttlHours) {
    const [r] = await pool.execute(
      `UPDATE ai_tryon_jobs
       SET status = 'succeeded', resultKey = ?, errorCode = NULL, completedAt = NOW(),
           expiresAt = DATE_ADD(NOW(), INTERVAL ? HOUR), nextPollAt = NULL
       WHERE id = ? AND status IN ('queued', 'processing')`,
      [resultKey, ttlHours, id],
    );
    return r.affectedRows === 1;
  },

  /** queued|processing -> failed|canceled|expired with a fixed error code. */
  async markEnded(id, status, errorCode) {
    if (!['failed', 'canceled', 'expired'].includes(status)) throw new Error(`bad end status ${status}`);
    const [r] = await pool.execute(
      `UPDATE ai_tryon_jobs
       SET status = ?, errorCode = ?, completedAt = NOW(), nextPollAt = NULL
       WHERE id = ? AND status IN ('queued', 'processing')`,
      [status, errorCode, id],
    );
    return r.affectedRows === 1;
  },

  /** succeeded -> expired once the result's retention has passed. */
  async markResultExpired(id) {
    const [r] = await pool.execute(
      `UPDATE ai_tryon_jobs
       SET status = 'expired', errorCode = 'result_expired', resultKey = NULL
       WHERE id = ? AND status = 'succeeded'`,
      [id],
    );
    return r.affectedRows === 1;
  },

  async listDuePolls(limit) {
    const [rows] = await pool.execute(
      `SELECT ${COLUMNS} FROM ai_tryon_jobs
       WHERE status = 'processing' AND nextPollAt <= NOW() AND deadlineAt > NOW()
       ORDER BY nextPollAt LIMIT ${Number(limit) | 0}`,
    );
    return rows;
  },

  async listPastDeadline(limit) {
    const [rows] = await pool.execute(
      `SELECT ${COLUMNS} FROM ai_tryon_jobs
       WHERE status IN ('queued', 'processing') AND deadlineAt <= NOW()
       ORDER BY deadlineAt LIMIT ${Number(limit) | 0}`,
    );
    return rows;
  },

  /** queued rows that never got a provider id: the process died mid-submit. */
  async listStaleQueued(olderThanSeconds, limit) {
    const [rows] = await pool.execute(
      `SELECT ${COLUMNS} FROM ai_tryon_jobs
       WHERE status = 'queued' AND providerJobId IS NULL
         AND createdAt < DATE_SUB(NOW(), INTERVAL ? SECOND)
       ORDER BY createdAt LIMIT ${Number(limit) | 0}`,
      [olderThanSeconds],
    );
    return rows;
  },

  async listExpiredResults(limit) {
    const [rows] = await pool.execute(
      `SELECT ${COLUMNS} FROM ai_tryon_jobs
       WHERE status = 'succeeded' AND expiresAt <= NOW()
       ORDER BY expiresAt LIMIT ${Number(limit) | 0}`,
    );
    return rows;
  },

  /** Ids (of the given set) that still own a live result. */
  async liveResultIds(ids) {
    if (ids.length === 0) return new Set();
    const [rows] = await pool.execute(
      `SELECT id FROM ai_tryon_jobs
       WHERE status = 'succeeded' AND id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
    return new Set(rows.map((r) => r.id));
  },

  /**
   * Atomically consume one of today's try-on credits (ai_tryon_usage, the
   * pre-existing per-user daily cap). Not refunded on failure: a provider
   * may bill for a run whose result we never get.
   * @returns {Promise<boolean>} false when the user is over the limit
   */
  async reserveDailyCredit(userId, dailyLimit) {
    const today = new Date().toISOString().slice(0, 10);
    await pool.execute(
      `INSERT INTO ai_tryon_usage (userId, usage_date, count)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE count = count + 1`,
      [userId, today],
    );
    const [[row]] = await pool.execute(
      `SELECT count FROM ai_tryon_usage WHERE userId = ? AND usage_date = ?`,
      [userId, today],
    );
    return (row?.count || 0) <= dailyLimit;
  },

  /** Drop ended job metadata after the retention window. */
  async purgeEnded(retentionDays, limit) {
    const [r] = await pool.execute(
      `DELETE FROM ai_tryon_jobs
       WHERE status IN ('failed', 'canceled', 'expired')
         AND updatedAt < DATE_SUB(NOW(), INTERVAL ? DAY)
       LIMIT ${Number(limit) | 0}`,
      [retentionDays],
    );
    return r.affectedRows || 0;
  },
};

export default jobRepository;
