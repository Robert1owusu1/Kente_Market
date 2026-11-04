// @ts-check
// FILE LOCATION: backend/migratePlans.js
// DESCRIPTION: Vendor PLAN + subscription system (Phase 1, Step 1 of the vendor
//   plans roadmap). Additive only: new `plans` and `vendor_subscriptions`
//   tables, a nullable `vendors.planId`, seeded DRAFT plans (price 0, inactive —
//   the admin sets each price before it goes live) and feature-gate settings
//   kept OFF so the existing vendor flow is unchanged until Phase 2 wires it.
//   Idempotent (every step guarded by information_schema); fails loudly (exit 1).
// Run from backend/:  node migratePlans.js
import pool from './config/db.js';
import { DEFAULT_PLAN_DRAFTS } from '../shared/plans.js';

/** @param {string} table @param {string} column */
const columnExists = async (table, column) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return /** @type {any[]} */ (rows).length > 0;
};
/** @param {string} table @param {string} index */
const indexExists = async (table, index) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index]
  );
  return /** @type {any[]} */ (rows).length > 0;
};
/** @param {string} table @param {string} name */
const fkExists = async (table, name) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
    [table, name]
  );
  return /** @type {any[]} */ (rows).length > 0;
};
/** @param {string} table @param {string} column @param {string} ddl */
const addColumn = async (table, column, ddl) => {
  if (await columnExists(table, column)) return;
  await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  console.log(` Added ${table}.${column}`);
};
/** @param {string} table @param {string} index @param {string} ddl */
const addIndex = async (table, index, ddl) => {
  if (await indexExists(table, index)) return;
  await pool.query(`ALTER TABLE ${table} ADD ${ddl}`);
  console.log(` Added index ${table}.${index}`);
};
/** @param {string} table @param {string} name @param {string} ddl */
const addForeignKey = async (table, name, ddl) => {
  if (await fkExists(table, name)) return;
  await pool.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${ddl}`);
  console.log(` Added FK ${table}.${name}`);
};

try {
  // --- Plan catalogue (admin-managed). The plan FEE (`price`) is set by the
  //     admin; drafts seed price 0 + isActive 0 so nothing is sellable until an
  //     admin sets a price and activates it. `commissionRate` is the per-plan
  //     platform commission applied to the vendor's sales (0..1); when a vendor
  //     subscribes it is copied onto vendors.platformFeeRate (Phase 2 logic). ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plans (
      id INT AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(50) NOT NULL COMMENT 'stable machine key: starter/pro/master',
      name VARCHAR(100) NOT NULL,
      description VARCHAR(500) NULL,
      price DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'recurring plan fee (admin-set)',
      currency CHAR(3) NOT NULL DEFAULT 'GHS',
      billingInterval ENUM('monthly','annually') NOT NULL DEFAULT 'monthly',
      commissionRate DECIMAL(5,4) NOT NULL DEFAULT 0.1000 COMMENT 'platform commission fraction for this plan (0..1)',
      paystackPlanCode VARCHAR(100) NULL COMMENT 'Paystack Plan code for recurring billing',
      features JSON NULL COMMENT 'array of enabled feature keys (shared/plans.js PLAN_FEATURES)',
      productLimit INT NULL COMMENT 'max active products; NULL = unlimited',
      isActive TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'available for new subscriptions',
      isPublic TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'shown on the plan-selection page',
      sortOrder INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_plans_slug (slug),
      INDEX idx_plans_active (isActive, sortOrder)
    ) ENGINE=InnoDB`);

  // --- Vendor subscriptions. vendorId references users.id to match the whole
  //     marketplace convention (escrow_allocations / wallet_transactions /
  //     vendor_wallets all key vendorId on users.id). Money terms are SNAPSHOT
  //     at subscribe time so later plan edits never rewrite an active contract. ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendor_subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      vendorId INT NOT NULL COMMENT 'users.id of the vendor',
      planId INT NOT NULL,
      status ENUM('pending','active','past_due','cancelled','expired') NOT NULL DEFAULT 'pending',
      priceAtSubscribe DECIMAL(12,2) NOT NULL COMMENT 'plan fee frozen at subscribe',
      commissionRateAtSubscribe DECIMAL(5,4) NOT NULL COMMENT 'plan commission frozen at subscribe',
      currency CHAR(3) NOT NULL DEFAULT 'GHS',
      billingInterval ENUM('monthly','annually') NOT NULL DEFAULT 'monthly',
      paystackCustomerCode VARCHAR(100) NULL,
      paystackSubscriptionCode VARCHAR(100) NULL,
      paystackEmailToken VARCHAR(100) NULL COMMENT 'token needed to manage/cancel the Paystack subscription',
      paystackAuthorizationCode VARCHAR(100) NULL,
      currentPeriodStart DATETIME NULL,
      currentPeriodEnd DATETIME NULL,
      nextPaymentAt DATETIME NULL,
      cancelAtPeriodEnd TINYINT(1) NOT NULL DEFAULT 0,
      cancelledAt DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_vendor_sub_paystack (paystackSubscriptionCode),
      INDEX idx_vendor_sub_vendor (vendorId, status),
      INDEX idx_vendor_sub_plan (planId),
      INDEX idx_vendor_sub_status (status, nextPaymentAt),
      CONSTRAINT fk_vendor_sub_user FOREIGN KEY (vendorId) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_vendor_sub_plan FOREIGN KEY (planId) REFERENCES plans (id)
    ) ENGINE=InnoDB`);

  // --- Correlation reference for the first subscription charge (our unique
  //     transaction reference). charge.success carries it back so we can match
  //     the webhook to the pending subscription row. ---
  await addColumn('vendor_subscriptions', 'startReference', 'VARCHAR(80) NULL COMMENT "our unique init reference for the first charge"');
  await addIndex('vendor_subscriptions', 'idx_vendor_sub_startref', 'INDEX idx_vendor_sub_startref (startReference)');
  await addColumn('vendor_subscriptions', 'lastPaymentAt', 'DATETIME NULL COMMENT "last successful charge"');

  // --- Denormalised pointer to the vendor's current plan (fast lookups / joins).
  //     ON DELETE SET NULL so removing a plan never deletes vendors. ---
  await addColumn('vendors', 'planId', 'INT NULL');
  await addIndex('vendors', 'idx_vendors_plan', 'INDEX idx_vendors_plan (planId)');
  await addForeignKey(
    'vendors', 'fk_vendors_plan',
    'FOREIGN KEY (planId) REFERENCES plans (id) ON DELETE SET NULL'
  );

  // --- Seed draft plans (idempotent on slug). Admin sets price + activates. ---
  for (const p of DEFAULT_PLAN_DRAFTS) {
    await pool.query(
      `INSERT IGNORE INTO plans (slug, name, description, price, commissionRate, features, productLimit, isActive, isPublic, sortOrder)
       VALUES (?, ?, ?, 0, ?, CAST(? AS JSON), ?, 0, 1, ?)`,
      [p.slug, p.name, p.description, p.commissionRate, JSON.stringify(p.features), p.productLimit, p.sortOrder]
    );
  }

  // --- Feature flags, OFF by default so the existing vendor flow is unchanged
  //     until Phase 2 wires the pay-for-plan gate + Bonwire verification. ---
  for (const [key, value, type] of [
    // Enforce "approved vendor must pay for a plan before the dashboard unlocks".
    ['vendorPlans.required', 'false', 'boolean'],
    // Hard-gate: a vendor cannot be approved until Bonwire origin is verified.
    ['vendorPlans.bonwireVerificationRequired', 'true', 'boolean'],
  ]) {
    await pool.query(
      `INSERT IGNORE INTO settings (settingKey, settingValue, settingType) VALUES (?, ?, ?)`,
      [key, value, type]
    );
  }

  console.log('✅ vendor plans schema ready');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`❌ migratePlans failed: ${/** @type {any} */ (err).message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
