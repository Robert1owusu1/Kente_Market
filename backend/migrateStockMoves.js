// backend/migrateStockMoves.js
// P1: stock_moves audit ledger — one row per product.stock mutation
// (reserve/sale/restores/expiry/adjust). Write-only from the stock paths;
// read by support tooling and the vendor inventory history (P2 UI).
// Idempotent: safe to run more than once.
import pool from './config/db.js';

const run = async () => {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS stock_moves (
      id INT AUTO_INCREMENT PRIMARY KEY,
      productId INT NOT NULL,
      delta INT NOT NULL COMMENT 'signed units: negative took stock, positive returned it',
      reason VARCHAR(32) NOT NULL,
      orderId INT NULL,
      actorId INT NULL COMMENT 'admin/user who triggered a manual adjust, else NULL',
      note VARCHAR(500) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_moves_product_time (productId, created_at),
      INDEX idx_moves_order (orderId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log(' stock_moves table ready');
  try {
    await pool.execute(
      `ALTER TABLE stock_moves ADD CONSTRAINT fk_moves_product FOREIGN KEY (productId) REFERENCES product(id) ON DELETE CASCADE`
    );
    console.log(' Added fk_moves_product');
  } catch (err) {
    if (/Duplicate|exists/i.test(err.message)) {
      console.log(' fk_moves_product already exists');
    } else {
      console.warn(` Could not add fk_moves_product (non-fatal): ${err.message}`);
    }
  }
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(' Migration failed:', err.message);
    process.exit(1);
  });
