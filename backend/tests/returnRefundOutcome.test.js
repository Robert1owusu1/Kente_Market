// FILE LOCATION: backend/tests/returnRefundOutcome.test.js
// DESCRIPTION: R-5 — approving a return reports what happened to the money.
//   A rejected or unknown Paystack refund used to be logged server-side only
//   while the admin got "Return request status updated" (a green toast).
//   Also pins the money-safety rules around each outcome:
//   - issued:   order flips to refunded, claim kept as proof
//   - rejected: no money moved, claim released so the order can be refunded again
//   - unknown:  claim KEPT (refund may exist at the provider), order stays paid
// Paystack is stubbed on the service instance; no network is used.
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
const fx = { buyer: null, orders: [] };
let updateReturnStatus;
let paystack;
let origRefund;
let seq = 0;

const mockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};

const mkPaidOrderWithReturn = async () => {
  seq += 1;
  const reference = `RRO-${TS}-${seq}`;
  const [o] = await pool.execute(
    `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
       paymentMethod, paymentStatus, orderStatus, paymentReference)
     VALUES (?, ?, '[]', 120, '{}', '{}', 'paystack', 'paid', 'delivered', ?)`,
    [fx.buyer, `RRO-${TS}-${seq}`, reference]
  );
  fx.orders.push(o.insertId);
  const [r] = await pool.execute(
    `INSERT INTO return_requests (orderId, userId, reason, status) VALUES (?, ?, 'damaged', 'pending')`,
    [o.insertId, fx.buyer]
  );
  return { orderId: o.insertId, returnId: r.insertId };
};

const approve = async (returnId) => {
  const res = mockRes();
  await updateReturnStatus(
    { params: { id: String(returnId) }, body: { status: 'approved' }, user: { id: 1, role: 'admin' } },
    res
  );
  return res;
};

const orderRow = async (id) =>
  (await pool.execute(`SELECT paymentStatus, refundReference FROM orders WHERE id = ?`, [id]))[0][0];

describe('return approval reports the refund outcome (R-5)', { skip: !dbAvailable }, () => {
  before(async () => {
    fx.buyer = (await pool.execute(
      `INSERT INTO users (email, password, firstName, lastName, role, is_email_verified)
       VALUES (?, 'x', 'RRO', 'buyer', 'customer', 1)`, [`rro-${TS}@example.com`]
    ))[0].insertId;
    ({ updateReturnStatus } = await import('../controllers/returnController.js'));
    paystack = (await import('../Services/paystackservices.js')).default;
    origRefund = paystack.refundTransaction;
  });

  after(async () => {
    if (paystack) paystack.refundTransaction = origRefund;
    if (!dbAvailable) return;
    try {
      for (const id of fx.orders) {
        await pool.execute(`DELETE FROM financial_events WHERE orderId = ?`, [id]);
        await pool.execute(`DELETE FROM return_requests WHERE orderId = ?`, [id]);
        await pool.execute(`DELETE FROM orders WHERE id = ?`, [id]);
      }
      await pool.execute(`DELETE FROM users WHERE id = ?`, [fx.buyer]);
    } catch (err) {
      console.error(`returnRefundOutcome cleanup failed: ${err.message}`);
    }
    await pool.end();
  });

  test('issued: order refunded, admin told it succeeded', async () => {
    const { orderId, returnId } = await mkPaidOrderWithReturn();
    let calls = 0;
    paystack.refundTransaction = async () => { calls += 1; return { status: true, data: {} }; };
    const res = await approve(returnId);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.refundOutcome, 'issued');
    assert.equal(calls, 1);
    const o = await orderRow(orderId);
    assert.equal(o.paymentStatus, 'refunded');
    assert.ok(o.refundReference, 'claim kept as proof of the refund');
  });

  test('rejected: admin warned, no money moved, claim released for a later refund', async () => {
    const { orderId, returnId } = await mkPaidOrderWithReturn();
    paystack.refundTransaction = async () => ({ status: false, message: 'Declined' });
    const res = await approve(returnId);
    assert.equal(res.body.refundOutcome, 'rejected');
    assert.match(res.body.message, /rejected/i);
    const o = await orderRow(orderId);
    assert.equal(o.paymentStatus, 'paid', 'a rejected refund never marks the order refunded');
    assert.equal(o.refundReference, null, 'claim released so the order can still be refunded');
  });

  test('unknown: admin warned, claim kept, nothing marked refunded', async () => {
    const { orderId, returnId } = await mkPaidOrderWithReturn();
    paystack.refundTransaction = async () => { throw new Error('socket hang up'); };
    const res = await approve(returnId);
    assert.equal(res.body.refundOutcome, 'unknown');
    assert.match(res.body.message, /unknown/i);
    const o = await orderRow(orderId);
    assert.equal(o.paymentStatus, 'paid');
    assert.ok(o.refundReference, 'claim kept: the refund may exist at the provider, so it must not be re-issued blindly');
  });
});
