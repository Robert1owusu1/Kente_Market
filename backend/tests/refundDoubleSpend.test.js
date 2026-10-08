// FILE LOCATION: backend/tests/refundDoubleSpend.test.js
// DESCRIPTION: V-07 — FUNCTIONAL proof that the three refund entry points
//   share one CAS claim, replacing the source assertion that only counted
//   `refundReference IS NULL` occurrences in the text.
//
//   The finding was that three paths could refund one order: the per-vendor
//   partial return, the full return, and an admin cancel. The fix is a single
//   order-level marker claimed with `WHERE refundReference IS NULL` before any
//   money moves. Counting that SQL in the source proves it is WRITTEN; it does
//   not prove the paths share it, that a loser actually stops, or that Paystack
//   is never reached on the losing side — which is the whole point, because
//   the losing side's call is a second refund of the same charge.
//
//   Each scenario gets its own order so no test depends on another's
//   side effects: a control proves the spy is live before (and separate from)
//   the refusal it is meant to observe. An empty call log on a path that was
//   never wired up would otherwise read exactly like "correctly refused".
//
//   DB-backed; cleans up after itself. Paystack is stubbed, never called.
import { test, describe, before, after, mock } from 'node:test';
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
const state = { orderIds: {}, returnIds: {} };
let refundCalls = [];

const call = async (fn, req) => {
  let status = 200;
  let payload = null;
  await fn(req, {
    status(c) { status = c; return this; },
    json(p) { payload = p; return this; },
  });
  return { status, payload };
};

describe('V-07: one order, one refund — across every entry point', { skip: !dbAvailable }, () => {
  before(async () => {
    if (!dbAvailable || !pool) return;

    const User = (await import('../models/usersModel.js')).default;
    const mkUser = (tag, role) => User.create({
      firstName: 'V07', lastName: tag, email: `v07-${tag}-${ts}@example.com`,
      password: 'Test1234x', role, legalConsentAccepted: true,
    });
    state.buyer = (await mkUser('buyer', 'customer')).id;
    state.vendor = (await mkUser('vendor', 'vendor')).id;

    // Four orders, one per scenario. Each is a realistic paid order with a
    // paymentReference — without one no path reaches the claim at all.
    const mkOrder = async (tag) => {
      const [r] = await pool.execute(
        `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
          paymentMethod, paymentStatus, orderStatus, paymentReference, escrowStatus)
         VALUES (?, ?, ?, 300, '{}', '{}', 'paystack', 'paid', 'processing', ?, 'held')`,
        [state.buyer, `V07-${ts}-${tag}`,
          JSON.stringify([{ product: 1, qty: 1, price: 300, vendorId: state.vendor }]),
          `V07REF-${ts}-${tag}`]
      );
      return r.insertId;
    };

    state.orderIds.cancelClaimed = await mkOrder('CXC');
    state.orderIds.cancelControl = await mkOrder('CXC0');
    state.orderIds.returnClaimed = await mkOrder('RTC');
    state.orderIds.returnControl = await mkOrder('RTC0');
    state.orderIds.partialClaimed = await mkOrder('PXC');

    const ReturnRequest = (await import('../models/returnModel.js')).default;
    const mkReturn = async (orderId, tag) => {
      const rr = await ReturnRequest.create({ orderId, userId: state.buyer, reason: 'damaged', description: tag });
      return rr.id ?? rr.insertId;
    };
    state.returnIds.cancel = await mkReturn(state.orderIds.cancelClaimed, 'v07-cancel');
    state.returnIds.claimed = await mkReturn(state.orderIds.returnClaimed, 'v07-claimed');
    state.returnIds.control = await mkReturn(state.orderIds.returnControl, 'v07-control');
    state.returnIds.partial = await mkReturn(state.orderIds.partialClaimed, 'v07-partial');

    // Stub the provider once for the whole suite. The log is the assertion:
    // a refusal that still reached Paystack is a double refund, which is the
    // finding — not an inconvenience.
    refundCalls = [];
    const paystack = (await import('../Services/paystackservices.js')).default;
    mock.method(paystack, 'refundTransaction', async (...args) => {
      refundCalls.push(args);
      return { status: true, data: {} };
    });
  });

  after(async () => {
    if (!dbAvailable || !pool) return;
    mock.restoreAll();
    const cleanup = async (label, sql, params) => {
      try {
        await pool.execute(sql, params);
      } catch (err) {
        console.error(`refundDoubleSpend cleanup [${label}] FAILED: ${err.message}`);
      }
    };
    const oids = Object.values(state.orderIds).filter(Boolean);
    const rids = Object.values(state.returnIds).filter(Boolean);
    if (oids.length) {
      const holes = oids.map(() => '?').join(', ');
      await cleanup('financial_events', `DELETE FROM financial_events WHERE orderId IN (${holes})`, oids);
      await cleanup('escrow', `DELETE FROM escrow_allocations WHERE orderId IN (${holes})`, oids);
      if (rids.length) {
        // Each id set gets ITS OWN placeholders. Binding return ids against
        // order-id holes (as the first draft did) throws on the count
        // mismatch — and because every DELETE shared one fate, that single
        // failure stranded all five orders in `paid + refundReference`, the
        // exact state reconcileRefundedButPaid scans for, which is how this
        // suite once failed a DIFFERENT suite's idempotency assertion.
        await cleanup('return_requests', `DELETE FROM return_requests WHERE id IN (${rids.map(() => '?').join(', ')})`, rids);
      }
      await cleanup('orders', `DELETE FROM orders WHERE id IN (${holes})`, oids);
    }
    if (state.buyer) {
      await cleanup('users', 'DELETE FROM users WHERE id IN (?, ?)', [state.buyer, state.vendor]);
    }
    // A stranded `paid + refundReference` row is not inert: it is the reconciler's
    // input, and any row left here will later read as a genuine stuck refund.
    // Verify the delete landed rather than assuming it did.
    try {
      const [[left]] = await pool.execute(
        `SELECT COUNT(*) AS n FROM orders WHERE orderNumber LIKE ?`, [`V07-${ts}-%`]
      );
      if (Number(left.n) > 0) {
        console.error(`refundDoubleSpend: ${left.n} fixture order(s) survived cleanup — reconciler-visible rows may follow`);
        await pool.execute(`DELETE FROM orders WHERE orderNumber LIKE ?`, [`V07-${ts}-%`]);
      }
    } catch (err) {
      console.error(`refundDoubleSpend cleanup verification FAILED: ${err.message}`);
    }
    try {
      await pool.end();
    } catch {
      /* suite owns the pool */
    }
  });

  const markerOf = async (orderId) => {
    const [[row]] = await pool.execute('SELECT refundReference, paymentStatus FROM orders WHERE id = ?', [orderId]);
    return row;
  };

  test('cancelOrder refuses an order the RETURN path already claimed', { skip: !dbAvailable }, async () => {
    const orderId = state.orderIds.cancelClaimed;
    // Written in the partial-return format — the claim is shared precisely
    // because neither path recognises the other's wording, only the marker.
    const foreign = `refund:${orderId}:partial:${state.vendor}:${state.returnIds.cancel}`;
    await pool.execute('UPDATE orders SET refundReference = ? WHERE id = ?', [foreign, orderId]);
    refundCalls = [];

    const { cancelOrder } = await import('../controllers/orderController.js');
    const r = await call(cancelOrder, { params: { id: String(orderId) } });

    assert.equal(r.status, 409, JSON.stringify(r.payload));
    assert.match(r.payload.message, /already claimed/i);
    assert.equal(refundCalls.length, 0, 'the losing path must never reach Paystack');

    const after = await markerOf(orderId);
    assert.equal(after.refundReference, foreign, 'the first claimant keeps the marker');
    assert.equal(after.paymentStatus, 'paid', 'an unrefunded order must stay paid');
  });

  test('control: the same path DOES reach Paystack when nobody has claimed', { skip: !dbAvailable }, async () => {
    const orderId = state.orderIds.cancelControl;
    refundCalls = [];

    const { cancelOrder } = await import('../controllers/orderController.js');
    const r = await call(cancelOrder, { params: { id: String(orderId) } });

    assert.equal(r.status, 200, JSON.stringify(r.payload));
    assert.equal(refundCalls.length, 1, 'the provider must be called exactly once — the spy is live');
    assert.equal(refundCalls[0][0], `V07REF-${ts}-CXC0`, 'refund goes against this order\'s own reference');

    const after = await markerOf(orderId);
    assert.equal(after.paymentStatus, 'refunded', 'money actually moved, so the books flip');
    assert.ok(after.refundReference, 'the winner leaves a marker for everyone else');
  });

  test('updateReturnStatus refuses an order the CANCEL path already claimed', { skip: !dbAvailable }, async () => {
    const orderId = state.orderIds.returnClaimed;
    const foreign = `refund:${orderId}:cancel:V07REF-${ts}-RTC`;
    await pool.execute('UPDATE orders SET refundReference = ? WHERE id = ?', [foreign, orderId]);
    refundCalls = [];

    const { updateReturnStatus } = await import('../controllers/returnController.js');
    const r = await call(updateReturnStatus, {
      params: { id: String(state.returnIds.claimed) },
      body: { status: 'approved' },
      user: { id: 1, role: 'admin' },
    });

    assert.equal(r.status, 409, JSON.stringify(r.payload));
    assert.match(r.payload.message, /already claimed/i);
    assert.equal(refundCalls.length, 0, 'the losing path must never reach Paystack');

    const after = await markerOf(orderId);
    assert.equal(after.refundReference, foreign, 'the cancel path keeps the marker');
    assert.equal(after.paymentStatus, 'paid', 'no second refund, no status flip');
  });

  test('control: the return path DOES reach Paystack when nobody has claimed', { skip: !dbAvailable }, async () => {
    const orderId = state.orderIds.returnControl;
    refundCalls = [];

    const { updateReturnStatus } = await import('../controllers/returnController.js');
    const r = await call(updateReturnStatus, {
      params: { id: String(state.returnIds.control) },
      body: { status: 'approved' },
      user: { id: 1, role: 'admin' },
    });

    assert.equal(r.status, 200, JSON.stringify(r.payload));
    assert.equal(refundCalls.length, 1, 'the provider must be called exactly once — the spy is live');
    assert.equal(refundCalls[0][0], `V07REF-${ts}-RTC0`, 'refund goes against this order\'s own reference');

    const after = await markerOf(orderId);
    assert.equal(after.paymentStatus, 'refunded');
    assert.ok(after.refundReference, 'the winner leaves a marker for everyone else');
  });

  test('the per-vendor PARTIAL path also refuses an already-claimed order', { skip: !dbAvailable }, async () => {
    // The third claim site. Two refusal tests prove two paths; this one shared
    // NOTHING with them but the SQL text — and it carried the same dead
    // comparison, which is why all three sites are driven rather than sampled.
    const orderId = state.orderIds.partialClaimed;
    const marker = `refund:${orderId}:cancel:V07REF-${ts}-PXC`;
    await pool.execute('UPDATE orders SET refundReference = ? WHERE id = ?', [marker, orderId]);
    refundCalls = [];

    const { updateReturnStatus } = await import('../controllers/returnController.js');
    const r = await call(updateReturnStatus, {
      params: { id: String(state.returnIds.partial) },
      body: { status: 'approved', vendorId: state.vendor, amount: 300 },
      user: { id: 1, role: 'admin' },
    });

    assert.equal(r.status, 409, JSON.stringify(r.payload));
    assert.match(r.payload.message, /already claimed/i);
    assert.equal(refundCalls.length, 0, 'the losing path must never reach Paystack');

    const after = await markerOf(orderId);
    assert.equal(after.refundReference, marker, 'the first claimant keeps the marker');
    assert.equal(after.paymentStatus, 'paid', 'no partial refund, no status flip');
  });

  // Deliberately absent: a "both formats block both paths" sweep. Each path
  // is already refused by the OTHER path's marker above (the pairing is
  // symmetric), and the return request is a one-way pending->approved door —
  // a second sweep would reach it already consumed, skip the claim entirely,
  // and pass on an assertion that never exercised a CAS. A green test that
  // cannot fail is worse than no test.
});
