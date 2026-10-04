// @ts-check
// FILE: backend/migrateAdvanceRatio.js
// DESCRIPTION: Add advanceRatio column to product table for configurable advance escrow split
// Run: node migrateAdvanceRatio.js (part of npm run db:migrate)

import pool from './config/db.js';

const up = async () => {
  const connection = await pool.getConnection();
  try {
    // Add advanceRatio column to product table
    await connection.execute(`
      ALTER TABLE product 
      ADD COLUMN IF NOT EXISTS advanceRatio DECIMAL(3,2) NULL COMMENT 'Advance escrow ratio 0.00-1.00, NULL = global default (CUSTOM_ADVANCE_RATIO)'
    `);

    console.log('✅ advanceRatio column added to product table');
  } finally {
    connection.release();
  }
};

const down = async () => {
  const connection = await pool.getConnection();
  try {
    await connection.execute(`ALTER TABLE product DROP COLUMN IF EXISTS advanceRatio`);
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