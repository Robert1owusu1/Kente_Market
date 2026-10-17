// @ts-check
// FILE LOCATION: backend/migrateTryOnJobs.js
// DESCRIPTION: AI try-on job tracking (AI_TRYON_ARCHITECTURE.md). Replaces the
//              in-memory prediction map, which lost every job on restart and
//              could not work across instances. Creates ai_tryon_jobs:
//              one row per try-on with the product it is bound to, the
//              provider's job reference, status, a fixed error code, the
//              private result key, deadline and result expiry.
//              It deliberately has NO column for photo bytes, image URLs or
//              provider error text.
//              Additive and idempotent (CREATE TABLE IF NOT EXISTS); touches
//              no existing table. Fails loudly.
// Run from backend/:  node migrateTryOnJobs.js   (also part of npm run db:migrate)
import pool from './config/db.js';

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_tryon_jobs (
      id CHAR(36) NOT NULL PRIMARY KEY COMMENT 'internal job id (UUID v4)',
      userId INT NOT NULL COMMENT 'owner; only this user can read the job or its result',
      productId INT NOT NULL COMMENT 'catalog product the job is bound to (server-resolved)',
      vendorId INT NULL COMMENT 'product vendor at submit time; NULL = platform product',
      provider VARCHAR(40) NOT NULL COMMENT 'adapter id, e.g. replicate-idm-vton',
      providerJobId VARCHAR(128) NULL COMMENT 'provider reference, set once accepted',
      idempotencyKey VARCHAR(64) NOT NULL COMMENT 'client key: a repeated submit returns this job',
      status ENUM('queued','processing','succeeded','failed','canceled','expired') NOT NULL DEFAULT 'queued',
      garmentCategory VARCHAR(20) NULL,
      errorCode VARCHAR(40) NULL COMMENT 'fixed code from Services/tryOn/errors.js, never provider text',
      resultKey VARCHAR(80) NULL COMMENT 'private result file name; NULL until succeeded',
      pollAttempts INT NOT NULL DEFAULT 0,
      nextPollAt DATETIME NULL,
      consentAt DATETIME NOT NULL COMMENT 'customer confirmed photo processing',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      completedAt DATETIME NULL,
      deadlineAt DATETIME NOT NULL COMMENT 'job is stopped (and cancelled at the provider) after this',
      expiresAt DATETIME NULL COMMENT 'result image deleted after this',
      UNIQUE KEY uq_tryon_idempotency (userId, idempotencyKey),
      UNIQUE KEY uq_tryon_provider_job (provider, providerJobId),
      KEY idx_tryon_status_poll (status, nextPollAt),
      KEY idx_tryon_user_status (userId, status),
      KEY idx_tryon_status_deadline (status, deadlineAt),
      KEY idx_tryon_status_expires (status, expiresAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('✅ ai_tryon_jobs created/verified');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`❌ migrateTryOnJobs failed: ${/** @type {any} */ (err).message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
