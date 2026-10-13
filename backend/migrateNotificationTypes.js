// @ts-check
// FILE LOCATION: backend/migrateNotificationTypes.js
// DESCRIPTION: NOTIF-1 — notifications.type is ENUM('order','review','system',
//              'promotion'), but custom-request notifications are created with
//              type 'custom' (7 call sites) and buyback notifications with
//              'buyback' (3). Under strict SQL mode (MySQL and TiDB) every such
//              INSERT failed with "Data truncated for column 'type'", and the
//              error was swallowed — those in-app notifications were never
//              stored. Appends the missing values to the ENUM (existing values
//              and rows untouched; appending ENUM members is a metadata-only
//              change on MySQL 8 and TiDB). Idempotent; fails loudly.
// Run from backend/:  node migrateNotificationTypes.js
import pool from './config/db.js';

const REQUIRED = ['custom', 'buyback'];

try {
  const [[col]] = /** @type {any} */ (await pool.query(
    `SELECT COLUMN_TYPE AS t, COLUMN_DEFAULT AS d, IS_NULLABLE AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'type'`
  ));
  if (!col) throw new Error('notifications.type not found — run the earlier migrations first');
  const current = [...String(col.t).matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]);
  const missing = REQUIRED.filter((v) => !current.includes(v));
  if (missing.length === 0) {
    console.log('notifications.type already allows custom and buyback — skipping');
  } else {
    const values = [...current, ...missing].map((v) => `'${v.replace(/'/g, "''")}'`).join(',');
    const def = col.d == null ? '' : ` DEFAULT '${String(col.d).replace(/'/g, "''")}'`;
    await pool.query(`ALTER TABLE notifications MODIFY type ENUM(${values})${col.n === 'NO' ? ' NOT NULL' : ' NULL'}${def}`);
    console.log(`✅ notifications.type extended with ${missing.join(', ')}`);
  }
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`❌ migrateNotificationTypes failed: ${/** @type {any} */ (err).message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
