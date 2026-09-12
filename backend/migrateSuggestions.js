// backend/migrateSuggestions.js
// Creates the suggestions table (user feedback shipped to the main admin).
// Idempotent: safe to run more than once.
import pool from './config/db.js';

const run = async () => {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS suggestions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      subject VARCHAR(255) NOT NULL,
      body TEXT NOT NULL,
      status ENUM('new','in_review','done') NOT NULL DEFAULT 'new',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_suggestions_user (userId, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('✅ suggestions table ready');
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  });