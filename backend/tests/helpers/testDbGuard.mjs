// FILE LOCATION: backend/tests/helpers/testDbGuard.mjs
// DESCRIPTION: Preloaded (node --import) into the test runner and every test
//              file it spawns. DB-backed suites connect through config/db.js,
//              which loads backend/.env — on a developer machine that file
//              points at the shared TiDB Cloud database, so a bare `npm test`
//              used to write fixtures (users, orders, refunds) into it.
//
//              The suite now refuses to start unless the database is on this
//              machine. A disposable remote database can still be used on
//              purpose with ALLOW_REMOTE_TEST_DB=1. No DB_HOST at all (CI's
//              DB-less run) is fine: the DB-backed suites skip themselves.
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const host = (process.env.DB_HOST || '').trim();

if (host && !LOOPBACK.has(host) && process.env.ALLOW_REMOTE_TEST_DB !== '1') {
  console.error(
    `\nREFUSING TO RUN TESTS: DB_HOST points at a non-local database (${host}).\n` +
    'The test suite creates and deletes users, orders and refunds. Point DB_HOST/DB_PORT/DB_USER/\n' +
    'DB_PASSWORD/DB_NAME at a disposable local MySQL (environment variables override backend/.env),\n' +
    'or set ALLOW_REMOTE_TEST_DB=1 if the remote database is disposable.\n'
  );
  process.exit(1);
}
