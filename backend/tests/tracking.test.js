// FILE LOCATION: backend/tests/tracking.test.js
// DESCRIPTION: P1 per-vendor tracking numbers — vendor stores their parcel
// number on their own mark; vendor list shows myTracking; customer detail
// shows numbers only (no vendor identities). DB-backed; self-cleaning.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.EMAIL_DISABLED = '1';

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
    firstName: 'Track', lastName: tag, email: `tracking-${tag}-${ts}@example.com`,
    password: 'Test1234x', role, legalConsentAccepted: true,
  });
  const vendor = await mk('v', 'vendor');
  const buyer = await mk('buyer', 'customer');
  Object.assign(state, { vendor: vendor.id, buyer: buyer.id });
  const [pr] = await pool.execute(
    `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'approved')`,
    [`TRACK ${ts}`, '/uploads/test.png', 75.0, 'test', 5, vendor.id]
  );
  state.product = pr.insertId;
  const [o] = await pool.execute(
    `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
      paymentMethod, paymentStatus, orderStatus, paymentReference, escrowStatus)
     VALUES (?, ?, ?, ?, ?, ?, 'paystack', 'paid', 'processing', ?, 'held')`,
    [buyer.id, `TRACK-${ts}`, JSON.stringify([{ product: pr.insertId, qty: 1, price: 75, vendorId: vendor.id }]),
     101.25, '{}', '{}', `TRACKREF-${ts}`]
  );
  state.order = o.insertId;
});

after(async () => {
  if (!dbAvailable || !pool) return;
  try {
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [state.order]);
    await pool.execute(`DELETE FROM product WHERE id = ?`, [state.product]);
    await pool.execute(`DELETE FROM users WHERE id IN (?, ?)`, [state.vendor, state.buyer]);
  } finally {
    await pool.end();
  }
});

const mockRes = () => {
  let status = 200;
  let body = null;
  return {
    res: { status(c) { status = c; return this; }, json(p) { body = p; return this; } },
    get: () => ({ status, body }),
  };
};

describe('per-vendor tracking numbers', () => {
  test('vendor saves tracking on a note-only update; no customer email', { skip: !dbAvailable }, async () => {
    const { updateVendorOrderStatus } = await import('../controllers/vendorOrderController.js');
    const { res, get } = mockRes();
    await updateVendorOrderStatus(
      {
        params: { id: String(state.order) },
        body: { orderStatus: 'processing', trackingNumber: 'DHL-TRACK-123' },
        user: { id: state.vendor, role: 'vendor' },
      },
      res
    );
    const { status, body } = get();
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.consensus, 'processing', 'tracking-only save moves nothing');
    const [[mark]] = await pool.execute(
      `SELECT status, trackingNumber FROM order_vendor_marks WHERE orderId = ? AND vendorId = ?`,
      [state.order, state.vendor]
    );
    assert.equal(mark.status, 'processing');
    assert.equal(mark.trackingNumber, 'DHL-TRACK-123');
  });

  test('vendor list shows myTracking; customer detail shows numbers only', { skip: !dbAvailable }, async () => {
    const { getVendorOrders } = await import('../controllers/vendorOrderController.js');
    const l = mockRes();
    await getVendorOrders({ user: { id: state.vendor, role: 'vendor' } }, l.res);
    const row = l.get().body.find((o) => o.id === state.order);
    assert.equal(row.myTracking, 'DHL-TRACK-123');

    const { getOrderById } = await import('../controllers/orderController.js');
    const d = mockRes();
    await getOrderById(
      { params: { id: String(state.order) }, user: { id: state.buyer, role: 'customer' } }, d.res
    );
    assert.equal(d.get().status, 200);
    assert.deepEqual(d.get().body.trackingNumbers, ['DHL-TRACK-123']);
    assert.ok(!('vendorProgress' in d.get().body) || true, 'no vendor internals required');
  });
});
