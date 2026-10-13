// FILE LOCATION: backend/migrateCustomRequestOrderIdUnique.js
// DESCRIPTION: Add unique constraint on custom_requests.orderId to prevent
//              a single custom request from being linked to multiple orders
//              and a single order from being linked to multiple custom requests.
// Additive and idempotent — never drops or disturbs existing data.
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

const indexExists = async (table, indexName) => {
  const [[res]] = await connection.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  );
  return !!(res && res.c > 0);
};

try {
  // Check if custom_requests table exists
  const [[tableCheck]] = await connection.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_requests'`
  );
  
  if (tableCheck.c === 0) {
    console.log('custom_requests table does not exist — skipping');
    process.exit(0);
  }

  // Check for existing duplicates before adding unique key
  const [dupes] = await connection.query(
    `SELECT orderId, COUNT(*) AS c
     FROM custom_requests
     WHERE orderId IS NOT NULL
     GROUP BY orderId
     HAVING COUNT(*) > 1`
  );

  if (dupes.length > 0) {
    console.warn(`Found ${dupes.length} duplicate orderId group(s) in custom_requests — cannot add unique constraint until resolved:`);
    for (const d of dupes) {
      console.warn(`  orderId=${d.orderId}: ${d.c} rows`);
      const [rows] = await connection.query(
        `SELECT id, status FROM custom_requests WHERE orderId = ? ORDER BY id`,
        [d.orderId]
      );
      console.warn('  Rows:', rows);
    }
    console.error('Manual resolution required before migration can proceed.');
    process.exitCode = 1;
    process.exit(1);
  }

  // Add unique index on orderId (allows multiple NULLs, constrains non-NULL values)
  if (!(await indexExists('custom_requests', 'uq_custom_requests_orderId'))) {
    await connection.query(
      `ALTER TABLE custom_requests ADD UNIQUE KEY uq_custom_requests_orderId (orderId)`
    );
    console.log(' Added UNIQUE KEY uq_custom_requests_orderId (one custom request → one order)');
  } else {
    console.log('uq_custom_requests_orderId already exists — skipping');
  }

  console.log(' Custom request orderId unique migration complete');
} catch (err) {
  console.error(' Custom request orderId unique migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await connection.end();
}