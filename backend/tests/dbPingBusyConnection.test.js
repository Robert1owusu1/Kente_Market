// FILE LOCATION: backend/tests/dbPingBusyConnection.test.js
// DESCRIPTION: DB-PING — config/db.js pings pooled sockets to keep them warm and
//   destroys any socket whose ping misses DB_PING_TIMEOUT_MS. It used to ping
//   CHECKED-OUT connections too: mysql2 queues the ping behind the request's own
//   statement, so a statement slower than the ping timeout (lock wait, slow
//   report, remote TiDB latency) had its socket destroyed under it and the
//   request failed with "DB ping failed" (seen on TiDB in the custom-request
//   checkout). The ping now skips busy connections.
//   Timings are shrunk so the old behaviour fails within ~1 s.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PING_INTERVAL_MS = '100';
process.env.DB_PING_TIMEOUT_MS = '300';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

describe('keep-alive ping never kills a busy connection', { skip: !dbAvailable && 'no database' }, () => {
  after(async () => { await pool?.end().catch(() => {}); });

  test('a statement slower than the ping timeout completes via pool.query', async () => {
    const [rows] = await pool.query('SELECT SLEEP(1.2) AS s, 7 AS v');
    assert.equal(Number(rows[0].v), 7);
  });

  test('a checked-out connection (transaction-style) survives several ping cycles', async () => {
    const conn = await pool.getConnection();
    try {
      await conn.query('SELECT SLEEP(0.6)');
      await new Promise((r) => setTimeout(r, 450)); // idle-but-checked-out between statements
      const [rows] = await conn.query('SELECT SLEEP(0.6) AS s, 8 AS v');
      assert.equal(Number(rows[0].v), 8);
    } finally {
      conn.release();
    }
  });

  test('idle pooled connections are still pinged and stay usable', async () => {
    await new Promise((r) => setTimeout(r, 400)); // several ping cycles on idle sockets
    const [rows] = await pool.query('SELECT 9 AS v');
    assert.equal(Number(rows[0].v), 9);
  });
});
