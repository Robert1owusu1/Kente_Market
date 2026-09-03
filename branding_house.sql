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
  bankName VARCHAR(100) NOT NULL,
  accountNumber VARCHAR(50) NOT NULL,
  bankCode VARCHAR(20) NOT NULL,
  recipientCode VARCHAR(255),
  platformFeeRate DECIMAL(5,4) DEFAULT 0.1000 COMMENT 'Platform commission deducted from escrow payout',
  status ENUM('pending', 'approved', 'suspended') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_vendors_userId (userId),
  INDEX idx_vendors_status (status)
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_product_category (category),
  INDEX idx_product_featured (featured),
  INDEX idx_product_tag (tag),
  INDEX idx_product_price (price),
  INDEX idx_product_vendor (vendorId),
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
  orderStatus ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled') DEFAULT 'pending',
  escrowStatus ENUM('none', 'held', 'releasing', 'released', 'failed') DEFAULT 'none' COMMENT 'Escrow lifecycle for multi-vendor payouts',
  escrowReleaseDeadline DATETIME NULL COMMENT 'Auto-release timestamp when customer does not confirm receipt',
  shippingCost DECIMAL(10,2) DEFAULT 0,
  tax DECIMAL(10,2) DEFAULT 0,
  discount DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  paymentReference VARCHAR(255),
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
  status ENUM('pending', 'held', 'releasing', 'released', 'failed') DEFAULT 'pending',
  payoutReference VARCHAR(255),
  released_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (vendorId) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_escrow_order_vendor (orderId, vendorId),
  INDEX idx_escrow_vendor (vendorId),
  INDEX idx_escrow_status (status),
  INDEX idx_escrow_payoutReference (payoutReference)
);

-- Settings table (used by backend/models/settingModel.js)
CREATE TABLE IF NOT EXISTS settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  settingKey VARCHAR(100) UNIQUE NOT NULL,
  settingValue TEXT,
  settingType VARCHAR(20) DEFAULT 'string',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);