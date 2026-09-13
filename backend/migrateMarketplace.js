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
    if (!(await colExists('reviews', 'uq_review_user_order_product'))) {
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

  console.log('✅ Marketplace migration complete');
} catch (err) {
  console.error('❌ Marketplace migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await connection.end();
}
