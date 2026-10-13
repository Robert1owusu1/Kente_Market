// FILE LOCATION: backend/tests/webhookPoolOccupancy.test.js
// DESCRIPTION: FV-13 — the charge.success webhook must not hold a pooled
//              connection while it runs the paid side effects. It used to
//              check out one connection per delivery attempt and keep it while
//              applyPaidOrderSideEffects took more from the same pool, so
//              pool-size concurrent paid flips could each hold one and wait
//              for another (hold-and-wait). Here the pool is shrunk to 3 and
//              6 signed deliveries arrive at once: every order must be paid
//              with complete side effects, promptly.
// DISPOSABLE DATABASE ONLY.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Must be set before config/db.js is first imported (pool created at import).
process.env.DB_POOL_SIZE = '3';
process.env.EMAIL_DISABLED = '1';
process.env.REDIS_URL = '';

let dbAvailable = true;
/** @type {any} */ let pool;
{
  pool = (await import('../config/db.js')).default;
  try { await pool.query('SELECT 1'); } catch { dbAvailable = false; }
}

const TS = Date.now();
const fx = { users: [], orders: [] };
/** @type {any} */ let server;

before(async () => {
  if (!dbAvailable) return;
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(String(process.env.DB_HOST)), 'disposable local DB only');
  const express = (await import('express')).default;
  const paymentRoutes = (await import('../routes/paymentRoutes.js')).default;
  const { startServer } = await import('./helpers/httpHarness.js');
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
  app.use('/api/payments', paymentRoutes);
  server = await startServer(app);
});

after(async () => {
  if (server) await server.close();
  if (dbAvailable) {
    for (const id of fx.orders) {
      await pool.execute(`DELETE FROM webhook_events WHERE reference IN (SELECT paymentReference FROM orders WHERE id = ?)`, [id]).catch(() => {});
      await pool.execute(`DELETE FROM financial_events WHERE orderId = ?`, [id]).catch(() => {});
      await pool.execute(`DELETE FROM escrow_allocations WHERE orderId = ?`, [id]).catch(() => {});
      await pool.execute(`DELETE FROM platform_revenue WHERE orderId = ?`, [id]).catch(() => {});
      await pool.execute(`DELETE FROM stock_moves WHERE orderId = ?`, [id]).catch(() => {});
      await pool.execute(`DELETE FROM orders WHERE id = ?`, [id]).catch(() => {});
    }
    for (const id of fx.users) await pool.execute(`DELETE FROM users WHERE id = ?`, [id]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

describe('FV-13 webhook connection occupancy', { skip: !dbAvailable }, () => {
  test('more concurrent paid deliveries than pool connections all complete', async () => {
    const [u] = await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
       VALUES ('FV13', 'Buyer', ?, 'x', 'customer', 1, 1)`, [`fv13-${TS}@test.local`]);
    fx.users.push(u.insertId);
    const N = 6;
    const refs = [];
    for (let i = 0; i < N; i += 1) {
      const reference = `FV13-${TS}-${i}`;
      const [o] = await pool.execute(
        `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
           paymentMethod, paymentStatus, orderStatus, paymentReference, discount, shippingCost, tax, escrowStatus)
         VALUES (?, ?, '[]', 50, '{}', '{}', 'paystack', 'pending', 'pending', ?, 0, 0, 0, 'none')`,
        [u.insertId, `FV13-${TS}-${i}`, reference]);
      fx.orders.push(o.insertId);
      refs.push(reference);
    }
    const deliver = (reference) => {
      const rawBody = JSON.stringify({ event: 'charge.success', data: { reference, amount: 5000, currency: 'GHS', status: 'success' } });
      const signature = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
      return fetch(`${server.baseUrl}/api/payments/paystack-webhook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature }, body: rawBody,
      });
    };
    const started = Date.now();
    const stall = new Promise((_, reject) => setTimeout(() => reject(new Error('webhook deliveries stalled (pool hold-and-wait)')), 20000));
    const responses = await Promise.race([Promise.all(refs.map(deliver)), stall]);
    const elapsed = Date.now() - started;
    assert.deepEqual(responses.map((r) => r.status), Array(N).fill(200));
    const [rows] = await pool.execute(
      `SELECT paymentStatus, paymentSideEffects FROM orders WHERE id IN (${fx.orders.map(() => '?').join(',')})`, fx.orders);
    for (const r of rows) {
      assert.equal(r.paymentStatus, 'paid');
      const fxs = typeof r.paymentSideEffects === 'string' ? JSON.parse(r.paymentSideEffects) : r.paymentSideEffects;
      for (const k of ['escrowHeld', 'stockDecremented', 'financialEventRecorded', 'platformRevenueTracked']) {
        assert.equal(fxs?.[k], true, `${k} applied`);
      }
    }
    assert.ok(elapsed < 15000, `completed in ${elapsed} ms`);
  });
});
