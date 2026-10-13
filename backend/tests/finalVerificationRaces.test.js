// FILE LOCATION: backend/tests/finalVerificationRaces.test.js
// DESCRIPTION: Regression tests for defects found in the independent final
// verification (2026-10-12). Each one survived the earlier suites because it
// lives in an interleaving or an input the existing fixtures never produce.
//
//   FV-1  Webhook paid-flip without amount validation. The webhook validated
//         the charge amount in a SELECT, then flipped with an UPDATE keyed
//         only by paymentReference. When the SELECT found no order yet (the
//         normal case: the storefront PUTs the reference after the charge),
//         validation was skipped, and an order that received the reference
//         between the two statements was flipped to paid for ANY amount.
//   FV-2  cancelOrder wrote back a stale paymentStatus. It read the order,
//         decided "unpaid, no refund needed", and then wrote
//         `paymentStatus = <value it read>` guarded only on orderStatus. A
//         payment confirmed in between was overwritten to 'pending' and the
//         order cancelled: customer charged, no refund issued, escrow voided.
//   FV-3  Per-vendor partial refunds refunded the vendor's GROSS line value,
//         while escrow apportions the order discount pro rata. On a
//         discounted order the customer got back more than they paid for
//         those lines.
//
// Interleavings are reproduced deterministically (wrapped connection / stale
// snapshot), against the real handlers and a real database. Paystack is
// stubbed; no request can reach the provider.
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.EMAIL_DISABLED = '1';
process.env.REDIS_URL = '';
process.env.JWT_SECRET ||= 'final-verification-secret-for-tests-only';
process.env.PAYSTACK_SECRET_KEY ||= 'sk_test_final_verification_for_tests_only';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

const TS = Date.now();
const fx = { users: [], orders: [], products: [], returns: [] };

const mockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};

const mkUser = async (tag, role = 'customer') => {
  const [r] = await pool.execute(
    `INSERT INTO users (email, password, firstName, lastName, role, is_email_verified)
     VALUES (?, 'x', 'FV', ?, ?, 1)`,
    [`fv-${tag}-${TS}@example.com`, tag, role]
  );
  fx.users.push(r.insertId);
  return r.insertId;
};

const mkOrder = async ({ userId, tag, total, paymentStatus = 'pending', orderStatus = 'pending', reference = null, items = '[]', discount = 0, extra = {} }) => {
  const [r] = await pool.execute(
    `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
       paymentMethod, paymentStatus, orderStatus, paymentReference, discount, shippingCost, tax, escrowStatus)
     VALUES (?, ?, ?, ?, '{}', '{}', 'paystack', ?, ?, ?, ?, ?, ?, ?)`,
    [userId, `FV-${tag}-${TS}`, items, total, paymentStatus, orderStatus, reference, discount,
      extra.shippingCost ?? 0, extra.tax ?? 0, extra.escrowStatus ?? 'none']
  );
  fx.orders.push(r.insertId);
  return r.insertId;
};

describe('final verification regressions', { skip: !dbAvailable }, () => {
  let server = null;
  let baseUrl = null;

  before(async () => {
    const express = (await import('express')).default;
    const paymentRoutes = (await import('../routes/paymentRoutes.js')).default;
    const { startServer } = await import('./helpers/httpHarness.js');
    const app = express();
    app.use(express.json({ verify: (req, res, buf) => { req.rawBody = Buffer.from(buf); } }));
    app.use('/api/payments', paymentRoutes);
    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  after(async () => {
    mock.restoreAll();
    if (server) await server.close();
    if (!dbAvailable) return;
    const del = async (sql, params) => { try { await pool.execute(sql, params); } catch (e) { console.error(`finalVerificationRaces cleanup: ${e.message}`); } };
    for (const id of fx.orders) {
      await del(`DELETE FROM webhook_events WHERE reference IN (SELECT paymentReference FROM orders WHERE id = ?)`, [id]);
      await del(`DELETE FROM financial_events WHERE orderId = ?`, [id]);
      await del(`DELETE FROM escrow_allocations WHERE orderId = ?`, [id]);
      await del(`DELETE FROM platform_revenue WHERE orderId = ?`, [id]);
      await del(`DELETE FROM stock_moves WHERE orderId = ?`, [id]);
      await del(`DELETE FROM return_requests WHERE orderId = ?`, [id]);
      await del(`DELETE FROM orders WHERE id = ?`, [id]);
    }
    for (const id of fx.products) await del(`DELETE FROM product WHERE id = ?`, [id]);
    for (const id of fx.users) await del(`DELETE FROM users WHERE id = ?`, [id]);
    await pool.end();
  });

  test('FV-1: a reference bound between the webhook\'s validation and its flip is not paid for the wrong amount', async () => {
    const buyer = await mkUser('fv1');
    // The expensive order the attacker wants marked paid. No reference yet.
    const orderId = await mkOrder({ userId: buyer, tag: 'FV1', total: 1000 });
    const reference = `FV1-REF-${TS}`;
    // A real, signed delivery for a 1 GHS charge (100 pesewas).
    const rawBody = JSON.stringify({ event: 'charge.success', data: { reference, amount: 100, currency: 'GHS', status: 'success' } });
    const signature = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');

    // Interleave deterministically: right after the webhook's pre-validation
    // SELECT runs (and finds nothing), the owner binds the reference to the
    // 1000 GHS order — exactly what PUT /api/orders/:id does after checkout.
    const realGetConnection = pool.getConnection.bind(pool);
    let bound = false;
    mock.method(pool, 'getConnection', async () => {
      const conn = await realGetConnection();
      return new Proxy(conn, {
        get(target, prop) {
          if (prop === 'execute') {
            return async (sql, params) => {
              const out = await target.execute(sql, params);
              if (!bound && /SELECT id, totalAmount, paymentStatus FROM orders WHERE paymentReference/.test(sql)) {
                bound = true;
                await pool.execute(`UPDATE orders SET paymentReference = ? WHERE id = ?`, [reference, orderId]);
              }
              return out;
            };
          }
          const v = target[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    });
    let status;
    try {
      const res = await fetch(`${baseUrl}/api/payments/paystack-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature },
        body: rawBody,
      });
      status = res.status;
      await res.text();
    } finally {
      pool.getConnection.mock.restore();
    }
    assert.ok(bound, 'the interleaving was exercised');
    const [[row]] = await pool.execute(`SELECT paymentStatus, orderStatus FROM orders WHERE id = ?`, [orderId]);
    assert.equal(row.paymentStatus, 'pending', `a 1 GHS charge must never pay a 1000 GHS order (webhook answered ${status})`);
    assert.notEqual(status, 200, 'the delivery must not be acknowledged as processed');
  });

  test('FV-1: a CANCELLED order bound in the same window is not refunded or journaled on an unvalidated charge', async () => {
    const buyer = await mkUser('fv1t');
    const orderId = await mkOrder({ userId: buyer, tag: 'FV1T', total: 1000, orderStatus: 'cancelled' });
    const reference = `FV1T-REF-${TS}`;
    const rawBody = JSON.stringify({ event: 'charge.success', data: { reference, amount: 100, currency: 'GHS', status: 'success' } });
    const signature = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
    const paystack = (await import('../Services/paystackservices.js')).default;
    const refundCalls = [];
    mock.method(paystack, 'refundTransaction', async (...args) => { refundCalls.push(args); return { status: true, data: {} }; });
    const realGetConnection = pool.getConnection.bind(pool);
    let bound = false;
    mock.method(pool, 'getConnection', async () => {
      const conn = await realGetConnection();
      return new Proxy(conn, {
        get(target, prop) {
          if (prop === 'execute') {
            return async (sql, params) => {
              const out = await target.execute(sql, params);
              if (!bound && /SELECT id, totalAmount, paymentStatus FROM orders WHERE paymentReference/.test(sql)) {
                bound = true;
                await pool.execute(`UPDATE orders SET paymentReference = ? WHERE id = ?`, [reference, orderId]);
              }
              return out;
            };
          }
          const v = target[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    });
    try {
      const res = await fetch(`${baseUrl}/api/payments/paystack-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature },
        body: rawBody,
      });
      await res.text();
      assert.equal(res.status, 400, 'the mismatched charge is rejected once it is validated');
    } finally {
      pool.getConnection.mock.restore();
      paystack.refundTransaction.mock.restore();
    }
    assert.ok(bound, 'the interleaving was exercised');
    assert.equal(refundCalls.length, 0, 'no refund was pushed for an unvalidated charge');
    const [[j]] = await pool.execute(`SELECT COUNT(*) AS n FROM financial_events WHERE orderId = ?`, [orderId]);
    assert.equal(Number(j.n), 0, 'no charge/refund was journaled at the order total');
  });

  test('FV-1: the matching charge still flips the order exactly once', async () => {
    const buyer = await mkUser('fv1ok');
    const reference = `FV1OK-REF-${TS}`;
    const orderId = await mkOrder({ userId: buyer, tag: 'FV1OK', total: 25, reference });
    const rawBody = JSON.stringify({ event: 'charge.success', data: { reference, amount: 2500, currency: 'GHS', status: 'success' } });
    const signature = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
    const res = await fetch(`${baseUrl}/api/payments/paystack-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature },
      body: rawBody,
    });
    assert.equal(res.status, 200, await res.text());
    const [[row]] = await pool.execute(`SELECT paymentStatus, orderStatus FROM orders WHERE id = ?`, [orderId]);
    assert.equal(row.paymentStatus, 'paid');
    assert.equal(row.orderStatus, 'processing');
  });

  test('FV-2: a payment confirmed while an admin cancels is not overwritten to pending', async () => {
    const buyer = await mkUser('fv2');
    // In the database the order is already PAID (the webhook won)...
    const orderId = await mkOrder({ userId: buyer, tag: 'FV2', total: 80, paymentStatus: 'paid', orderStatus: 'processing', reference: `FV2-REF-${TS}` });
    const { cancelOrder } = await import('../controllers/orderController.js');
    const Order = (await import('../models/orderModel.js')).default;
    const paystack = (await import('../Services/paystackservices.js')).default;
    const refundCalls = [];
    mock.method(paystack, 'refundTransaction', async (...args) => { refundCalls.push(args); return { status: true, data: {} }; });
    // ...but the handler's read happened just before it: a pending snapshot.
    const realFindById = Order.findById;
    let calls = 0;
    Order.findById = async (id) => {
      calls += 1;
      const row = await realFindById.call(Order, id);
      return calls === 1 && row ? Object.assign(row, { paymentStatus: 'pending' }) : row;
    };
    const res = mockRes();
    try {
      await cancelOrder({ params: { id: String(orderId) }, user: { id: 1, role: 'admin', email: 'a@test.local' }, headers: {}, ip: '127.0.0.1' }, res);
    } finally {
      Order.findById = realFindById;
      paystack.refundTransaction.mock.restore();
    }
    const [[row]] = await pool.execute(`SELECT paymentStatus, orderStatus FROM orders WHERE id = ?`, [orderId]);
    // Either outcome is money-safe: left paid (admin retries and the paid
    // branch refunds), or cancelled WITH a refund. Cancelled + not refunded
    // + no refund call is the defect.
    const leftPaid = row.paymentStatus === 'paid' && row.orderStatus === 'processing';
    const cancelledAndRefunded = row.orderStatus === 'cancelled' && row.paymentStatus === 'refunded' && refundCalls.length === 1;
    assert.ok(leftPaid || cancelledAndRefunded,
      `paid order ended ${row.orderStatus}/${row.paymentStatus} with ${refundCalls.length} refund call(s); response ${res.statusCode} ${JSON.stringify(res.body)}`);
    if (leftPaid) assert.equal(res.statusCode, 409, 'the admin is told the state changed');
  });

  test('FV-4: already-reported unmatched receipts cannot starve a newer receipt out of the reconciler', async () => {
    const paystack = (await import('../Services/paystackservices.js')).default;
    mock.method(paystack, 'verifyTransaction', async (ref) => ({ status: true, data: { status: 'success', reference: ref, amount: 100, currency: 'GHS', id: 1 } }));
    const stale = [];
    try {
      // 25 receipts reported long ago (no order will ever appear for them).
      for (let i = 0; i < 25; i += 1) {
        const ref = `FV4-OLD-${i}-${TS}`;
        stale.push(ref);
        await pool.execute(
          `INSERT INTO webhook_events (event, reference, payload, processing_status, last_error, processed_at)
           VALUES ('charge.success', ?, NULL, 'failed', 'unmatched-charge: verified success 100 GHS; no order bound; operator review required',
                   DATE_SUB(NOW(), INTERVAL 30 DAY))`,
          [ref]
        );
      }
      // A newer receipt whose order has since appeared and been paid.
      const buyer = await mkUser('fv4');
      const ref = `FV4-NEW-${TS}`;
      const orderId = await mkOrder({ userId: buyer, tag: 'FV4', total: 1, paymentStatus: 'paid', orderStatus: 'processing', reference: ref });
      await pool.execute(
        `INSERT INTO webhook_events (event, reference, payload, processing_status, last_error, processed_at)
         VALUES ('charge.success', ?, NULL, 'failed', 'Order was not found after retry window', DATE_SUB(NOW(), INTERVAL 1 DAY))`,
        [ref]
      );
      const { reconcileUnmatchedCharges } = await import('../Services/paymentReconciliationService.js');
      await reconcileUnmatchedCharges();
      const [[row]] = await pool.execute(
        `SELECT last_error FROM webhook_events WHERE event = 'charge.success' AND reference = ?`, [ref]
      );
      assert.match(String(row.last_error), new RegExp(`order #${orderId} bound and paid`),
        `the newer receipt was never examined: ${row.last_error}`);
    } finally {
      paystack.verifyTransaction.mock.restore();
      for (const ref of stale) {
        await pool.execute(`DELETE FROM webhook_events WHERE reference = ?`, [ref]).catch(() => {});
      }
    }
  });

  test('FV-11: a checkout rejected for its coupon hands the reserved stock back', async () => {
    const buyer = await mkUser('fv11');
    const vendor = await mkUser('fv11v', 'vendor');
    await pool.execute(
      `INSERT INTO vendors (userId, businessName, status) VALUES (?, ?, 'approved')`,
      [vendor, `FV11 ${TS}`]
    );
    const [p] = await pool.execute(
      `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
       VALUES (?, '/uploads/test.png', 50, 'test', 5, ?, 0, 'approved')`,
      [`FV11 ${TS}`, vendor]
    );
    fx.products.push(p.insertId);
    // A capped coupon that is already spent, plus a code that does not exist.
    const code = `FV11SPENT${TS}`.slice(0, 20);
    await pool.execute(
      `INSERT INTO coupons (code, discountType, discountValue, maxUses, usesUsed, isActive)
       VALUES (?, 'percentage', 10, 1, 1, 1)`,
      [code]
    );
    const { addOrderItems } = await import('../controllers/orderController.js');
    try {
      for (const couponCode of ['NO-SUCH-COUPON', code]) {
        const res = mockRes();
        await addOrderItems({
          user: { id: buyer, role: 'customer' },
          body: { items: [{ product: p.insertId, qty: 3 }], couponCode, shippingAddress: { country: 'GH', city: 'Accra' } },
          headers: {}, ip: '127.0.0.1',
        }, res);
        assert.equal(res.statusCode, 400, `${couponCode}: ${JSON.stringify(res.body)}`);
        const [[row]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [p.insertId]);
        assert.equal(Number(row.stock), 5, `${couponCode}: a rejected checkout must not keep 3 units reserved forever`);
      }
    } finally {
      await pool.execute(`DELETE FROM coupons WHERE code = ?`, [code]).catch(() => {});
      await pool.execute(`DELETE FROM stock_moves WHERE productId = ?`, [p.insertId]).catch(() => {});
      await pool.execute(`DELETE FROM vendors WHERE userId = ?`, [vendor]).catch(() => {});
    }
  });

  test('FV-12: concurrent stock restores/decrements cannot exhaust the pool and lose ledger rows', async () => {
    const vendor = await mkUser('fv12v', 'vendor');
    const [p] = await pool.execute(
      `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
       VALUES (?, '/uploads/test.png', 10, 'test', 100, ?, 0, 'approved')`,
      [`FV12 ${TS}`, vendor]
    );
    fx.products.push(p.insertId);
    const { restoreStockForOrder, decrementStockForOrder } = await import('../controllers/orderController.js');
    // More concurrent calls than the pool has connections (DB_POOL_SIZE, default 10).
    const N = 12;
    const started = Date.now();
    try {
      await Promise.all(Array.from({ length: N }, () =>
        restoreStockForOrder([{ product: p.insertId, qty: 1 }], { reason: 'create-rollback' })));
      await Promise.all(Array.from({ length: N }, () =>
        decrementStockForOrder([{ product: p.insertId, qty: 1 }])));
      const elapsed = Date.now() - started;
      const [[row]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [p.insertId]);
      assert.equal(Number(row.stock), 100, 'every restore and decrement applied');
      const [[moves]] = await pool.execute(
        `SELECT SUM(reason = 'create-rollback') AS r, SUM(reason = 'sale') AS s FROM stock_moves WHERE productId = ?`, [p.insertId]
      );
      assert.equal(Number(moves.r), N, 'one ledger row per restore');
      assert.equal(Number(moves.s), N, 'one sale ledger row per decrement (recovery relies on it)');
      assert.ok(elapsed < 8000, `no pool-exhaustion stall (took ${elapsed} ms)`);
    } finally {
      await pool.execute(`DELETE FROM stock_moves WHERE productId = ?`, [p.insertId]).catch(() => {});
    }
  });

  test('FV-3: a partial refund on a discounted order refunds the discounted share, not the gross lines', async () => {
    const buyer = await mkUser('fv3');
    const vA = await mkUser('fv3a', 'vendor');
    const vB = await mkUser('fv3b', 'vendor');
    const mkProd = async (vendorId, tag) => {
      const [r] = await pool.execute(
        `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
         VALUES (?, '/uploads/test.png', 100, 'test', 10, ?, 0, 'approved')`,
        [`FV3 ${TS} ${tag}`, vendorId]
      );
      fx.products.push(r.insertId);
      return r.insertId;
    };
    const pA = await mkProd(vA, 'A');
    const pB = await mkProd(vB, 'B');
    // Gross 300 (A 2x100, B 1x100), coupon 60 off -> 20% off every line.
    // Customer paid 300 - 60 + 15 shipping + 45 tax = 300.
    const items = JSON.stringify([
      { product: pA, name: 'a', qty: 2, price: 100, vendorId: vA },
      { product: pB, name: 'b', qty: 1, price: 100, vendorId: vB },
    ]);
    const orderId = await mkOrder({
      userId: buyer, tag: 'FV3', total: 300, paymentStatus: 'paid', orderStatus: 'processing',
      reference: `FV3-REF-${TS}`, items, discount: 60, extra: { shippingCost: 15, tax: 45, escrowStatus: 'held' },
    });
    // Escrow as createEscrowAllocations books it: A gets 200 x 0.8 = 160.
    for (const [vid, amt] of [[vA, 160], [vB, 80]]) {
      await pool.execute(
        `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status)
         VALUES (?, ?, ?, 0.1, ?, ?, 'held')`,
        [orderId, vid, amt, amt * 0.1, amt * 0.9]
      );
    }
    const ReturnRequest = (await import('../models/returnModel.js')).default;
    await ReturnRequest.create({ orderId, userId: buyer, reason: 'damaged', description: 'fv3' });
    const [[rr]] = await pool.execute(`SELECT id FROM return_requests WHERE orderId = ?`, [orderId]);

    const paystack = (await import('../Services/paystackservices.js')).default;
    const refundCalls = [];
    mock.method(paystack, 'refundTransaction', async (ref, amount) => { refundCalls.push(amount); return { status: true, data: {} }; });
    const { updateReturnStatus } = await import('../controllers/returnController.js');
    const approve = async (amount) => {
      const res = mockRes();
      await updateReturnStatus({ params: { id: String(rr.id) }, body: { status: 'approved', vendorId: vA, amount }, user: { id: 1, role: 'admin' } }, res);
      return res;
    };
    try {
      // The gross line value (200) is more than the customer paid for A's lines.
      const gross = await approve(200);
      assert.equal(gross.statusCode, 400, `gross amount must be refused: ${JSON.stringify(gross.body)}`);
      assert.equal(refundCalls.length, 0, 'no provider refund for the refused amount');
      const net = await approve(160);
      assert.equal(net.statusCode, 200, JSON.stringify(net.body));
      assert.deepEqual(refundCalls, [160], 'exactly the discounted share is refunded');
    } finally {
      paystack.refundTransaction.mock.restore();
    }
    const [[o]] = await pool.execute(`SELECT refundedAmount, paymentStatus FROM orders WHERE id = ?`, [orderId]);
    assert.equal(Number(o.refundedAmount), 160);
    assert.equal(o.paymentStatus, 'paid');
  });
});

// FV-5 (no database): every Paystack client call is bounded. axios has no
// default timeout, so one hung provider connection held a checkout, refund or
// scheduled money job (and its distributed lock) indefinitely.
test('FV-5: every PaystackService call sets a timeout', async () => {
  const { default: axios } = await import('axios');
  const paystack = (await import('../Services/paystackservices.js')).default;
  const seen = [];
  const capture = (name) => async (url, a, b) => {
    seen.push({ name, url, config: name === 'get' ? a : b });
    return { data: { status: true, data: {} } };
  };
  mock.method(axios, 'get', capture('get'));
  mock.method(axios, 'post', capture('post'));
  try {
    await paystack.initializeTransaction('a@example.com', 1, {});
    await paystack.verifyTransaction('REF_1');
    await paystack.chargeAuthorization('AUTH_x', 'a@example.com', 1);
    await paystack.listTransactions();
    await paystack.createTransferRecipient('ghipss', 'n', '0000000000', '000');
    await paystack.initiateTransfer(1, 'RCP_x', 'r', 'kente_tr_1_x');
    await paystack.getBankList();
    await paystack.getMobileMoneyTelcos();
    await paystack.createMomoRecipient('n', '0240000000', 'MTN');
    await paystack.resolveAccountNumber('0000000000', '000');
    await paystack.fetchTransaction(1);
    await paystack.refundTransaction('REF_1', 1, 'r');
    await paystack.listRefunds('1');
  } finally {
    axios.get.mock.restore();
    axios.post.mock.restore();
  }
  assert.equal(seen.length, 13, 'all 13 client methods reached axios');
  for (const call of seen) {
    assert.ok(Number(call.config?.timeout) > 0, `${call.name} ${call.url} has no timeout`);
  }
});
