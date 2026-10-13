// @ts-check
// FILE LOCATION: backend/migrateReconciliationChecks.js
// DESCRIPTION: Durable per-entity state for recovery jobs (FV-6 stale refund
//              claims, FV-7 stuck-pending orders): rotation/backoff, a durable
//              "needs human review" list, and alert de-duplication. One new
//              table; no change to existing tables. Idempotent; fails loudly.
// Run from backend/:  node migrateReconciliationChecks.js
import pool from './config/db.js';

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reconciliation_checks (
      job VARCHAR(48) NOT NULL,
      entityId BIGINT NOT NULL,
      state ENUM('waiting','needs_review','resolved') NOT NULL DEFAULT 'waiting',
      reviewReason VARCHAR(64) NULL,
      detail VARCHAR(500) NULL,
      checkCount INT NOT NULL DEFAULT 0,
      firstSeenAt TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      lastCheckedAt TIMESTAMP NULL,
      nextCheckAt TIMESTAMP NULL,
      alertedReason VARCHAR(64) NULL,
      alertedAt TIMESTAMP NULL,
      resolvedAt TIMESTAMP NULL,
      resolvedBy INT NULL,
      resolutionNote VARCHAR(1000) NULL,
      PRIMARY KEY (job, entityId),
      INDEX idx_recon_checks_state (job, state, lastCheckedAt),
      INDEX idx_recon_checks_due (job, nextCheckAt)
    ) ENGINE=InnoDB`);
  console.log('✅ reconciliation_checks ready');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`❌ migrateReconciliationChecks failed: ${err.message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
