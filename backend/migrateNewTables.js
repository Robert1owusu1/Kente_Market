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

  console.log('✅ Tables created/verified: contacts, subscribers, reviews, webhook_events, ai_tryon_usage, promotions');
} catch (err) {
  console.error('❌ Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await connection.end();
}
