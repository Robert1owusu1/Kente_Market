// FILE LOCATION: backend/tests/vendorIsolation.test.js
// DESCRIPTION: P0-2 (per-vendor order projection, no sibling/PII leak) + P0-3
// (consensus fulfilment: one vendor cannot move the shared order or arm
// escrow alone). DB-backed; cleans up after itself.
import { test, describe, before, after } from 'node:test';

// Never attempt real SMTP from tests (see emailEnabled/EMAIL_DISABLED).
process.env.EMAIL_DISABLED = '1';
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

const mockRes = () => {
  let status = 200;
  let body = null;
  return {
    res: {
      status(code) { status = code; return this; },
      json(payload) { body = payload; return this; },
    },
    get: () => ({ status, body }),
  };
};

before(async () => {
  if (!dbAvailable || !pool) return;
  const User = (await import('../models/usersModel.js')).default;
  const mk = (tag, role) => User.create({
    firstName: 'Vend', lastName: tag, email: `vendoriso-${tag}-${ts}@example.com`,
    password: 'Test1234x', role, legalConsentAccepted: true,
  });
  const a = await mk('a', 'vendor');
  const b = await mk('b', 'vendor');
  const buyer = await mk('buyer', 'customer');
  Object.assign(state, { vendorA: a.id, vendorB: b.id, buyer: buyer.id });

  const mkProd = async (vendorId, tag) => {
    const [r] = await pool.execute(
      `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'approved')`,
      [`VISO ${ts} ${tag}`, '/uploads/test.png', 100.0, 'test', 10, vendorId]
    );
    return r.insertId;
  };
  state.prodA = await mkProd(a.id, 'A');
  state.prodB = await mkProd(b.id, 'B');

  const mkOrder = async (items, tag) => {
    const [r] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
        paymentMethod, paymentStatus, orderStatus, shippingCost, tax, discount, paymentReference, escrowStatus)
       VALUES (?, ?, ?, ?, ?, ?, 'paystack', 'pending', 'processing', 15, 30, 0, ?, 'held')`,
      [buyer.id, `VISO-${ts}-${tag}`, JSON.stringify(items), 245,
       JSON.stringify({ city: 'Accra', phone: '024', deliveryMethod: 'door' }),
       JSON.stringify({ city: 'Accra' }), `VISOREF-${ts}-${tag}`]
    );
    return r.insertId;
  };
  const line = (pid, vendorId) => ({
    product: pid, name: `item-${pid}`, qty: 1, price: 100, image: '/uploads/test.png', vendorId, reserved: 1,
  });
  state.multiOrder = await mkOrder([line(state.prodA, a.id), line(state.prodB, b.id)], 'MULTI');
  state.singleOrder = await mkOrder([line(state.prodA, a.id)], 'SINGLE');
});

after(async () => {
  if (!dbAvailable || !pool) return;
  try {
    await pool.execute(`DELETE FROM orders WHERE orderNumber LIKE 'VISO-${ts}-%'`);
    await pool.execute(`DELETE FROM product WHERE id IN (?, ?)`, [state.prodA, state.prodB]);
    await pool.execute(`DELETE FROM users WHERE id IN (?, ?, ?)`, [state.vendorA, state.vendorB, state.buyer]);
  } finally {
    await pool.end();
  }
});

const listAs = async (vendorId) => {
  const { getVendorOrders } = await import('../controllers/vendorOrderController.js');
  const { res, get } = mockRes();
  await getVendorOrders({ user: { id: vendorId, role: 'vendor' } }, res);
  return get();
};

const markAs = async (vendorId, orderId, orderStatus) => {
  const { updateVendorOrderStatus } = await import('../controllers/vendorOrderController.js');
  const { res, get } = mockRes();
  await updateVendorOrderStatus(
    { params: { id: String(orderId) }, body: { orderStatus }, user: { id: vendorId, role: 'vendor' } },
    res
  );
  return get();
};

const dbOrder = async (id) => {
  const Order = (await import('../models/orderModel.js')).default;
  return Order.findById(id);
};

describe('P0-2 vendor order projection', () => {
  test('Vendor A sees only own lines, no sibling data or buyer PII', { skip: !dbAvailable }, async () => {
    const { status, body } = await listAs(state.vendorA);
    assert.equal(status, 200);
    const multi = body.find((o) => o.id === state.multiOrder);
    assert.ok(multi, 'multi-vendor order listed');
    assert.equal(multi.items.length, 1, 'only own line projected');
    assert.equal(multi.items[0].product, state.prodA);
    assert.equal(multi.ownSubtotal, 100);
    for (const banned of ['email', 'lastName', 'totalAmount', 'paymentReference', 'billingAddress', 'shippingAddress', 'userId', 'couponId', 'notes']) {
      assert.ok(!(banned in multi), `banned key shipped: ${banned}`);
    }
    assert.equal(multi.firstName, 'Vend');
    assert.equal(multi.shipping.city, 'Accra', 'minimal fulfilment routing kept');
    assert.equal(multi.myStatus, 'processing');
  });

  test('Vendor B sees the mirror image (own line only)', { skip: !dbAvailable }, async () => {
    const { body } = await listAs(state.vendorB);
    const multi = body.find((o) => o.id === state.multiOrder);
    assert.equal(multi.items.length, 1);
    assert.equal(multi.items[0].product, state.prodB);
    const single = body.find((o) => o.id === state.singleOrder);
    assert.equal(single, undefined, 'single-vendor A order invisible to B');
  });
});

describe('P0-3 consensus fulfilment', () => {
  // Helper to advance a vendor through the pipeline step by step
  const advanceVendor = async (vendorId, orderId, targetStatus) => {
    const pipeline = ['processing', 'packaging', 'shipped', 'arrived', 'delivered'];
    const results = [];
    // Get current status from order_vendor_marks
    const [[mark]] = await pool.execute(
      `SELECT status FROM order_vendor_marks WHERE orderId = ? AND vendorId = ?`,
      [orderId, vendorId]
    );
    let currentStatus = mark?.status || 'processing';
    let currentIdx = pipeline.indexOf(currentStatus);
    const targetIdx = pipeline.indexOf(targetStatus);
    
    // Advance step by step
    for (let i = currentIdx + 1; i <= targetIdx; i++) {
      const nextStatus = pipeline[i];
      const r = await markAs(vendorId, orderId, nextStatus);
      results.push({ status: nextStatus, result: r });
      if (r.status !== 200) break;
    }
    return results;
  };

  test('A advancing alone does not move the shared order', { skip: !dbAvailable }, async () => {
    // Vendor A advances to 'shipped' step by step
    const results = await advanceVendor(state.vendorA, state.multiOrder, 'shipped');
    const last = results[results.length - 1].result;
    assert.equal(last.status, 200, JSON.stringify(last.body));
    assert.equal(last.body.myStatus, 'shipped');
    assert.equal(last.body.consensus, 'processing', 'B is still at processing');
    const row = await dbOrder(state.multiOrder);
    assert.equal(row.orderStatus, 'processing', 'global untouched by one vendor');
  });

  test('both vendors shipped advances the global order', { skip: !dbAvailable }, async () => {
    // Vendor B advances to 'shipped' step by step
    const results = await advanceVendor(state.vendorB, state.multiOrder, 'shipped');
    const last = results[results.length - 1].result;
    assert.equal(last.status, 200);
    assert.equal(last.body.consensus, 'shipped');
    const row = await dbOrder(state.multiOrder);
    assert.equal(row.orderStatus, 'shipped');
  });

  test('one vendor delivered does NOT arm escrow for the shared order', { skip: !dbAvailable }, async () => {
    // Vendor A advances to 'delivered' step by step
    const results = await advanceVendor(state.vendorA, state.multiOrder, 'delivered');
    const last = results[results.length - 1].result;
    assert.equal(last.status, 200);
    assert.equal(last.body.consensus, 'shipped', 'B has not delivered');
    const row = await dbOrder(state.multiOrder);
    assert.equal(row.orderStatus, 'shipped');
    assert.equal(row.escrowReleaseDeadline, null, 'escrow clock not armed by one vendor');
  });

  test('all delivered flips global + arms escrow deadline', { skip: !dbAvailable }, async () => {
    // Vendor B advances to 'delivered' step by step
    const results = await advanceVendor(state.vendorB, state.multiOrder, 'delivered');
    const last = results[results.length - 1].result;
    assert.equal(last.status, 200);
    assert.equal(last.body.consensus, 'delivered');
    const row = await dbOrder(state.multiOrder);
    assert.equal(row.orderStatus, 'delivered');
    assert.ok(row.escrowReleaseDeadline, 'deadline armed only on consensus');
    assert.ok(row.deliveredAt, 'deliveredAt stamped');
  });

  test('backward move against own mark rejected', { skip: !dbAvailable }, async () => {
    // Vendor A is at 'delivered', trying to go back to 'packaging' should fail
    const r = await markAs(state.vendorA, state.multiOrder, 'packaging');
    assert.equal(r.status, 400, 'cannot move own mark backwards');
  });

  test('single-vendor order flows through pipeline step by step', { skip: !dbAvailable }, async () => {
    // Single-vendor order must also advance through all stages
    const results = await advanceVendor(state.vendorA, state.singleOrder, 'delivered');
    const last = results[results.length - 1].result;
    assert.equal(last.status, 200, JSON.stringify(last.body));
    assert.equal(last.body.consensus, 'delivered');
    const row = await dbOrder(state.singleOrder);
    assert.equal(row.orderStatus, 'delivered');
  });

  test('forward skip (processing → delivered) is rejected', { skip: !dbAvailable }, async () => {
    // Create a fresh single-vendor order for this test with a proper item for vendorA
    const line = (pid, vendorId) => ({
      product: pid, name: `item-${pid}`, qty: 1, price: 100, image: '/uploads/test.png', vendorId, reserved: 1,
    });
    const [orderRow] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
       paymentMethod, paymentStatus, orderStatus, shippingCost, tax, discount, notes, paymentReference, couponId)
       VALUES (?, 'TEST-SKIP', ?, 100, '{}', '{}', 'card', 'paid', 'processing', 0, 0, 0, null, null, null)`,
      [state.buyer, JSON.stringify([line(state.prodA, state.vendorA)])]
    );
    const testOrderId = orderRow.insertId;
    await pool.execute(
      `INSERT INTO order_vendor_marks (orderId, vendorId, status) VALUES (?, ?, 'processing')`,
      [testOrderId, state.vendorA]
    );
    // vendor_order_fulfillment uses 'packaging' for processing orders (per migration backfill)
    await pool.execute(
      `INSERT INTO vendor_order_fulfillment (orderId, vendorId, status) VALUES (?, ?, 'packaging')`,
      [testOrderId, state.vendorA]
    );
    
    // Try to jump from processing to delivered - should be rejected
    const r = await markAs(state.vendorA, testOrderId, 'delivered');
    assert.equal(r.status, 400, 'forward skip should be rejected');
    assert.ok(r.body.message.includes('one stage at a time'));
    
    // Cleanup
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [testOrderId]);
  });
});
