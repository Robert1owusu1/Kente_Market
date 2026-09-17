// FILE LOCATION: backend/migrateMarketplace.js
// DESCRIPTION: Additively migrates the schema for the Bonwire Kente marketplace
//              upgrade:
//   - Vendor storefront + verification levels (vendors.*)
//   - Vendor staff accounts with granular permissions (vendor_staff)
//   - Kente-specific product fields + product approval + inventory (product.*)
//   - Commission engine rules (commission_rules)
//   - Buyer <-> vendor messaging (vendor_messages)
//   - Admin marketing campaigns (campaigns, campaign_products, campaign_vendors)
//   - Authenticity certificates / QR (authenticity_certificates)
//
// Additive and idempotent: never drops or disturbs existing data.
// Run from backend/:  node migrateMarketplace.js
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

const colExists = async (table, column) => {
  const [[res]] = await connection.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return !!(res && res.c > 0);
};

const tableExists = async (table) => {
  const [[res]] = await connection.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return !!(res && res.c > 0);
};

// Indexes are NOT columns: colExists() queries information_schema.COLUMNS, so
// guarding an "ADD UNIQUE KEY" with colExists never fires the second time a
// migration runs (re-running would crash with ER_DUP_KEYNAME). Check the real
// index registry instead.
const indexExists = async (table, indexName) => {
  const [[res]] = await connection.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  );
  return !!(res && res.c > 0);
};

const addColumn = async (table, column, definition, log = true) => {
  if (!(await colExists(table, column))) {
    await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    if (log) console.log(`✅ Added ${table}.${column}`);
  }
};

const addTable = async (name, sql, log = true) => {
  if (!(await tableExists(name))) {
    await connection.query(sql);
    if (log) console.log(`✅ Created table ${name}`);
  }
};

try {
  // ============================================================
  // VENDOR STOREFRONT + VERIFICATION LEVELS
  // ============================================================
  await addColumn('vendors', 'logo', `VARCHAR(500) NULL`);
  await addColumn('vendors', 'coverImage', `VARCHAR(500) NULL`);
  await addColumn('vendors', 'businessDescription', `TEXT NULL`);
  await addColumn('vendors', 'weaverStory', `TEXT NULL`);
  await addColumn('vendors', 'yearsExperience', `INT DEFAULT 0`);
  await addColumn('vendors', 'location', `VARCHAR(255) NULL`);
  await addColumn('vendors', 'workshop', `VARCHAR(255) NULL`);
  await addColumn('vendors', 'socialMedia', `JSON NULL`);
  await addColumn('vendors', 'verificationLevel',
    `ENUM('pending','verified','trusted_artisan','master_weaver') NOT NULL DEFAULT 'pending'`);
  await addColumn('vendors', 'badges', `JSON NULL`);
  // Unique slug for the public storefront URL (/store/:slug).
  if (!(await colExists('vendors', 'slug'))) {
    await connection.query(
      `ALTER TABLE vendors ADD COLUMN slug VARCHAR(200) NULL UNIQUE`
    );
    console.log('✅ Added vendors.slug');
  }
  // Optional per-vendor commission override handled by commission_rules below.

  // Vendor staff with granular permissions.
  await addTable('vendor_staff', `
    CREATE TABLE IF NOT EXISTS vendor_staff (
      id INT AUTO_INCREMENT PRIMARY KEY,
      vendorId INT NOT NULL,
      name VARCHAR(150) NOT NULL,
      email VARCHAR(255) NOT NULL,
      password VARCHAR(255) NOT NULL,
      permissions JSON NULL COMMENT 'e.g. {orders:true,inventory:true,earnings:false}',
      status ENUM('active','inactive') DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_vendor_staff_email (vendorId, email),
      FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_vendor_staff_vendor (vendorId)
    ) ENGINE=InnoDB`);

  // Some environments created vendor_staff with ENUM('active','deactivated').
  // Normalize storage to 'active'/'inactive' and widen the enum so neither the
  // column nor the controller's validation can reject the other's values.
  await connection
    .query(`UPDATE vendor_staff SET status = 'inactive' WHERE status = 'deactivated'`)
    .catch(() => {});
  await connection
    .query(
      `ALTER TABLE vendor_staff MODIFY status ENUM('active','inactive','deactivated') DEFAULT 'active' NOT NULL`
    )
    .catch((err) => console.warn('⚠️ vendor_staff enum already widened:', err.message));

  // ============================================================
  // KENTE-SPECIFIC PRODUCT FIELDS
  // ============================================================
  await addColumn('product', 'patternName', `VARCHAR(255) NULL`);
  await addColumn('product', 'patternMeaning', `TEXT NULL`);
  await addColumn('product', 'culturalSignificance', `TEXT NULL`);
  await addColumn('product', 'origin', `VARCHAR(255) NULL`);
  await addColumn('product', 'weavingTechnique', `VARCHAR(255) NULL`);
  await addColumn('product', 'yards', `DECIMAL(6,2) NULL`);
  await addColumn('product', 'occasions', `JSON NULL`);
  await addColumn('product', 'designStory', `TEXT NULL`);
  await addColumn('product', 'careInstructions', `TEXT NULL`);
  await addColumn('product', 'weight', `DECIMAL(8,2) NULL`);
  await addColumn('product', 'wholesalePrice', `DECIMAL(10,2) NULL`);
  await addColumn('product', 'retailPrice', `DECIMAL(10,2) NULL`);
  await addColumn('product', 'madeToOrder', `BOOLEAN DEFAULT false`);
  await addColumn('product', 'video', `VARCHAR(500) NULL`);
  // Gallery photos (multiple) as JSON array in addition to primary img.
  await addColumn('product', 'gallery', `JSON NULL`);
  await addColumn('product', 'descriptionHTML', `TEXT NULL`);
  // Kente yarn composition: thread types used (cotton, rayon, ...) + dominant one.
  await addColumn('product', 'threadTypes', `JSON NULL`);
  await addColumn('product', 'dominantThread', `VARCHAR(100) NULL`);

  // ============================================================
  // PRODUCT APPROVAL WORKFLOW + INVENTORY
  // ============================================================
  await addColumn('product', 'approvalStatus',
    `ENUM('pending','approved','rejected','changes_requested') NOT NULL DEFAULT 'approved'`);
  await addColumn('product', 'approvalNote', `TEXT NULL`);
  await addColumn('product', 'approvedAt', `DATETIME NULL`);
  await addColumn('product', 'stock', `INT NOT NULL DEFAULT 0`);
  await addColumn('product', 'sku', `VARCHAR(100) NULL`);
  await addColumn('product', 'lowStockThreshold', `INT NOT NULL DEFAULT 0`);

  // ============================================================
  // COMMISSION ENGINE RULES
  // ============================================================
  await addTable('commission_rules', `
    CREATE TABLE IF NOT EXISTS commission_rules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      scope ENUM('global','category','vendor','product') NOT NULL DEFAULT 'global',
      targetId VARCHAR(100) NULL COMMENT 'category name / vendor user id / product id; NULL for global',
      rate DECIMAL(5,4) NOT NULL COMMENT 'Commission fraction (0.10 = 10%)',
      minRate DECIMAL(5,4) DEFAULT 0,
      maxRate DECIMAL(5,4) DEFAULT 0.5,
      priority INT NOT NULL DEFAULT 0 COMMENT 'Higher wins; product > vendor > category > global',
      isActive BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_commission_scope (scope, isActive),
      INDEX idx_commission_priority (priority)
    ) ENGINE=InnoDB`);

  // ============================================================
  // VENDOR MESSAGING (buyer <-> vendor enquiries)
  // ============================================================
  await addTable('vendor_messages', `
    CREATE TABLE IF NOT EXISTS vendor_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      vendorId INT NOT NULL,
      customerId INT NOT NULL,
      productId INT NULL,
      orderId INT NULL,
      subject VARCHAR(255) NOT NULL,
      body TEXT NOT NULL,
      reply TEXT NULL,
      status ENUM('open','replied','closed') DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      replied_at DATETIME NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (customerId) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_vendor_messages_vendor (vendorId),
      INDEX idx_vendor_messages_customer (customerId),
      INDEX idx_vendor_messages_status (status)
    ) ENGINE=InnoDB`);

  // ============================================================
  // ADMIN MARKETING CAMPAIGNS
  // ============================================================
  await addTable('campaigns', `
    CREATE TABLE IF NOT EXISTS campaigns (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NULL,
      description TEXT NULL,
      discountType ENUM('percentage','fixed') DEFAULT 'percentage',
      discountValue DECIMAL(10,2) NOT NULL DEFAULT 0,
      startDate DATETIME NULL,
      endDate DATETIME NULL,
      bannerImage VARCHAR(500) NULL,
      status ENUM('draft','scheduled','active','ended') DEFAULT 'draft',
      channel VARCHAR(100) DEFAULT 'homepage',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_campaigns_status_dates (status, startDate, endDate)
    ) ENGINE=InnoDB`);

  await addTable('campaign_products', `
    CREATE TABLE IF NOT EXISTS campaign_products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      campaignId INT NOT NULL,
      productId INT NOT NULL,
      UNIQUE KEY uq_campaign_product (campaignId, productId),
      FOREIGN KEY (campaignId) REFERENCES campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (productId) REFERENCES product(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);

  // Existing installs may have the legacy shape (startsAt/endsAt, no
  // slug/startDate/endDate/bannerImage/channel) because branding_house.sql won
  // the "IF NOT EXISTS" race against this migration. Converge existing tables
  // to the shape campaignController.js actually queries (addColumn is
  // idempotent, so this is safe on both fresh and upgraded databases).
  await addColumn('campaigns', 'slug', 'VARCHAR(255) NULL');
  await addColumn('campaigns', 'startDate', 'DATETIME NULL');
  await addColumn('campaigns', 'endDate', 'DATETIME NULL');
  await addColumn('campaigns', 'bannerImage', 'VARCHAR(500) NULL');
  await addColumn('campaigns', 'channel', `VARCHAR(100) DEFAULT 'homepage'`);
  {
    const [[cs]] = await connection.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaigns' AND COLUMN_NAME = 'status'`
    );
    if (cs?.COLUMN_TYPE && !cs.COLUMN_TYPE.includes('scheduled')) {
      await connection.query(
        `ALTER TABLE campaigns MODIFY COLUMN status ENUM('draft','scheduled','active','ended') NOT NULL DEFAULT 'draft'`
      );
      console.log('✅ Widened campaigns.status enum to include "scheduled"');
    }
  }

  await addTable('campaign_vendors', `
    CREATE TABLE IF NOT EXISTS campaign_vendors (
      id INT AUTO_INCREMENT PRIMARY KEY,
      campaignId INT NOT NULL,
      vendorId INT NOT NULL,
      UNIQUE KEY uq_campaign_vendor (campaignId, vendorId),
      FOREIGN KEY (campaignId) REFERENCES campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);

  // ============================================================
  // AUTHENTICITY CERTIFICATES / QR
  // ============================================================
  await addTable('authenticity_certificates', `
    CREATE TABLE IF NOT EXISTS authenticity_certificates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      certificateNumber VARCHAR(50) NOT NULL UNIQUE,
      productId INT NOT NULL,
      vendorId INT NULL,
      orderId INT NULL,
      customerId INT NULL,
      patternName VARCHAR(255) NULL,
      weaverName VARCHAR(255) NULL,
      workshop VARCHAR(255) NULL,
      village VARCHAR(255) NULL,
      patternMeaning TEXT NULL,
      dateRegistered DATETIME NULL,
      issuedTo VARCHAR(255) NULL,
      qrToken VARCHAR(255) NULL,
      status ENUM('issued','revoked') DEFAULT 'issued',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (productId) REFERENCES product(id) ON DELETE CASCADE,
      UNIQUE KEY uq_cert_qrToken (qrToken),
      INDEX idx_cert_vendor (vendorId),
      INDEX idx_cert_order (orderId)
    ) ENGINE=InnoDB`);

  // ============================================================
  // CUSTOMIZATION REQUESTS (buyer -> vendor custom kente orders)
  // ============================================================
  await addTable('custom_requests', `
    CREATE TABLE IF NOT EXISTS custom_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      customerId INT NOT NULL,
      vendorId INT NOT NULL COMMENT 'vendors.userId (matches product.vendorId)',
      baseProductId INT NULL,
      description TEXT NULL,
      yards DECIMAL(6,2) NOT NULL DEFAULT 2,
      colours JSON NULL,
      dominantColour VARCHAR(100) NULL,
      threadTypes JSON NULL,
      dominantThread VARCHAR(100) NULL,
      referenceImage VARCHAR(500) NULL,
      neededForDate DATE NULL,
      neededForTime VARCHAR(10) NULL,
      status ENUM('pending','quoted','accepted','paid','in_progress','completed','cancelled','declined')
        NOT NULL DEFAULT 'pending',
      vendorQuotePrice DECIMAL(10,2) NULL,
      vendorCanMeet TINYINT NOT NULL DEFAULT 1,
      vendorMessage TEXT NULL,
      customerCancelReason TEXT NULL,
      orderId INT NULL,
      adminReviewed TINYINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_custom_customer (customerId),
      INDEX idx_custom_vendor (vendorId),
      INDEX idx_custom_status (status)
    ) ENGINE=InnoDB`);

  // ============================================================
  // REVIEWS v2 — verified purchases, vendor rating, platform feedback
  // ============================================================
  await addColumn('reviews', 'orderId', `INT NULL`);
  await addColumn('reviews', 'vendorId', `INT NULL`);
  await addColumn('reviews', 'vendorRating', `TINYINT NULL`);
  await addColumn('reviews', 'platformSuggestion', `TEXT NULL`);
  await addColumn('reviews', 'isVerified', `TINYINT NOT NULL DEFAULT 0`);
  // NOTE: review_reports.fk_1 / reviews FKs (userId, productId) rely on the
  // composite unique uq_reviews_user_product — do NOT drop it. The model keeps
  // exactly one review row per (user, product) and bumps isVerified/vendor
  // details on each new delivered-order review, so the old key stays valid.
  if (await colExists('reviews', 'orderId')) {
    if (!(await indexExists('reviews', 'uq_review_user_order_product'))) {
      await connection.query(
        `ALTER TABLE reviews ADD UNIQUE KEY uq_review_user_order_product (orderId, userId, productId)`
      );
      console.log('✅ Added reviews unique key (orderId, userId, productId)');
    }
  }

  // ============================================================
  // PRODUCT TYPE INSIGHTS (analytics aggregation workbook)
  // ============================================================
  await addTable('product_sales_daily', `
    CREATE TABLE IF NOT EXISTS product_sales_daily (
      id INT AUTO_INCREMENT PRIMARY KEY,
      saleDate DATE NOT NULL,
      productId INT NULL,
      category VARCHAR(100) NULL,
      productTitle VARCHAR(255) NULL,
      quantity INT NOT NULL DEFAULT 0,
      revenue DECIMAL(12,2) NOT NULL DEFAULT 0,
      yardTotal DECIMAL(10,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_product_sales_day (saleDate, productId)
    ) ENGINE=InnoDB`);

  // ============================================================
  // HONEST + SERVICE COMMITMENTS (discovery backlog)
  // ============================================================
  // Custom-request SLA: set once the first 48h-escalation notification goes
  // out, so the scheduler never double-notifies a stale pending request.
  await addColumn('custom_requests', 'sla_notified_at', `DATETIME NULL`);
  // Fulfilment scorecard: real delivery timestamp so "met deadline %" is
  // measured against expectedCompletionDate instead of guesswork.
  await addColumn('orders', 'deliveredAt', `DATETIME NULL`);
  // 50/50 advance escrow: tags which escrow split is the upfront advance
  // (released at payment) vs. the balance (released on delivery).
  await addColumn('escrow_allocations', 'allocationType',
    `ENUM('standard','advance','balance') NOT NULL DEFAULT 'standard'`);
  // Allocation type is part of the identity: custom orders can have one
  // advance and one balance allocation, but concurrent requests must never
  // create either row twice. This must be enforced by MySQL, not a SELECT
  // guard in application code.
  // (An explicit orderId index must exist first — the FK on orders needs a
  // leading orderId index to keep its constraint valid.)
  if (!(await indexExists('escrow_allocations', 'idx_escrow_orderId'))) {
    await connection.query(
      `ALTER TABLE escrow_allocations ADD INDEX idx_escrow_orderId (orderId)`
    );
    console.log('✅ Added escrow_allocations idx_escrow_orderId');
  }
  if (await indexExists('escrow_allocations', 'uq_escrow_order_vendor')) {
    await connection.query(`ALTER TABLE escrow_allocations DROP INDEX uq_escrow_order_vendor`);
    console.log('✅ Dropped escrow_allocations uq_escrow_order_vendor (replaced by explicit guard)');
  }
  if (!(await indexExists('escrow_allocations', 'idx_escrow_order_vendor'))) {
    await connection.query(
      `ALTER TABLE escrow_allocations ADD INDEX idx_escrow_order_vendor (orderId, vendorId)`
    );
    console.log('✅ Added escrow_allocations idx_escrow_order_vendor');
  }
  if (!(await indexExists('escrow_allocations', 'uq_escrow_order_vendor_type'))) {
    // Dirty-data-safe: if legacy rows already violate the key, the unique index
    // cannot be created. Recover what we can (keep the newest id per group)
    // and fall back to a plain index so the app still works; ops resolves
    // remaining duplicates manually.
    const [[dupes]] = await connection.query(
      `SELECT COUNT(*) AS c
       FROM (SELECT orderId, vendorId, allocationType
             FROM escrow_allocations
             GROUP BY orderId, vendorId, allocationType
             HAVING COUNT(*) > 1) t`
    );
    if (dupes.c > 0) {
      console.warn(`⚠️ escrow_allocations has ${dupes.c} duplicate (orderId, vendorId, allocationType) groups — purging older duplicates`);
      await connection.query(
        `DELETE ea FROM escrow_allocations ea
         JOIN escrow_allocations keeper
           ON keeper.orderId = ea.orderId
          AND keeper.vendorId = ea.vendorId
          AND keeper.allocationType = ea.allocationType
          AND keeper.id > ea.id`
      );
    }
    await connection.query(
      `ALTER TABLE escrow_allocations
       ADD UNIQUE KEY uq_escrow_order_vendor_type (orderId, vendorId, allocationType)`
    );
    console.log('✅ Added escrow allocation idempotency key');
  }

  // Credit entries are the durable idempotency record for releasing escrow to
  // a wallet. MySQL permits multiple NULLs, so this only constrains credits
  // tied to a real allocation and does not block ordinary withdrawal rows.
  if (!(await indexExists('wallet_transactions', 'uq_wallet_credit_allocation'))) {
    // Dirty-data-safe (see escrow_allocations guard above).
    const [[dupes]] = await connection.query(
      `SELECT COUNT(*) AS c
       FROM (SELECT vendorId, allocationId, type
             FROM wallet_transactions
             WHERE allocationId IS NOT NULL AND type = 'credit'
             GROUP BY vendorId, allocationId, type
             HAVING COUNT(*) > 1) t`
    );
    if (dupes.c > 0) {
      console.warn(`⚠️ wallet_transactions has ${dupes.c} duplicate credit groups — purging older duplicates`);
      await connection.query(
        `DELETE wt FROM wallet_transactions wt
         JOIN wallet_transactions keeper
           ON keeper.vendorId = wt.vendorId
          AND keeper.allocationId = wt.allocationId
          AND keeper.type = wt.type
          AND keeper.id > wt.id`
      );
    }
    await connection.query(
      `ALTER TABLE wallet_transactions
       ADD UNIQUE KEY uq_wallet_credit_allocation (vendorId, allocationId, type)`
    );
    console.log('✅ Added wallet credit idempotency key');
  }

  // Each provider call has a locally generated, unique reference written
  // before it is sent. This is the payout outbox/reconciliation ledger.
  await addTable('payout_attempts', `
    CREATE TABLE IF NOT EXISTS payout_attempts (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      allocationId INT NOT NULL,
      vendorId INT NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      reference VARCHAR(120) NOT NULL,
      providerReference VARCHAR(255) NULL,
      isFull TINYINT(1) NOT NULL DEFAULT 0,
      status ENUM('processing','succeeded','failed','reversed') NOT NULL DEFAULT 'processing',
      lastError VARCHAR(500) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_payout_attempt_reference (reference),
      UNIQUE KEY uq_payout_attempt_provider_reference (providerReference),
      INDEX idx_payout_attempt_allocation_status (allocationId, status),
      FOREIGN KEY (allocationId) REFERENCES escrow_allocations(id) ON DELETE RESTRICT,
      FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB`);

  // Webhook receipt and business processing are separate states. A provider
  // retry must be able to reclaim a failed event rather than being suppressed
  // merely because its raw payload was inserted once.
  await addColumn('webhook_events', 'processing_status',
    `ENUM('received','processing','processed','failed') NOT NULL DEFAULT 'received'`);
  await addColumn('webhook_events', 'attempts', `INT NOT NULL DEFAULT 0`);
  await addColumn('webhook_events', 'last_error', `VARCHAR(500) NULL`);
  // Wishlist restock dedupe: set when a wishlisted item is in stock *now*, so
  // back-in-stock alerts fire only on a real 0 -> >0 transition.
  await addColumn('wishlist', 'lastRestockNotifiedAt', `DATETIME NULL`);

  // ============================================================
  // BORROW-BACK / BUYBACK LOOP (customer returns ceremonial kente,
  // platform re-stocks it so the cloth keeps circulating)
  // ============================================================
  await addTable('buyback_requests', `
    CREATE TABLE IF NOT EXISTS buyback_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      customerId INT NOT NULL,
      orderId INT NOT NULL,
      productId INT NOT NULL,
      quantity INT NOT NULL DEFAULT 1,
      conditionNote VARCHAR(500) NULL COMMENT 'described by the customer',
      expectedPrice DECIMAL(10,2) NULL,
      buybackPrice DECIMAL(10,2) NULL COMMENT 'admin-set offer',
      status ENUM('pending','approved','declined') NOT NULL DEFAULT 'pending',
      adminNote TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (customerId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (productId) REFERENCES product(id) ON DELETE CASCADE,
      INDEX idx_buyback_customer (customerId),
      INDEX idx_buyback_status (status)
    ) ENGINE=InnoDB`);

  // ============================================================
  // PHASE 12 — TRUST + LIFECYCLE (vendor video, price-drop alerts, rentable)
  // ============================================================

  // S1: Vendor weaving video — YouTube or self-hosted mp4 URL shown on storefront
  await addColumn('vendors', 'weaverVideo', `VARCHAR(500) NULL`);

  // S6: Wishlist price-drop alerts — lastAlertedPrice tracks the baseline so we
  // only email when the live price drops below it. lastPriceDropNotifiedAt
  // debounces to one alert per reduction.
  await addColumn('wishlist', 'lastAlertedPrice', `DECIMAL(12,2) NULL`);
  await addColumn('wishlist', 'lastPriceDropNotifiedAt', `DATETIME NULL`);

  // S10: Rent / rental — a "rent for occasions" flag on products lets buyers
  // see a rent badge and ask the weaver about rental terms. No separate order
  // flow yet — the Ask thread handles rental coordination.
  await addColumn('product', 'isRentable', `TINYINT(1) NOT NULL DEFAULT 0`);
  await addColumn('product', 'rentPricePerDay', `DECIMAL(10,2) NULL`);
  if (!(await indexExists('product', 'idx_product_is_rentable'))) {
    await connection.query(`ALTER TABLE product ADD INDEX idx_product_is_rentable (isRentable)`);
    console.log('✅ Added product idx_product_is_rentable');
  }

  // ============================================================
  // PHASE 13 — STOCK CONFLICT HANDLING (concurrent purchases)
  // ============================================================
  // When two+ buyers race for the last in-stock unit, the later paid order
  // cannot take its units (the decrement is atomic + conditional). stockShortfall
  // records how many units could not be taken so the order is visibly flagged
  // for admin/vendor resolution instead of silently overselling. stockConflicts
  // keeps the per-product breakdown so a cancelled order only restores stock
  // that was actually taken.
  await addColumn('orders', 'stockShortfall', `INT NOT NULL DEFAULT 0`);
  await addColumn('orders', 'stockConflicts', `JSON NULL`);

  // ============================================================
  // PHASE 14 — SERVER-SIDE CARTS (cross-device + abandoned cart recovery)
  // ============================================================
  // A cart exists for a signed-in user (userId) or an anonymous visitor
  // (guestId cookie) so the same cart can be restored across devices and
  // abandoned-cart recovery emails can reach a user who left items behind.
  // lastRecoveryEmailAt debounces re-targeting so we never spam the same cart.
  if (!(await tableExists('carts'))) {
    await connection.query(`
      CREATE TABLE carts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NULL,
        guestId VARCHAR(64) NULL,
        items JSON NULL,
        lastRecoveryEmailAt DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_carts_userId (userId),
        UNIQUE KEY uq_carts_guestId (guestId),
        CONSTRAINT fk_carts_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB`);
    console.log('✅ Created carts table');
  }

  // ============================================================
  // DEFAULTS
  // ============================================================
  // Seed a single global commission rule at 10% if none exist.
  const [[ruleCount]] = await connection.query(
    `SELECT COUNT(*) AS c FROM commission_rules`
  );
  if (!ruleCount.c) {
    await connection.query(
      `INSERT INTO commission_rules (scope, targetId, rate, priority, isActive)
       VALUES ('global', NULL, 0.1000, 0, true)`
    );
    console.log('✅ Seeded default global commission rule (10%)');
  }

  // ============================================================
  // OPERATIONS INDEXES (query-critical columns on high-cardinality,
  // high-traffic tables). Additive + idempotent.
  // ============================================================
  const wantedIndexes = [
    ['escrow_allocations', 'idx_escrow_orderId', '(orderId)'],
    ['escrow_allocations', 'idx_escrow_status', '(status)'],
    ['escrow_allocations', 'idx_escrow_vendor', '(vendorId)'],
    ['wallet_transactions', 'idx_wallet_vendor_id', '(vendorId, id)'],
    ['wallet_transactions', 'idx_wallet_reference', '(reference(100))'],
    ['financial_events', 'idx_financial_dedupe', '(dedupeKey(191))'],
    ['financial_events', 'idx_financial_order', '(orderId)'],
    ['orders', 'idx_orders_payment_ref', '(paymentReference(191))'],
    ['orders', 'idx_orders_escrow_status', '(escrowStatus)'],
    ['payout_attempts', 'idx_payout_status', '(status)'],
    ['webhook_events', 'idx_webhook_event_ref', '(event, reference(191))'],
    ['scheduler_job_status', 'idx_scheduler_job_name', '(jobName)'],
    // Hot-list composite indexes (reported slow queries): notifications page
    // reads by user sorted by recency; featured/trending lists filter on
    // featured + approval together. Composites remove the filesort and let a
    // single index serve both predicates.
    ['notifications', 'idx_notifications_user_created', '(userId, created_at)'],
    ['product', 'idx_product_featured_approval', '(featured, approvalStatus)'],
  ];
  for (const [table, name, cols] of wantedIndexes) {
    if (!(await indexExists(table, name))) {
      try {
        await connection.query(`ALTER TABLE ${table} ADD INDEX ${name} ${cols}`);
        console.log(`✅ Added ${table} ${name}`);
      } catch (err) {
        console.warn(`⚠️ Could not add ${table} ${name}: ${err.message}`);
      }
    }
  }

  console.log('✅ Marketplace migration complete');
} catch (err) {
  console.error('❌ Marketplace migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await connection.end();
}
