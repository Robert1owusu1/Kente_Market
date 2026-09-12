// backend/migrateMessagePosts.js
// Moves buyer <-> vendor enquiries from a single-reply model to a full thread.
//  1. Creates the message_posts table (one row per message in a conversation).
//  2. Backfills any existing vendor `reply` values as 'vendor' posts so old
//     threads render the same way new ones do.
// Idempotent: safe to run more than once.
import pool from './config/db.js';

const run = async () => {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS message_posts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      messageId INT NOT NULL,
      sender ENUM('customer','vendor') NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_message_posts_message (messageId, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('✅ message_posts table ready');

  // Backfill legacy vendor replies (threads that have a reply but no vendor post yet).
  const [result] = await pool.execute(`
    INSERT INTO message_posts (messageId, sender, body)
    SELECT m.id, 'vendor', m.reply
    FROM vendor_messages m
    WHERE m.reply IS NOT NULL AND TRIM(m.reply) <> ''
      AND NOT EXISTS (SELECT 1 FROM message_posts p WHERE p.messageId = m.id AND p.sender = 'vendor')
  `);
  console.log(`✅ Backfilled ${result.affectedRows || 0} legacy vendor replies into message_posts`);
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  });