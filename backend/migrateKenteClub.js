// @ts-check
// FILE LOCATION: backend/migrateKenteClub.js
// DESCRIPTION: Kente Club — customer membership (Phase 3, Step 10). Recurring
//   tiers (Paystack subscriptions, like vendor plans). Each tier grants an
//   admin-set members-only discount applied at checkout (platform-funded, capped
//   at commission). Membership fees are 100% platform revenue (source
//   'membership'). Additive; idempotent; drafts seeded price 0 + inactive.
// Run from backend/:  node migrateKenteClub.js
import pool from './config/db.js';

const DRAFTS = [
  { slug: 'silver', name: 'Kente Club Silver', description: 'Members-only discount on every order, plus early access to new drops.', discountPercent: 5, sortOrder: 1 },
  { slug: 'gold', name: 'Kente Club Gold', description: 'A bigger members discount and priority access to limited pieces.', discountPercent: 8, sortOrder: 2 },
  { slug: 'platinum', name: 'Kente Club Platinum', description: 'Our best members discount and first dibs on everything.', discountPercent: 12, sortOrder: 3 },
];

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS membership_plans (
      id INT AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(50) NOT NULL,
      name VARCHAR(100) NOT NULL,
      description VARCHAR(500) NULL,
      price DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'recurring fee (admin-set)',
      currency CHAR(3) NOT NULL DEFAULT 'GHS',
      billingInterval ENUM('monthly','annually') NOT NULL DEFAULT 'monthly',
      discountPercent DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT 'members-only checkout discount % (admin-set)',
      paystackPlanCode VARCHAR(100) NULL,
      isActive TINYINT(1) NOT NULL DEFAULT 0,
      isPublic TINYINT(1) NOT NULL DEFAULT 1,
      sortOrder INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_membership_plan_slug (slug),
      INDEX idx_membership_plan_active (isActive, sortOrder)
    ) ENGINE=InnoDB`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS memberships (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      planId INT NOT NULL,
      status ENUM('pending','active','past_due','cancelled','expired') NOT NULL DEFAULT 'pending',
      priceAtSubscribe DECIMAL(12,2) NOT NULL,
      discountPercentAtSubscribe DECIMAL(5,2) NOT NULL,
      currency CHAR(3) NOT NULL DEFAULT 'GHS',
      billingInterval ENUM('monthly','annually') NOT NULL DEFAULT 'monthly',
      startReference VARCHAR(80) NULL,
      lastPaymentAt DATETIME NULL,
      paystackCustomerCode VARCHAR(100) NULL,
      paystackSubscriptionCode VARCHAR(100) NULL,
      paystackEmailToken VARCHAR(100) NULL,
      currentPeriodStart DATETIME NULL,
      currentPeriodEnd DATETIME NULL,
      nextPaymentAt DATETIME NULL,
      cancelAtPeriodEnd TINYINT(1) NOT NULL DEFAULT 0,
      cancelledAt DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_membership_paystack (paystackSubscriptionCode),
      INDEX idx_membership_user (userId, status),
      INDEX idx_membership_startref (startReference),
      CONSTRAINT fk_membership_user FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_membership_plan FOREIGN KEY (planId) REFERENCES membership_plans (id)
    ) ENGINE=InnoDB`);

  // Add 'membership' to the platform_revenue source enum if missing.
  const [[col]] = /** @type {any} */ (await pool.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_revenue' AND COLUMN_NAME = 'source'`
  ));
  if (col && !String(col.t).includes("'membership'")) {
    await pool.query(
      `ALTER TABLE platform_revenue MODIFY COLUMN source ENUM('platform_product','commission','refund','featured','membership') DEFAULT 'platform_product'`
    );
    console.log(" Added 'membership' to platform_revenue.source");
  }

  for (const d of DRAFTS) {
    await pool.query(
      `INSERT IGNORE INTO membership_plans (slug, name, description, price, discountPercent, isActive, isPublic, sortOrder)
       VALUES (?, ?, ?, 0, ?, 0, 1, ?)`,
      [d.slug, d.name, d.description, d.discountPercent, d.sortOrder]
    );
  }

  console.log('✅ Kente Club schema ready');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`❌ migrateKenteClub failed: ${/** @type {any} */ (err).message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
