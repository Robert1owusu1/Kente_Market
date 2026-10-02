// FILE LOCATION: backend/tests/partialRefunds.test.js
// DESCRIPTION: P1 per-vendor partial refunds — a vendor's full-lines return
// refunds exactly their share, voids only their escrow, restores only their
// stock, and leaves the innocent vendor + order paid-state untouched.
// Paystack is stubbed (node:test mock); DB-backed otherwise; self-cleaning.
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

const ts = Date.now();
const state = {};

before(async () => {
  if (!dbAvailable || !pool) return;
  const User = (await import('../models/usersModel.js')).default;
  const mk = (tag, role) => User.create({
    firstName: 'Part', lastName: tag, email: `partial-${tag}-${ts}@example.com`,
    password: 'Test1234x', role, legalConsentAccepted: true,
  });
  const buyer = await mk('buyer', 'customer');
  const a = await mk('a', 'vendor');
  const b = await mk('b', 'vendor');
  Object.assign(state, { buyer: buyer.id, vendorA: a.id, vendorB: b.id });

  const mkProd = async (vendorId, tag) => {
    const [r] = await pool.execute(
      `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'approved')`,
      [`PARTIAL ${ts} ${tag}`, '/uploads/test.png', 100.0, 'test', 10, vendorId]
    );
    return r.insertId;
  };
  state.prodA = await mkProd(a.id, 'A');
  state.prodB = await mkProd(b.id, 'B');

  // Paid multi-vendor order: A has 2x100, B has 1x100.
  const items = [
    { product: state.prodA, name: 'a-line', qty: 2, price: 100, vendorId: a.id, reserved: 2 },
    { product: state.prodB, name: 'b-line', qty: 1, price: 100, vendorId: b.id, reserved: 1 },
  ];
  const [o] = await pool.execute(
    `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
      paymentMethod, paymentStatus, orderStatus, shippingCost, tax, discount, paymentReference, escrowStatus, refundedAmount)
     VALUES (?, ?, ?, ?, ?, ?, 'paystack', 'paid', 'processing', 15, 45, 0, ?, 'held', 0)`,
    [buyer.id, `PARTIAL-${ts}`, JSON.stringify(items), 360, '{}', '{}', `PARTREF-${ts}`]
  );
  state.orderId = o.insertId;
  for (const [vid, amt] of [[a.id, 180], [b.id, 90]]) {
    await pool.execute(
      `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status)
       VALUES (?, ?, ?, 0.1, ?, ?, 'held')`,
      [state.orderId, vid, amt, amt * 0.1, amt * 0.9]
    );
  }
  const ReturnRequest = (await import('../models/returnModel.js')).default;
  const rr = await ReturnRequest.create({ orderId: state.orderId, userId: buyer.id, reason: 'damaged', description: 'test' });
  state.returnId = rr.id ?? rr.insertId ?? (await pool.execute(`SELECT id FROM return_requests WHERE orderId = ?`, [state.orderId]).then(([r]) => r[0].id));
});

after(async () => {
  if (!dbAvailable || !pool) return;
  try {
    mock.restoreAll();
    await pool.execute(`DELETE FROM escrow_allocations WHERE orderId = ?`, [state.orderId]);
    await pool.execute(`DELETE FROM financial_events WHERE orderId = ?`, [state.orderId]);
    await pool.execute(`DELETE FROM return_requests WHERE orderId = ?`, [state.orderId]);
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [state.orderId]);
    await pool.execute(`DELETE FROM product WHERE id IN (?, ?)`, [state.prodA, state.prodB]);
    await pool.execute(`DELETE FROM users WHERE id IN (?, ?, ?)`, [state.buyer, state.vendorA, state.vendorB]);
  } finally {
    await pool.end();
  }
});

const approvePartial = async (body) => {
  const { updateReturnStatus } = await import('../controllers/returnController.js');
  let status = 200;
  let payload = null;
  await updateReturnStatus(
    { params: { id: String(state.returnId) }, body, user: { id: 1, role: 'admin' } },
    { status(c) { status = c; return this; }, json(p) { payload = p; return this; } }
  );
  return { status, payload };
};

describe('per-vendor partial refunds', () => {
  test('stub provider; wrong amount rejected before any money moves', { skip: !dbAvailable }, async () => {
    const paystack = (await import('../Services/paystackservices.js')).default;
    mock.method(paystack, 'refundTransaction', async () => ({ status: true, data: {} }));
    const r = await approvePartial({ status: 'approved', vendorId: state.vendorA, amount: 50 });
    assert.equal(r.status, 400, JSON.stringify(r.payload));
    assert.match(r.payload.message, /full lines/);
    const [[alloc]] = await pool.execute(
      `SELECT status FROM escrow_allocations WHERE orderId = ? AND vendorId = ?`, [state.orderId, state.vendorA]
    );
    assert.equal(alloc.status, 'held', 'no escrow touched on validation failure');
    const [[rr]] = await pool.execute(`SELECT status FROM return_requests WHERE orderId = ?`, [state.orderId]);
    assert.equal(rr.status, 'pending', 'rejected validation must not consume the one-way approval');
  });

  test("vendor A's exact share refunds; B untouched; order stays paid", { skip: !dbAvailable }, async () => {
    const r = await approvePartial({ status: 'approved', vendorId: state.vendorA, amount: 200 });
    assert.equal(r.status, 200, JSON.stringify(r.payload));
    assert.equal(r.payload.vendorId, state.vendorA);

    const [[order]] = await pool.execute(
      `SELECT paymentStatus, refundedAmount FROM orders WHERE id = ?`, [state.orderId]
    );
    assert.equal(order.paymentStatus, 'paid', 'order stays paid after partial');
    assert.equal(Number(order.refundedAmount), 200);

    const [allocs] = await pool.execute(
      `SELECT vendorId, status FROM escrow_allocations WHERE orderId = ?`, [state.orderId]
    );
    const byVendor = new Map(allocs.map((x) => [Number(x.vendorId), x.status]));
    assert.equal(byVendor.get(Number(state.vendorA)), 'failed', 'A voided');
    assert.equal(byVendor.get(Number(state.vendorB)), 'held', 'B untouched');

    const [[pa]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [state.prodA]);
    const [[pb]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [state.prodB]);
    assert.equal(Number(pa.stock), 12, 'A lines restored (10 + qty 2)');
    assert.equal(Number(pb.stock), 10, 'B stock untouched');

    const [[j]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM financial_events WHERE dedupeKey = ?`,
      [`refund:${state.orderId}:${state.returnId}:partial:${state.vendorA}`]
    );
    assert.equal(Number(j.n), 1, 'partial journal recorded');
  });
});
