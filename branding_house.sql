-- Create database
CREATE DATABASE IF NOT EXISTS branding_house;
USE branding_house;

-- Users table
-- Columns must match the queries used in backend/models/usersModel.js,
-- backend/config/passPort.js and backend/utils/cleanupJobs.js
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  firstName VARCHAR(100) NOT NULL,
  lastName VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(100),
  zipCode VARCHAR(20),
  country VARCHAR(100),
  role ENUM('customer', 'vendor', 'admin') DEFAULT 'customer',
  isActive BOOLEAN DEFAULT true,
  is_email_verified BOOLEAN DEFAULT false,
  email_verification_token VARCHAR(255),
  email_verification_expires DATETIME,
  verification_attempts INT DEFAULT 0,
  last_verification_attempt DATETIME,
  reset_password_token VARCHAR(255),
  reset_password_expire DATETIME,
  profile_picture VARCHAR(255),
  profileImage VARCHAR(255),
  googleId VARCHAR(255),
  facebookId VARCHAR(255),
  last_login DATETIME,
  failed_login_attempts INT DEFAULT 0,
  locked_until DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Promotions / banners / events table
CREATE TABLE IF NOT EXISTS promotions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  image VARCHAR(500),
  type ENUM('banner', 'popup', 'event', 'discount', 'giveaway', 'promo') NOT NULL DEFAULT 'banner',
  priority INT DEFAULT 0,
  link VARCHAR(500),
  linkText VARCHAR(100),
  bgColor VARCHAR(50) DEFAULT '#f59e0b',
  textColor VARCHAR(50) DEFAULT '#ffffff',
  startDate DATETIME NULL,
  endDate DATETIME NULL,
  isActive BOOLEAN DEFAULT true,
  showAsPopup BOOLEAN DEFAULT false,
  popupDismissedExpiryHours INT DEFAULT 24,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_promotions_type (type),
  INDEX idx_promotions_active (isActive),
  INDEX idx_promotions_priority (priority),
  INDEX idx_promotions_dates (startDate, endDate)
);
-- Vendors table (multi-vendor escrow)
-- Vendors are users with role='vendor' who also have a bank/recipient record here.
CREATE TABLE vendors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  businessName VARCHAR(255) NOT NULL,
  contactPhone VARCHAR(50),
  payoutType ENUM('bank','momo') NOT NULL DEFAULT 'bank' COMMENT 'Payout method: bank account or mobile money',
  bankName VARCHAR(100),
  accountNumber VARCHAR(50),
  bankCode VARCHAR(20),
  momoProvider VARCHAR(20) COMMENT 'Mobile money telco: MTN, VOD, ATL, TGO',
  momoNumber VARCHAR(20) COMMENT 'Mobile money phone number',
  recipientCode VARCHAR(255),
  recipientType VARCHAR(20) COMMENT 'Paystack recipient type: nuban or mobile_money',
  platformFeeRate DECIMAL(5,4) DEFAULT 0.1000 COMMENT 'Platform commission deducted from escrow payout',
  status ENUM('pending', 'approved', 'suspended') DEFAULT 'pending',
  slug VARCHAR(255) NULL COMMENT 'Human-friendly storefront URL segment',
  logo VARCHAR(500) NULL,
  coverImage VARCHAR(500) NULL,
  businessDescription TEXT NULL,
  weaverStory TEXT NULL,
  yearsExperience INT DEFAULT 0,
  location VARCHAR(255) NULL,
  workshop VARCHAR(255) NULL,
  socialMedia JSON NULL COMMENT 'Whitelisted social links (facebook, instagram, ...)',
  verificationLevel ENUM('pending','verified','trusted_artisan','master_weaver') DEFAULT 'pending',
  badges JSON NULL COMMENT 'Showcase badge keys (top_weaver, verified_vendor, ...)',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_vendors_userId (userId),
  INDEX idx_vendors_status (status),
  INDEX idx_vendors_slug (slug),
  INDEX idx_vendors_level (verificationLevel)
);

-- Products table
CREATE TABLE product (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  img VARCHAR(500) NOT NULL,
  rating DECIMAL(2,1) DEFAULT 0,
  price DECIMAL(10,2) NOT NULL,
  originalPrice DECIMAL(10,2),
  color VARCHAR(100),
  category VARCHAR(100) NOT NULL,
  sizes JSON,
  printType VARCHAR(100),
  material VARCHAR(100),
  reviews INT DEFAULT 0,
  isCustomizable BOOLEAN DEFAULT false,
  colors JSON,
  tag VARCHAR(100),
  fabricType VARCHAR(100),
  productionTime INT DEFAULT 1,
  featured BOOLEAN DEFAULT false,
  basePrice DECIMAL(10,2),
  vendorId INT NULL COMMENT 'Owner vendor; NULL = platform product',
  -- Marketplace upgrade: moderation workflow
  approvalStatus ENUM('pending','approved','rejected','changes_requested') DEFAULT 'approved' COMMENT 'Approved for platform products; vendor listings start pending',
  approvalNote TEXT NULL,
  approvedAt DATETIME NULL,
  -- Marketplace upgrade: inventory
  stock INT NOT NULL DEFAULT 0,
  sku VARCHAR(100) NULL,
  lowStockThreshold INT NOT NULL DEFAULT 5,
  -- Marketplace upgrade: Kente provenance fields
  descriptionHTML LONGTEXT NULL,
  patternName VARCHAR(255) NULL,
  patternMeaning TEXT NULL,
  culturalSignificance TEXT NULL,
  origin VARCHAR(255) NULL,
  weavingTechnique VARCHAR(100) NULL,
  yards DECIMAL(6,2) NULL,
  occasions JSON NULL,
  designStory TEXT NULL,
  careInstructions TEXT NULL,
  weight DECIMAL(10,3) NULL,
  wholesalePrice DECIMAL(10,2) NULL,
  retailPrice DECIMAL(10,2) NULL,
  madeToOrder BOOLEAN DEFAULT false,
  video VARCHAR(500) NULL,
  gallery JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_product_category (category),
  INDEX idx_product_featured (featured),
  INDEX idx_product_tag (tag),
  INDEX idx_product_price (price),
  INDEX idx_product_vendor (vendorId),
  INDEX idx_product_approval (approvalStatus),
  CONSTRAINT fk_product_vendor FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE SET NULL
);

-- Orders table (after users & product exist)
CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  orderNumber VARCHAR(100) UNIQUE NOT NULL,
  items JSON NOT NULL,
  totalAmount DECIMAL(10,2) NOT NULL,
  shippingAddress JSON,
  billingAddress JSON,
  paymentMethod VARCHAR(50) DEFAULT 'pending',
  paymentStatus ENUM('pending', 'paid', 'failed', 'refunded') DEFAULT 'pending',
  orderStatus ENUM('pending', 'processing', 'packaging', 'shipped', 'arrived', 'delivered', 'cancelled') DEFAULT 'pending',
  escrowStatus ENUM('none', 'held', 'releasing', 'released', 'failed') DEFAULT 'none' COMMENT 'Escrow lifecycle for multi-vendor payouts',
  escrowReleaseDeadline DATETIME NULL COMMENT 'Auto-release timestamp when customer does not confirm receipt',
  shippingCost DECIMAL(10,2) DEFAULT 0,
  tax DECIMAL(10,2) DEFAULT 0,
  discount DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  paymentReference VARCHAR(255),
  couponId INT NULL COMMENT 'Coupon applied at checkout; usage consumed only on confirmed payment',
  expectedCompletionDate DATETIME NULL COMMENT 'Est. completion = order start + productionTime (customised orders)',
  productionNote TEXT NULL COMMENT 'Vendor progress note (customised orders)',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_orders_userId (userId),
  INDEX idx_orders_paymentReference (paymentReference),
  INDEX idx_orders_paymentStatus (paymentStatus),
  INDEX idx_orders_orderStatus (orderStatus),
  INDEX idx_orders_escrowStatus (escrowStatus)
);

-- Escrow allocations: per-vendor share of an order, held until customer confirmation
CREATE TABLE escrow_allocations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  orderId INT NOT NULL,
  vendorId INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  platformFeeRate DECIMAL(5,4) DEFAULT 0.1000,
  platformFee DECIMAL(10,2) DEFAULT 0,
  payoutAmount DECIMAL(10,2) DEFAULT 0,
  status ENUM('pending', 'held', 'available', 'releasing', 'released', 'failed') DEFAULT 'pending',
  payoutReference VARCHAR(255),
  released_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE CASCADE,
  allocationType ENUM('standard','advance','balance') NOT NULL DEFAULT 'standard',
  UNIQUE KEY uq_escrow_order_vendor_type (orderId, vendorId, allocationType),
  INDEX idx_escrow_vendor (vendorId),
  INDEX idx_escrow_status (status),
  INDEX idx_escrow_payoutReference (payoutReference)
);

-- Vendor wallet: durable per-vendor balance derived from released escrow,
-- drawn down by manual withdrawals.
CREATE TABLE IF NOT EXISTS vendor_wallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendorId INT NOT NULL UNIQUE,
  available_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_earned DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_withdrawn DECIMAL(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Wallet ledger: every credit (escrow release to vendor) and withdrawal.
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendorId INT NOT NULL,
  type ENUM('credit','withdrawal','fee') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  reference VARCHAR(100) DEFAULT NULL,
  note VARCHAR(255) DEFAULT NULL,
  allocationId INT DEFAULT NULL,
  status ENUM('pending','succeeded','failed') NOT NULL DEFAULT 'succeeded',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_wt_vendor (vendorId),
  INDEX idx_wt_allocation (allocationId),
  UNIQUE KEY uq_wallet_credit_allocation (vendorId, allocationId, type),
  FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Provider-facing payout outbox. A row is committed before Paystack is called
-- so timeout retries use the same reference and cannot duplicate a transfer.
CREATE TABLE IF NOT EXISTS payout_attempts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  allocationId INT NOT NULL,
  vendorId INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  reference VARCHAR(120) NOT NULL,
  providerReference VARCHAR(255) DEFAULT NULL,
  isFull TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('processing','succeeded','failed','reversed') NOT NULL DEFAULT 'processing',
  lastError VARCHAR(500) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payout_attempt_reference (reference),
  UNIQUE KEY uq_payout_attempt_provider_reference (providerReference),
  INDEX idx_payout_attempt_allocation_status (allocationId, status),
  FOREIGN KEY (allocationId) REFERENCES escrow_allocations(id) ON DELETE RESTRICT,
  FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Settings table (used by backend/models/settingModel.js)
CREATE TABLE IF NOT EXISTS settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  settingKey VARCHAR(100) UNIQUE NOT NULL,
  settingValue TEXT,
  settingType VARCHAR(20) DEFAULT 'string',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Contact messages
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

-- Newsletter subscribers
CREATE TABLE IF NOT EXISTS subscribers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  subscribed BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_subscribers_email (email)
) ENGINE=InnoDB;

-- Product reviews
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

-- Coupon codes
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

-- Wishlist / Favorites
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

-- Return / Refund requests
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

-- Notifications
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

-- Review reports
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

-- Webhook events (idempotency)
CREATE TABLE IF NOT EXISTS webhook_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event VARCHAR(100) NOT NULL,
  reference VARCHAR(255) NOT NULL,
  payload JSON,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processing_status ENUM('received','processing','processed','failed') NOT NULL DEFAULT 'received',
  attempts INT NOT NULL DEFAULT 0,
  last_error VARCHAR(500) DEFAULT NULL,
  UNIQUE KEY uq_webhook_event_ref (event, reference)
) ENGINE=InnoDB;

-- AI Try-On usage tracking
CREATE TABLE IF NOT EXISTS ai_tryon_usage (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  usage_date DATE NOT NULL,
  count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tryon_user_date (userId, usage_date),
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- User address book
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

-- Custom kente designs
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

-- Saved payment methods
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

-- Support tickets (user help & support)
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

-- Product categories (authoritative list; admin-managed)
CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  sortOrder INT NOT NULL DEFAULT 0,
  isActive TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT INTO categories (name, description, sortOrder, isActive) VALUES
  ('Double Weaving', 'Cloth woven with a double interlace technique', 1, 1),
  ('Single Weaving', 'Cloth woven with a single interlace technique', 2, 1),
  ('Triple Weaving', 'Cloth woven with a triple interlace technique', 3, 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- =====================================================================
-- MARKETPLACE UPGRADE (multi-vendor: staff, commissions, campaigns,
-- messaging, authenticity certificates)
-- Mirrors backend/migrateMarketplace.js
-- =====================================================================

-- Vendor staff: employees granted scoped access to the vendor dashboard.
CREATE TABLE IF NOT EXISTS vendor_staff (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendorId INT NOT NULL COMMENT 'vendors.userId (users.id of the vendor owner)',
  name VARCHAR(150) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  permissions JSON NULL COMMENT 'Scoped flags (manage_orders, view_customers, ...)',
  status ENUM('active','deactivated') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_vendor_staff_vendor (vendorId),
  INDEX idx_vendor_staff_status (status)
) ENGINE=InnoDB;

-- Commission rules: platform fee as a percentage, resolved per order item with
-- specificity product > vendor > category > global, hard-capped at 50%.
CREATE TABLE IF NOT EXISTS commission_rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scope ENUM('global','category','vendor','product') NOT NULL,
  targetId VARCHAR(255) NULL COMMENT 'category name, vendor users.id, or product id',
  rate DECIMAL(5,4) NOT NULL COMMENT '0.0000 - 0.5000',
  minRate DECIMAL(5,4) NOT NULL DEFAULT 0.0000,
  maxRate DECIMAL(5,4) NOT NULL DEFAULT 0.5000,
  priority INT NOT NULL DEFAULT 5,
  isActive TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_commission_scope (scope, isActive)
) ENGINE=InnoDB;

-- Buyer <-> vendor enquiries (kept inside the platform; no phone sharing).
CREATE TABLE IF NOT EXISTS vendor_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendorId INT NOT NULL COMMENT 'users.id of the vendor',
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
  INDEX idx_messages_vendor_status (vendorId, status),
  INDEX idx_messages_customer (customerId)
) ENGINE=InnoDB;

-- Marketing campaigns (site-wide, e.g. KENTE WEEK).
CREATE TABLE IF NOT EXISTS campaigns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  discountType ENUM('percentage','fixed') NOT NULL DEFAULT 'percentage',
  discountValue DECIMAL(10,2) NOT NULL,
  startsAt DATETIME NOT NULL,
  endsAt DATETIME NOT NULL,
  status ENUM('draft','active','ended') DEFAULT 'draft',
  createdBy INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_campaigns_status (status),
  INDEX idx_campaigns_dates (startsAt, endsAt)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS campaign_products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  campaignId INT NOT NULL,
  productId INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_campaign_product (campaignId, productId),
  FOREIGN KEY (campaignId) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (productId) REFERENCES product(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS campaign_vendors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  campaignId INT NOT NULL,
  vendorId INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_campaign_vendor (campaignId, vendorId),
  FOREIGN KEY (campaignId) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Kente authenticity certificates with scannable QR token (provenance record).
CREATE TABLE IF NOT EXISTS authenticity_certificates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  certificateNumber VARCHAR(50) NOT NULL UNIQUE COMMENT 'KT-YYYY-00001',
  productId INT NOT NULL,
  vendorId INT NULL,
  orderId INT NOT NULL,
  customerId INT NOT NULL,
  patternName VARCHAR(255) NULL,
  weaverName VARCHAR(255) NULL,
  workshop VARCHAR(255) NULL,
  village VARCHAR(255) NULL,
  patternMeaning TEXT NULL,
  dateRegistered DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  issuedTo VARCHAR(255) NULL,
  qrToken VARCHAR(64) NOT NULL UNIQUE,
  status ENUM('active','revoked') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_certificates_customer (customerId),
  INDEX idx_certificates_product (productId),
  INDEX idx_certificates_order (orderId),
  CONSTRAINT fk_cert_product FOREIGN KEY (productId) REFERENCES product(id) ON DELETE CASCADE,
  CONSTRAINT fk_cert_order FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB;
