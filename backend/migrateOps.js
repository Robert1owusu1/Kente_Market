// FILE LOCATION: backend/migrateOps.js
// DESCRIPTION: Operations-hardening migration (Phases 4-6). Additive and
//              idempotent — never drops or disturbs existing data.
//   - scheduler_locks:       distributed lock table so financial scheduler
//                            jobs run on exactly one replica (no double-run).
//   - scheduler_job_status:  last-run status + affected counts + failure
//                            alert throttle for every scheduled job.
//   - admin_audit_log:       append-only record of privileged/financial
//                            admin actions (who changed what, before/after).
//   - users.tokenVersion:    revokes outstanding sessions when credentials
//                            change (password reset / profile change / OAuth
//                            account adoption) — concurrent-login invalidation.
// Run from backend/:  node migrateOps.js
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { mysqlTls } from './config/mysqlTls.js';

dotenv.config();

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  ssl: mysqlTls(),
  multipleStatements: true,
});

const tableExists = async (table) => {
  const [[res]] = await connection.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return !!(res && res.c > 0);
};

const columnExists = async (table, column) => {
  const [[res]] = await connection.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return !!(res && res.c > 0);
};

try {
  // ============================================================
  // 1. DISTRIBUTED SCHEDULER LOCKS
  // ============================================================
  if (!(await tableExists('scheduler_locks'))) {
    await connection.query(`
      CREATE TABLE scheduler_locks (
        lockName VARCHAR(100) PRIMARY KEY COMMENT 'job identity, e.g. job:reconcileStuckTransfers',
        token CHAR(36) NOT NULL COMMENT 'holder token (UUID); only the holder may renew/release',
        owner VARCHAR(191) DEFAULT NULL COMMENT 'hostname/pid of the holder',
        acquiredAt DATETIME NULL,
        expiresAt DATETIME NULL COMMENT 'deadline; expired locks are stealable catch-up',
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB`);
    console.log('✅ Created scheduler_locks table');
  } else {
    console.log('ℹ️  scheduler_locks already exists — skipping');
  }

  // ============================================================
  // 2. SCHEDULER JOB STATUS + FAILURE ALERT THROTTLE
  // ============================================================
  if (!(await tableExists('scheduler_job_status'))) {
    await connection.query(`
      CREATE TABLE scheduler_job_status (
        jobName VARCHAR(100) PRIMARY KEY,
        lastStatus ENUM('ok','failed','skipped') NOT NULL DEFAULT 'skipped',
        lastRunAt DATETIME NULL,
        lastDurationMs INT NULL,
        lastAffected INT NULL,
        lastError TEXT NULL,
        lastFailureAlertAt DATETIME NULL COMMENT 'throttles admin alert emails to 1/day/job',
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB`);
    console.log('✅ Created scheduler_job_status table');
  } else {
    console.log('ℹ️  scheduler_job_status already exists — skipping');
  }

  // ============================================================
  // 3. ADMIN AUDIT LOG (append-only)
  // ============================================================
  if (!(await tableExists('admin_audit_log'))) {
    await connection.query(`
      CREATE TABLE admin_audit_log (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        actorId INT NULL,
        actorRole VARCHAR(20) NULL,
        actorEmail VARCHAR(191) NULL,
        action VARCHAR(80) NOT NULL COMMENT 'e.g. payout.retry, order.cancel, coupon.create, settings.update',
        entityType VARCHAR(60) NULL,
        entityId VARCHAR(120) NULL,
        beforeVal JSON NULL,
        afterVal JSON NULL,
        ip VARCHAR(64) NULL,
        userAgent VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_actor (actorId),
        INDEX idx_audit_entity (entityType, entityId),
        INDEX idx_audit_created (created_at),
        INDEX idx_audit_action (action)
      ) ENGINE=InnoDB`);
    console.log('✅ Created admin_audit_log table');
  } else {
    console.log('ℹ️  admin_audit_log already exists — skipping');
  }

  // ============================================================
  // 4. SESSION REVOCATION VERSION (concurrent-login invalidation)
  // ============================================================
  if (await tableExists('users')) {
    if (!(await columnExists('users', 'tokenVersion'))) {
      await connection.query(
        `ALTER TABLE users ADD COLUMN tokenVersion INT NOT NULL DEFAULT 0
         COMMENT 'bumped on password reset / credential change; JWTs must match'`
      );
      console.log('✅ Added users.tokenVersion');
    } else {
      console.log('ℹ️  users.tokenVersion already exists — skipping');
    }
  }

  console.log('✅ Ops migration complete');
} catch (err) {
  console.error('❌ Ops migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await connection.end();
}