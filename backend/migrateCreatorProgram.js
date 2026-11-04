// @ts-check
// FILE LOCATION: backend/migrateCreatorProgram.js
// DESCRIPTION: Creator/affiliate program (Phase 3, Step 6). A self-service
//   APPLICATION layer on top of the existing referral/ambassador engine: a
//   creator applies, an admin approves and sets a rate, which promotes the user
//   to the 'super' ambassador tier (users.ambassadorTier/ambassadorRate — all
//   payout/attribution/withdrawal rails already exist). Additive; idempotent.
// Run from backend/:  node migrateCreatorProgram.js
import pool from './config/db.js';

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS creator_applications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      platforms JSON NULL COMMENT 'e.g. ["instagram","tiktok"]',
      socialLinks JSON NULL COMMENT 'handles / profile URLs',
      audienceSize INT NULL COMMENT 'self-reported follower count',
      niche VARCHAR(160) NULL,
      pitch VARCHAR(2000) NULL COMMENT 'why they want to promote Bonwire',
      requestedRate DECIMAL(5,4) NULL COMMENT 'rate the creator asked for (<= platform commission)',
      approvedRate DECIMAL(5,4) NULL COMMENT 'rate the admin granted on approval',
      reviewedBy INT NULL,
      reviewNote VARCHAR(1000) NULL,
      reviewedAt DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_creator_app_user (userId),
      INDEX idx_creator_app_status (status, created_at),
      CONSTRAINT fk_creator_app_user FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);

  console.log('✅ creator program schema ready');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`❌ migrateCreatorProgram failed: ${/** @type {any} */ (err).message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
