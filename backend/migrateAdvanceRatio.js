// @ts-check
// FILE: backend/migrateAdvanceRatio.js
// DESCRIPTION: Add advanceRatio column to product table for configurable advance escrow split
// Run: node migrateAdvanceRatio.js (part of npm run db:migrate)

import pool from './config/db.js';

// MySQL/TiDB/MariaDB disagree on `ADD/DROP COLUMN IF NOT EXISTS` (MySQL 8
// rejects both, TiDB requires them), which aborted `npm run db:migrate` against
// a stock MySQL — the dialect the CI service container runs. Probe
// information_schema instead: that form is portable everywhere.
/**
 * @param {import('mysql2').PoolConnection} connection
 * @param {string} table
 * @param {string} column
 * @returns {Promise<boolean>}
 */
const hasColumn = async (connection, table, column) => {
  const [rows] = /** @type {[Array<{ c?: unknown }>]} */ (
    /** @type {unknown} */ (
      await connection.execute(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
      )
    )
  );
  const row = rows[0];
  return Number(row?.c || 0) > 0;
};

const up = async () => {
  const connection = await pool.getConnection();
  try {
    if (await hasColumn(connection, 'product', 'advanceRatio')) {
      console.log('✅ advanceRatio column already exists — skipping');
      return;
    }
    // Add advanceRatio column to product table
    await connection.execute(
      `ALTER TABLE product
       ADD COLUMN advanceRatio DECIMAL(3,2) NULL COMMENT 'Advance escrow ratio 0.00-1.00, NULL = global default (CUSTOM_ADVANCE_RATIO)'`
    );

    console.log('✅ advanceRatio column added to product table');
  } finally {
    connection.release();
  }
};

const down = async () => {
  const connection = await pool.getConnection();
  try {
    if (!(await hasColumn(connection, 'product', 'advanceRatio'))) {
      console.log('✅ advanceRatio column not present — skipping');
      return;
    }
    await connection.execute(`ALTER TABLE product DROP COLUMN advanceRatio`);
    console.log('✅ advanceRatio column dropped from product table');
  } finally {
    connection.release();
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const direction = process.argv[2] || 'up';
  if (direction === 'down') {
    await down();
  } else {
    await up();
  }
  process.exit(0);
}

export { up, down };