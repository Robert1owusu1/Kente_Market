#!/usr/bin/env node
// FILE LOCATION: backend/scripts/ci-prepare-test-db.mjs
// DESCRIPTION: CI only — prepares the disposable MySQL service for the full
//   suite run as the unprivileged CI user. Refuses anything but loopback.
//   1. GRANT on km_scratch_* — scratch schemas created/dropped by
//      migrationFailureExit and internationalFxThreshold (otherwise they skip
//      or fail with ER_DBACCESS_DENIED_ERROR).
//   2. log_bin_trust_function_creators=1 — MySQL 8.4 enables binary logging by
//      default, and then CREATE TRIGGER needs SUPER; payoutLifecycle test 4
//      uses a trigger to simulate a failing settlement write
//      (ER_BINLOG_CREATE_ROUTINE_NEED_SUPER otherwise).
//   CI_DB_ROOT_PASSWORD=... node backend/scripts/ci-prepare-test-db.mjs
import mysql from 'mysql2/promise';

const host = process.env.DB_HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`refusing: DB_HOST ${host} is not loopback`);
  process.exit(1);
}
const user = process.env.DB_USER || 'ci';
const conn = await mysql.createConnection({
  host, port: Number(process.env.DB_PORT) || 3306, user: 'root', password: process.env.CI_DB_ROOT_PASSWORD || '',
});
try {
  await conn.query(`GRANT ALL ON \`km\\_scratch\\_%\`.* TO ?@'%'`, [user]);
  await conn.query('SET GLOBAL log_bin_trust_function_creators = 1');
  console.log(`granted ${user} on km\\_scratch\\_% scratch databases; log_bin_trust_function_creators=1`);
} finally {
  await conn.end();
}
