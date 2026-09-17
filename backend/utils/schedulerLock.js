// FILE LOCATION: backend/utils/schedulerLock.js
// DESCRIPTION: MySQL-backed distributed lock for scheduled jobs. Lets the
//              financial schedulers run on exactly ONE replica without a
//              broker: jobs that affect money (escrow release, payout
//              reconciliation, reservation release) must not be double-run.
//
//              Contract:
//                acquireLock(name, { ttlMs, token })
//                  -> true when THIS process now holds the lock (either fresh
//                     or a still-valid renew). Atomic compare-and-swap on the
//                     row: (already our token) OR (expired → steal).
//                renewLock(name, token, { ttlMs }) -> bool
//                releaseLock(name, token)          -> bool
//
//              The holder keeps calling renewLock on a heartbeat. If a replica
//              dies the lock simply expires and the next runner steals it.
import pool from '../config/db.js';
import os from 'os';
import crypto from 'crypto';

export const defaultLockTtlMs = 10 * 60 * 1000; // 10 minutes

export const generateLockToken = () => crypto.randomUUID();

const checkLockInfra = (error) => {
  if (error && (error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_FIELD_ERROR')) {
    console.warn('⚠️  scheduler_locks table missing — run `node migrateOps.js`. Scheduler running WITHOUT the distributed lock.');
    return false;
  }
  return true;
};

const secondsFor = (ttlMs) => Math.max(1, Math.ceil((ttlMs || defaultLockTtlMs) / 1000));

/**
 * Atomic acquire-or-renew. Safe under concurrency because MySQL serializes the
 * UPDATE on the single lock row.
 * @param {string} name
 * @param {{ ttlMs?: number, token?: string, owner?: string }} [opts]
 * @returns {Promise<boolean>}
 */
export const acquireLock = async (name, opts = {}) => {
  const ttlSec = secondsFor(opts.ttlMs);
  const token = opts.token || generateLockToken();
  const owner = opts.owner || `${os.hostname()}:${process.pid}:${token.slice(0, 8)}`;
  try {
    // Ensure the row exists so the CAS UPDATE below always has a row to lock.
    await pool.execute(
      `INSERT IGNORE INTO scheduler_locks (lockName, token, owner, acquiredAt, expiresAt)
       VALUES (?, '', '', NULL, DATE_SUB(NOW(), INTERVAL 1 DAY))`,
      [name]
    );
    const [result] = await pool.execute(
      `UPDATE scheduler_locks
       SET token = ?, owner = ?, acquiredAt = NOW(),
           expiresAt = DATE_ADD(NOW(), INTERVAL ? SECOND)
       WHERE lockName = ?
         AND (token = ? OR expiresAt IS NULL OR expiresAt < NOW())`,
      [token, owner, ttlSec, name, token] // same token ⇒ same holder renewing
    );
    return result.affectedRows === 1;
  } catch (error) {
    if (!checkLockInfra(error)) return true; // infra missing → run unlocked (fail-open)
    throw error;
  }
};

/**
 * Heartbeat: extend the holder's lease. Returns false when the lease was lost.
 * @param {string} name
 * @param {string} token
 * @param {{ ttlMs?: number }} [opts]
 */
export const renewLock = async (name, token, opts = {}) => {
  const ttlSec = secondsFor(opts.ttlMs);
  try {
    const [result] = await pool.execute(
      `UPDATE scheduler_locks
       SET expiresAt = DATE_ADD(NOW(), INTERVAL ? SECOND), updatedAt = CURRENT_TIMESTAMP
       WHERE lockName = ? AND token = ?`,
      [ttlSec, name, token]
    );
    return result.affectedRows === 1;
  } catch (error) {
    if (!checkLockInfra(error)) return true;
    throw error;
  }
};

/** Only the current holder can release the lock. */
export const releaseLock = async (name, token) => {
  try {
    const [result] = await pool.execute(
      `DELETE FROM scheduler_locks WHERE lockName = ? AND token = ?`,
      [name, token]
    );
    return result.affectedRows === 1;
  } catch (error) {
    if (!checkLockInfra(error)) return true;
    throw error;
  }
};

/**
 * Convenience wrapper: acquire → heartbeat → run → always release.
 * @param {string} name
 * @param {() => Promise<any>} run
 * @param {{ ttlMs?: number, onSkip?: () => void }} [opts]
 */
export const withLock = async (name, run, opts = {}) => {
  const token = generateLockToken();
  const ttlMs = opts.ttlMs || defaultLockTtlMs;
  const acquired = await acquireLock(name, { ttlMs, token });
  if (!acquired) {
    if (opts.onSkip) opts.onSkip();
    return false;
  }

  // Heartbeat while the job runs; unref'd so it never keeps the process alive.
  const heartbeat = setInterval(() => {
    renewLock(name, token, { ttlMs }).catch((err) => {
      console.error(`❌ Lock heartbeat failed for "${name}":`, err.message);
    });
  }, Math.floor(ttlMs / 3));
  if (heartbeat.unref) heartbeat.unref();

  try {
    await run();
    return true;
  } finally {
    clearInterval(heartbeat);
    await releaseLock(name, token).catch(() => {});
  }
};