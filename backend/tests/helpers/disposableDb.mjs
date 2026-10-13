// FILE LOCATION: backend/tests/helpers/disposableDb.mjs
// DESCRIPTION: Interlock for suites that stub Paystack and run whole-database
//   recovery/release jobs (escrowCancellationRefund, payoutLifecycle,
//   withdrawalConcurrency). They may run only against a disposable database:
//     - any database on this machine (loopback host), or
//     - a remote server ONLY when ALLOW_REMOTE_TEST_DB=1 AND DB_NAME is a
//       km_scratch_* schema (created and dropped by the test runner) — this is
//       how the money/concurrency suites are run on real TiDB without ever
//       touching a shared schema such as the development `branding_house`.
//   On refusal the pool is closed first: an open pool kept the refused test
//   file alive forever.
import assert from 'node:assert/strict';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export const isDisposableDb = () =>
  LOOPBACK.has(String(process.env.DB_HOST || '').trim()) ||
  (process.env.ALLOW_REMOTE_TEST_DB === '1' && /^km_scratch_[A-Za-z0-9_]+$/.test(String(process.env.DB_NAME || '')));

export const assertDisposableDb = async (pool) => {
  if (isDisposableDb()) return;
  await pool?.end?.().catch(() => {});
  assert.fail(
    `REFUSING TO RUN: ${process.env.DB_HOST}/${process.env.DB_NAME} is not a disposable database ` +
    '(loopback, or ALLOW_REMOTE_TEST_DB=1 with a km_scratch_* DB_NAME)'
  );
};

/** True when the connected server is TiDB (it reports e.g. "8.0.11-TiDB-v8.5.3"). */
export const isTiDBServer = async (pool) => {
  const [[row]] = await pool.query('SELECT VERSION() AS v');
  return /tidb/i.test(String(row?.v || ''));
};
