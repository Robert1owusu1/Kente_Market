// FILE LOCATION: backend/tests/migrationFailureExit.test.js
// DESCRIPTION: VAL-3 — migrateInternationalAddresses.js / migrateInternationalOrders.js
//   turned every non-duplicate ALTER error into a warning, printed ✅ and exited 0,
//   so `npm run db:migrate` reported success with columns the checkout reads
//   missing. Each script is run as a child process against a scratch database
//   whose tables lack the `AFTER` anchor columns (a real, non-duplicate error),
//   and must exit non-zero; against the migrated test database it must still
//   exit 0 (idempotent re-run). Needs CREATE/DROP DATABASE; skipped otherwise.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = `km_migfail_${process.pid}_${Date.now()}`;

let pool = null;
let skip = false;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
  await pool.query(`CREATE DATABASE \`${SCRATCH}\``);
} catch (err) {
  skip = !pool ? 'no database' : `cannot create a scratch database (${err.code || err.message})`;
}

/** Run a migration script with the same env, pointed at `dbName`. */
const runScript = (script, dbName) => spawnSync(process.execPath, [script], {
  cwd: backendDir,
  env: { ...process.env, DB_NAME: dbName },
  encoding: 'utf8',
  timeout: 60000,
});

describe('international migrations fail loudly (VAL-3)', { skip }, () => {
  before(async () => {
    // Missing addressLine2 / paymentStatus / amount anchors -> ER_BAD_FIELD_ERROR, not a duplicate.
    await pool.query(`CREATE TABLE \`${SCRATCH}\`.user_addresses (id INT PRIMARY KEY, country VARCHAR(80), state VARCHAR(80))`);
    await pool.query(`CREATE TABLE \`${SCRATCH}\`.orders (id INT PRIMARY KEY)`);
    await pool.query(`CREATE TABLE \`${SCRATCH}\`.escrow_allocations (id INT PRIMARY KEY)`);
    await pool.query(`CREATE TABLE \`${SCRATCH}\`.financial_events (id INT PRIMARY KEY)`);
  });

  after(async () => {
    await pool.query(`DROP DATABASE IF EXISTS \`${SCRATCH}\``).catch(() => {});
    await pool.end().catch(() => {});
  });

  for (const script of ['migrateInternationalAddresses.js', 'migrateInternationalOrders.js']) {
    test(`${script}: a real ALTER failure exits non-zero and does not claim success`, () => {
      const r = runScript(script, SCRATCH);
      assert.notEqual(r.status, 0, `exited 0; stdout: ${r.stdout.slice(-300)}`);
      assert.doesNotMatch(r.stdout, /✅/, 'must not print the success line');
    });

    test(`${script}: re-run on the migrated database still exits 0`, () => {
      const r = runScript(script, String(process.env.DB_NAME));
      assert.equal(r.status, 0, `stderr: ${r.stderr.slice(-500)}`);
    });
  }
});

if (skip && pool) await pool.end().catch(() => {});
