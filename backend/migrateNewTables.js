// FILE LOCATION: backend/migrateNewTables.js
// DESCRIPTION: Additively creates/migrates the schema for optional features
//              (contacts, subscribers, reviews, webhook_events, ai_tryon_usage,
//              promotions) plus idempotent column additions (product.description,
//              users.failed_login_attempts, users.locked_until) without dropping
//              or disturbing existing data.
// Run from backend/:  node migrateNewTables.js
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const SQL = `
CREATE TABLE IF NOT EXISTS contacts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  subject VARCHAR(255),
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_contacts_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS subscribers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  subscribed BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_subscribers_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  productId INT NOT NULL,
  name VARCHAR(120) DEFAULT 'Anonymous',
  rating TINYINT NOT NULL DEFAULT 5,
  comment TEXT,
  status ENUM('pending', 'approved', 'hidden') DEFAULT 'approved',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (productId) REFERENCES product(id) ON DELETE CASCADE,
  UNIQUE KEY uq_reviews_user_product (userId, productId),
  INDEX idx_reviews_product (productId)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS webhook_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event VARCHAR(100) NOT NULL,
  reference VARCHAR(255) NOT NULL,
  payload JSON,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_webhook_event_ref (event, reference)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ai_tryon_usage (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  usage_date DATE NOT NULL,
  count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tryon_user_date (userId, usage_date),
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS promotions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  image VARCHAR(500),
  type ENUM('banner', 'popup', 'event') DEFAULT 'banner',
  priority INT NOT NULL DEFAULT 0,
  link VARCHAR(500),
  linkText VARCHAR(255),
  bgColor VARCHAR(20) DEFAULT '#f59e0b',
  textColor VARCHAR(20) DEFAULT '#ffffff',
  startDate DATETIME NULL,
  endDate DATETIME NULL,
  isActive BOOLEAN DEFAULT true,
  showAsPopup BOOLEAN DEFAULT false,
  popupDismissedExpiryHours INT NOT NULL DEFAULT 24,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_promotions_type (type),
  INDEX idx_promotions_active_dates (isActive, type)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS coupons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  discountType ENUM('percentage','fixed') NOT NULL,
  discountValue DECIMAL(10,2) NOT NULL,
  minPurchase DECIMAL(10,2) DEFAULT 0,
  maxUses INT NULL,
  usesUsed INT DEFAULT 0,
  expiresAt DATETIME NULL,
  isActive BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_coupons_code (code),
  INDEX idx_coupons_active (isActive)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wishlist (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  productId INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wishlist_user_product (userId, productId),
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (productId) REFERENCES product(id) ON DELETE CASCADE,
  INDEX idx_wishlist_user (userId)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS return_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  orderId INT NOT NULL,
  userId INT NOT NULL,
  reason ENUM('damaged','wrong_item','not_as_described','changed_mind','other') NOT NULL,
  description TEXT,
  status ENUM('pending','approved','rejected','completed') DEFAULT 'pending',
  adminNotes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_returns_order (orderId),
  INDEX idx_returns_user (userId),
  INDEX idx_returns_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  type ENUM('order','review','system','promotion') DEFAULT 'system',
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  link VARCHAR(500) NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notifications_user_read (userId, is_read),
  INDEX idx_notifications_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS review_reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reviewId INT NOT NULL,
  userId INT NOT NULL,
  reason ENUM('spam','inappropriate','fake','other') NOT NULL,
  status ENUM('pending','resolved','dismissed') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reviewId) REFERENCES reviews(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_reports_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_addresses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  label VARCHAR(50) NOT NULL DEFAULT 'Home' COMMENT 'e.g. Home, Work',
  fullName VARCHAR(150) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  addressLine1 VARCHAR(255) NOT NULL,
  addressLine2 VARCHAR(255),
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100),
  zipCode VARCHAR(20),
  country VARCHAR(100) NOT NULL DEFAULT 'Ghana',
  isDefault BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_addresses_user (userId)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS designs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  image VARCHAR(500),
  config JSON COMMENT 'Custom kente design configuration',
  productId INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_designs_user (userId)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payment_methods (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'paystack' COMMENT 'Payment provider: paystack, momo',
  type VARCHAR(50) NOT NULL DEFAULT 'card' COMMENT 'card, mobile_money',
  cardBrand VARCHAR(50),
  last4 VARCHAR(10),
  expMonth VARCHAR(2),
  expYear VARCHAR(4),
  authorizedCode VARCHAR(255) COMMENT 'Paystack authorization code',
  isDefault BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_payment_methods_user (userId)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS support_tickets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  subject VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'general',
  message TEXT NOT NULL,
  status ENUM('open','answered','closed') DEFAULT 'open',
  reply TEXT,
  repliedAt DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_support_tickets_user (userId),
  INDEX idx_support_tickets_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS platform_revenue (
  id INT AUTO_INCREMENT PRIMARY KEY,
  orderId INT NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  source ENUM('platform_product','commission','refund') DEFAULT 'platform_product',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_platform_revenue_order_source (orderId, source),
  INDEX idx_platform_revenue_created (created_at)
) ENGINE=InnoDB;`;


const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  multipleStatements: true,
});

try {
  await connection.query(SQL);

  // MySQL lacks ADD COLUMN IF NOT EXISTS, so check information_schema first.
  const colExists = async (table, column) => {
    const [[res]] = await connection.query(
      `SELECT COUNT(*) AS c
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    );
    return !!(res && res.c > 0);
  };

  // Add `description` to product if missing.
  if (!(await colExists('product', 'description'))) {
    await connection.query(`ALTER TABLE product ADD COLUMN description TEXT NULL`);
    console.log('✅ Added product.description column');
  }

  // Add `vendorId` to product if missing (owner vendor = the user id of the
  // vendor account, NULL = platform product). Backed by productModel and the
  // vendor product endpoints. Must come before any vendor joins run.
  if (!(await colExists('product', 'vendorId'))) {
    await connection.query(
      `ALTER TABLE product ADD COLUMN vendorId INT NULL COMMENT 'Owner vendor user id; NULL = platform product'`
    );
    try {
      await connection.query(
        `ALTER TABLE product
         ADD CONSTRAINT fk_product_vendor FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE SET NULL`
      );
      console.log('✅ Added product.vendorId column + FK');
    } catch (fkErr) {
      console.warn(`⚠️  Could not add product.vendorId FK: ${fkErr.message}`);
    }
  }

  // Add brute-force lockout columns to users (used by usersModel.authenticate).
  if (!(await colExists('users', 'failed_login_attempts'))) {
    await connection.query(
      `ALTER TABLE users ADD COLUMN failed_login_attempts INT NOT NULL DEFAULT 0`
    );
    console.log('✅ Added users.failed_login_attempts column');
  }
  if (!(await colExists('users', 'locked_until'))) {
    await connection.query(
      `ALTER TABLE users ADD COLUMN locked_until DATETIME NULL`
    );
    console.log('✅ Added users.locked_until column');
  }

  // Vendor payout: allow choosing bank OR mobile money (momo).
  // Bank columns become nullable; momo uses provider + phone number.
  if (!(await colExists('vendors', 'payoutType'))) {
    await connection.query(
      `ALTER TABLE vendors ADD COLUMN payoutType ENUM('bank','momo') NOT NULL DEFAULT 'bank'`
    );
    console.log('✅ Added vendors.payoutType column');
  }
  if (!(await colExists('vendors', 'momoProvider'))) {
    await connection.query(
      `ALTER TABLE vendors ADD COLUMN momoProvider VARCHAR(20) NULL COMMENT 'MTN, VOD, ATL, TGO'`
    );
    console.log('✅ Added vendors.momoProvider column');
  }
  if (!(await colExists('vendors', 'momoNumber'))) {
    await connection.query(
      `ALTER TABLE vendors ADD COLUMN momoNumber VARCHAR(20) NULL COMMENT 'Mobile money phone number'`
    );
    console.log('✅ Added vendors.momoNumber column');
  }
  if (!(await colExists('vendors', 'recipientType'))) {
    await connection.query(
      `ALTER TABLE vendors ADD COLUMN recipientType VARCHAR(20) NULL COMMENT 'nuban/bank or mobile_money'`
    );
    console.log('✅ Added vendors.recipientType column');
  }

  // Relax the bank-only NOT NULL constraints so a momo-only vendor can exist.
  await connection.query(`ALTER TABLE vendors MODIFY bankName VARCHAR(100) NULL`);
  await connection.query(`ALTER TABLE vendors MODIFY accountNumber VARCHAR(50) NULL`);
  await connection.query(`ALTER TABLE vendors MODIFY bankCode VARCHAR(20) NULL`);

  // Deferred coupon consumption: store the pending coupon id on the order so it
  // is only incremented when payment is confirmed (webhook / admin mark-paid).
  if (!(await colExists('orders', 'couponId'))) {
    await connection.query(`ALTER TABLE orders ADD COLUMN couponId INT NULL`);
    console.log('✅ Added orders.couponId column');
  }

  // Vendor fulfilment tracking for customised (custom-woven) orders.
  // expectedCompletionDate = order start + productionTime (days); shown to the
  // buyer as "X days left to finish weaving". productionNote lets the vendor
  // post progress notes that get surfaced to the customer.
  if (!(await colExists('orders', 'expectedCompletionDate'))) {
    await connection.query(`ALTER TABLE orders ADD COLUMN expectedCompletionDate DATETIME NULL`);
    console.log('✅ Added orders.expectedCompletionDate column');
  }
  if (!(await colExists('orders', 'productionNote'))) {
    await connection.query(`ALTER TABLE orders ADD COLUMN productionNote TEXT NULL COMMENT 'Vendor progress note (customised orders)'`);
    console.log('✅ Added orders.productionNote column');
  }

  // Extend the orderStatus enum with the vendor fulfilment steps: packaging and
  // arrived ("on its way" is the existing 'shipped' state). Preserves all
  // existing values so no current data breaks.
  const [[enumRow]] = await connection.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'orderStatus'`
  );
  const currentEnum = enumRow ? (enumRow.COLUMN_TYPE || '').replace(/^enum\(|\)$/g, '') : '';
  if (currentEnum && currentEnum.indexOf('packaging') === -1) {
    await connection.query(
      `ALTER TABLE orders MODIFY orderStatus ENUM('pending','processing','packaging','shipped','arrived','delivered','cancelled') NOT NULL DEFAULT 'pending'`
    );
    console.log('✅ Extended orders.orderStatus enum (added packaging, arrived)');
  }

  // Add `vendorId` to coupons table for vendor-specific coupons.
  if (!(await colExists('coupons', 'vendorId'))) {
    await connection.query(
      `ALTER TABLE coupons ADD COLUMN vendorId INT NULL COMMENT 'Owner vendor user id; NULL = platform coupon'`
    );
    try {
      await connection.query(
        `ALTER TABLE coupons
         ADD CONSTRAINT fk_coupons_vendor FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE SET NULL`
      );
      console.log('✅ Added coupons.vendorId column + FK');
    } catch (fkErr) {
      console.warn(`⚠️  Could not add coupons.vendorId FK: ${fkErr.message}`);
    }
  }

  console.log('✅ Tables created/verified: contacts, subscribers, reviews, webhook_events, ai_tryon_usage, promotions, coupons, wishlist, return_requests, notifications, review_reports, user_addresses, designs, payment_methods, support_tickets, platform_revenue, vendor momo payout columns');
} catch (err) {
  console.error('❌ Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await connection.end();
}
