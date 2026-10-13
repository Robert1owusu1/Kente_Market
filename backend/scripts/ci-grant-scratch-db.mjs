#!/usr/bin/env node
// FILE LOCATION: backend/scripts/ci-grant-scratch-db.mjs
// DESCRIPTION: CI only. Grants the CI database user rights on km_migfail_*
//   scratch databases so tests/migrationFailureExit.test.js runs instead of
//   skipping. Refuses anything but a loopback server.
//   CI_DB_ROOT_PASSWORD=... node scripts/ci-grant-scratch-db.mjs
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
await conn.query(`GRANT ALL ON \`km\\_migfail\\_%\`.* TO ?@'%'`, [user]);
console.log(`granted ${user} on km\\_migfail\\_% scratch databases`);
await conn.end();
