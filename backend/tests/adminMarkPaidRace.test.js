// FILE LOCATION: backend/tests/adminMarkPaidRace.test.js
// DESCRIPTION: SEC-2 — admin mark-paid could resurrect a REFUNDED order.
//   The handler reads the order, refuses refunded/cancelled, then flips with
//   `WHERE paymentStatus != 'paid'` — which matches 'refunded'. A refund that
//   lands between the read and the UPDATE (webhook, reconciler, another admin)
//   was flipped back to paid and the paid side effects ran again. The CAS now
//   refuses refunded rows itself. The race is reproduced deterministically by
//   handing the handler a stale (pre-refund) snapshot.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.EMAIL_DISABLED = '1';
process.env.REDIS_URL = '';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

const TS = Date.now();
const fx = { buyer: null, order: null };
let updateOrderToPaid;
let Order;

const mockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};

describe('admin mark-paid cannot resurrect a refunded order (SEC-2)', { skip: !dbAvailable }, () => {
  before(async () => {
    fx.buyer = (await pool.execute(
      `INSERT INTO users (email, password, firstName, lastName, role, is_email_verified)
       VALUES (?, 'x', 'AMP', 'buyer', 'customer', 1)`, [`amp-${TS}@example.com`]
    ))[0].insertId;
    // Already refunded in the database (orderStatus not cancelled, so only the
    // paymentStatus guard stands between it and a paid flip).
    fx.order = (await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
         paymentMethod, paymentStatus, orderStatus, paymentReference)
       VALUES (?, ?, '[]', 75, '{}', '{}', 'paystack', 'refunded', 'delivered', ?)`,
      [fx.buyer, `AMP-${TS}`, `AMP-REF-${TS}`]
    ))[0].insertId;
    ({ updateOrderToPaid } = await import('../controllers/orderController.js'));
    Order = (await import('../models/orderModel.js')).default;
  });

  after(async () => {
    if (!dbAvailable) return;
    await pool.execute(`DELETE FROM financial_events WHERE orderId = ?`, [fx.order]).catch(() => {});
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [fx.order]).catch(() => {});
    await pool.execute(`DELETE FROM users WHERE id = ?`, [fx.buyer]).catch(() => {});
    await pool.end();
  });

  test('a refund landing after the pre-check is not flipped back to paid', async () => {
    const realFindById = Order.findById;
    let calls = 0;
    // First read = the handler's pre-check: the stale, pre-refund snapshot.
    Order.findById = async (id) => {
      calls += 1;
      const row = await realFindById.call(Order, id);
      return calls === 1 && row ? Object.assign(row, { paymentStatus: 'pending' }) : row;
    };
    const res = mockRes();
    try {
      await updateOrderToPaid({ params: { id: String(fx.order) }, user: { id: 1, role: 'admin', email: 'a@test.local' }, headers: {}, ip: '127.0.0.1' }, res);
    } finally {
      Order.findById = realFindById;
    }
    const [[row]] = await pool.execute(`SELECT paymentStatus, paymentSideEffects FROM orders WHERE id = ?`, [fx.order]);
    assert.equal(row.paymentStatus, 'refunded', 'refunded order must stay refunded');
    assert.equal(row.paymentSideEffects, null, 'no paid side effects were started');
    assert.equal(res.statusCode, 400, `expected refusal, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  });
});
