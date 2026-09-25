// FILE LOCATION: backend/tests/idempotency.test.js
// DESCRIPTION: Validates the webhook idempotency guard. The Paystack webhook
//              handler (backend/routes/paymentRoutes.js) prevents double escrow
//              releases by INSERT IGNORE-ing each (event, reference) into the
//              webhook_events table and treating a zero insertId as "already
//              processed". This test proves that constraint really blocks a
//              replayed/doubly-delivered webhook.
// NOTE: Uses the real (dev) database, so it inserts then cleans up after itself.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/db.js';

const EVENT = 'charge.success';
const REF = `test-ref-${Date.now()}`;

// DB gate: self-skip when no database is reachable (see promotions.test.js).
let dbAvailable = true;
try {
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

// Mirrors the production handler's dedup step.
const recordWebhookEvent = async () => {
  const [ins] = await pool.execute(
    `INSERT IGNORE INTO webhook_events (event, reference, payload) VALUES (?, ?, ?)`,
    [EVENT, REF, JSON.stringify({ ref: REF })]
  );
  return { insertId: ins.insertId, affectedRows: ins.affectedRows };
};

describe('Webhook idempotency (webhook_events UNIQUE constraint)', { skip: !dbAvailable }, () => {
  before(async () => {
    if (!dbAvailable) return;
    await pool.execute(`DELETE FROM webhook_events WHERE reference = ?`, [REF]);
  });
  after(async () => {
    if (!dbAvailable) {
      await pool.end();
      return;
    }
    await pool.execute(`DELETE FROM webhook_events WHERE reference = ?`, [REF]);
    await pool.end();
  });

  test('the first delivery records the event (insertId > 0)', async () => {
    const first = await recordWebhookEvent();
    assert.ok(first.insertId > 0);
  });

  test('a replay of the same event+reference is a no-op (insertId === 0)', async () => {
    // This is exactly the branch the webhook treats as "Duplicate ignored" so it
    // never runs the escrow-release side effects a second time.
    const second = await recordWebhookEvent();
    assert.equal(second.insertId, 0);
    assert.equal(second.affectedRows, 0);
  });

  test('only ONE row exists for the repeated event+reference', async () => {
    const [[row]] = await pool.execute(
      `SELECT COUNT(*) AS c FROM webhook_events WHERE event = ? AND reference = ?`,
      [EVENT, REF]
    );
    assert.equal(row.c, 1);
  });
});