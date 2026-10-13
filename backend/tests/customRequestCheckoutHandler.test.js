// FILE LOCATION: backend/tests/customRequestCheckoutHandler.test.js
// DESCRIPTION: Drives the REAL checkoutRequest handler (customRequestCheckout.test.js
//              re-implements its SQL by hand and never calls it). Pins:
//              - C-1: the order transaction used `paymentMethod` outside the block
//                that declared it, so every custom checkout threw ReferenceError
//                AFTER Paystack had verified the charge — customer charged, no order.
//              - C-2: the customer's delivery address must be persisted on the order
//                (the rewrite stored `{}`; HEAD stored the address).
//              Paystack is stubbed on the service instance; no network is used.
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
}

const TS = Date.now();
const fx = { customer: null, other: null, vendor: null, product: null, requests: [], refs: [] };
/** @type {Map<string, any>} */
const verifyStub = new Map();
let checkoutRequest;
let paystack;
let origVerify;

const mockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};

const mkUser = async (role, tag) => {
  const [r] = await pool.execute(
    `INSERT INTO users (email, password, firstName, lastName, role, is_email_verified)
     VALUES (?, 'hashed', 'Handler', ?, ?, 1)`,
    [`crh-${tag}-${TS}@example.com`, tag, role]
  );
  return r.insertId;
};

const mkAcceptedRequest = async (quote = 500, baseProductId = fx.product) => {
  const [r] = await pool.execute(
    `INSERT INTO custom_requests
       (customerId, vendorId, baseProductId, description, yards, colours, dominantColour,
        threadTypes, dominantThread, referenceImage, neededForDate, neededForTime,
        status, vendorQuotePrice, vendorCanMeet, vendorMessage)
     VALUES (?, ?, ?, 'Handler test kente', 4, '["red","gold"]', 'red',
             '["cotton"]', 'cotton', NULL, DATE_ADD(CURDATE(), INTERVAL 30 DAY), '12:00',
             'accepted', ?, 1, 'ok')`,
    [fx.customer, fx.vendor, baseProductId, quote]
  );
  fx.requests.push(r.insertId);
  return r.insertId;
};

const successTx = (reference, kobo) => ({ status: 'success', reference, amount: kobo, currency: 'GHS' });
const req = (id, body, userId = fx.customer) => ({
  params: { id: String(id) },
  body,
  user: { id: userId, role: 'customer', firstName: 'Handler', lastName: 'Customer' },
});

describe('custom request checkout handler (C-1 / C-2)', { skip: !dbAvailable }, () => {
  before(async () => {
    fx.customer = await mkUser('customer', 'cust');
    fx.other = await mkUser('customer', 'other');
    fx.vendor = await mkUser('vendor', 'vend');
    await pool.execute(
      `INSERT INTO vendors (userId, businessName, status) VALUES (?, ?, 'approved')`,
      [fx.vendor, `CRH Weaver ${TS}`]
    );
    const [p] = await pool.execute(
      `INSERT INTO product (vendorId, title, price, isCustomizable, approvalStatus, stock, img, category)
       VALUES (?, 'CRH base kente', 500, 1, 'approved', 10, '/placeholder.jpg', 'Kente')`,
      [fx.vendor]
    );
    fx.product = p.insertId;

    ({ checkoutRequest } = await import('../controllers/customRequestController.js'));
    paystack = (await import('../Services/paystackservices.js')).default;
    origVerify = paystack.verifyTransaction;
    paystack.verifyTransaction = async (reference) => {
      const tx = verifyStub.get(reference);
      return tx ? { status: true, data: tx } : { status: false, data: null };
    };
  });

  after(async () => {
    if (paystack) paystack.verifyTransaction = origVerify;
    if (!dbAvailable) return;
    try {
      const [orders] = await pool.query(
        `SELECT id FROM orders WHERE paymentReference IN (${fx.refs.map(() => '?').join(',') || 'NULL'})`,
        fx.refs
      );
      for (const { id } of orders) {
        await pool.execute(`DELETE FROM wallet_transactions WHERE allocationId IN (SELECT id FROM escrow_allocations WHERE orderId = ?)`, [id]);
        await pool.execute(`DELETE FROM financial_events WHERE orderId = ?`, [id]);
        await pool.execute(`DELETE FROM escrow_allocations WHERE orderId = ?`, [id]);
        await pool.execute(`DELETE FROM order_items WHERE orderId = ?`, [id]);
        await pool.execute(`UPDATE custom_requests SET orderId = NULL WHERE orderId = ?`, [id]);
        await pool.execute(`DELETE FROM orders WHERE id = ?`, [id]);
      }
      for (const id of fx.requests) await pool.execute(`DELETE FROM custom_requests WHERE id = ?`, [id]);
      await pool.execute(`DELETE FROM vendor_wallets WHERE vendorId = ?`, [fx.vendor]);
      await pool.execute(`DELETE FROM notifications WHERE userId IN (?, ?, ?)`, [fx.customer, fx.other, fx.vendor]);
      await pool.execute(`DELETE FROM product WHERE id = ?`, [fx.product]);
      await pool.execute(`DELETE FROM vendors WHERE userId = ?`, [fx.vendor]);
      await pool.execute(`DELETE FROM users WHERE id IN (?, ?, ?)`, [fx.customer, fx.other, fx.vendor]);
    } catch (err) {
      console.error(`customRequestCheckoutHandler cleanup failed: ${err.message}`);
    }
    await pool.end();
  });

  test('verified payment creates ONE paid order carrying the delivery address and payment method', async () => {
    const id = await mkAcceptedRequest(500);
    const reference = `crh-ok-${TS}`;
    fx.refs.push(reference);
    verifyStub.set(reference, successTx(reference, 50000));
    const address = { fullName: 'Ama Mensah', street: '12 Loom Rd', city: 'Kumasi', region: 'Ashanti', country: 'GH', phone: '0240000000' };

    const res = mockRes();
    await checkoutRequest(req(id, { paymentReference: reference, paymentMethod: 'Mobile Money', shippingAddress: address }), res);

    assert.equal(res.statusCode, 201, `expected 201, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    const [orders] = await pool.execute(
      `SELECT id, paymentStatus, orderStatus, paymentMethod, shippingAddress, billingAddress, totalAmount
       FROM orders WHERE paymentReference = ?`, [reference]
    );
    assert.equal(orders.length, 1, 'exactly one order per verified charge');
    const order = orders[0];
    assert.equal(order.paymentStatus, 'paid');
    assert.equal(order.paymentMethod, 'Mobile Money', 'client payment method label is kept');
    const ship = typeof order.shippingAddress === 'string' ? JSON.parse(order.shippingAddress) : order.shippingAddress;
    const bill = typeof order.billingAddress === 'string' ? JSON.parse(order.billingAddress) : order.billingAddress;
    assert.deepEqual(ship, address, 'the vendor must know where to deliver the custom piece');
    assert.deepEqual(bill, address);
    assert.equal(Number(order.totalAmount), 500, 'order total is the server-side quote, not client input');

    const [[cr]] = await pool.execute(`SELECT status, orderId FROM custom_requests WHERE id = ?`, [id]);
    assert.equal(cr.status, 'paid');
    assert.equal(cr.orderId, order.id);

    const [allocs] = await pool.execute(
      `SELECT allocationType, status, amount FROM escrow_allocations WHERE orderId = ? ORDER BY allocationType`, [order.id]
    );
    assert.ok(allocs.length >= 1, 'escrow allocations are created for the vendor');
    const total = allocs.reduce((s, a) => s + Number(a.amount), 0);
    assert.equal(Math.round(total * 100), 50000, 'allocations sum to the charged amount');
  });

  test('COM-4: a request with NO base product still escrows the quote for its weaver', async () => {
    // Before: the escrow step only ran for lines with a product id, so a
    // free-form custom request was charged but the weaver had no allocation
    // and could never be paid. Seeded 10% global rule, 50% advance:
    //   advance 250 -> fee 25, payout 225 (credited now); balance 250 -> fee 25, payout 225 (held).
    const id = await mkAcceptedRequest(500, null);
    const reference = `crh-noprod-${TS}`;
    fx.refs.push(reference);
    verifyStub.set(reference, successTx(reference, 50000));
    const res = mockRes();
    await checkoutRequest(req(id, { paymentReference: reference }), res);
    assert.equal(res.statusCode, 201, `expected 201, got ${res.statusCode}: ${JSON.stringify(res.body)}`);

    const [[order]] = await pool.execute(`SELECT id FROM orders WHERE paymentReference = ?`, [reference]);
    const [allocs] = await pool.execute(
      `SELECT vendorId, allocationType, status, amount, platformFee, payoutAmount
         FROM escrow_allocations WHERE orderId = ? ORDER BY allocationType`, [order.id]
    );
    assert.equal(allocs.length, 2, 'advance + balance allocations exist');
    for (const a of allocs) assert.equal(a.vendorId, fx.vendor);
    const total = allocs.reduce((s, a) => s + Number(a.amount), 0);
    assert.equal(Math.round(total * 100), 50000, 'the whole quote is escrowed for the weaver');
    for (const a of allocs) {
      assert.equal(Math.round((Number(a.platformFee) + Number(a.payoutAmount)) * 100), Math.round(Number(a.amount) * 100),
        'fee + payout == amount on every row');
    }
    const advance = allocs.find((a) => a.allocationType === 'advance');
    assert.equal(advance.status, 'available', 'advance released at payment');
    const [[credit]] = await pool.execute(
      `SELECT amount FROM wallet_transactions WHERE allocationId = (SELECT id FROM escrow_allocations WHERE orderId = ? AND allocationType = 'advance') AND type = 'credit'`,
      [order.id]
    );
    assert.equal(Number(credit.amount), Number(advance.payoutAmount), 'wallet credited the frozen payout');
  });

  test('replaying the same reference cannot create a second order', async () => {
    const reference = `crh-ok-${TS}`; // consumed by the previous test
    const id = await mkAcceptedRequest(500);
    const res = mockRes();
    await checkoutRequest(req(id, { paymentReference: reference }), res);
    assert.equal(res.statusCode, 400);
    const [[{ n }]] = await pool.execute(`SELECT COUNT(*) AS n FROM orders WHERE paymentReference = ?`, [reference]);
    assert.equal(Number(n), 1);
    const [[cr]] = await pool.execute(`SELECT status, orderId FROM custom_requests WHERE id = ?`, [id]);
    assert.equal(cr.status, 'accepted', 'the second request is untouched');
    assert.equal(cr.orderId, null);
  });

  test('a charge for less than the quote is refused and creates nothing', async () => {
    const id = await mkAcceptedRequest(500);
    const reference = `crh-short-${TS}`;
    fx.refs.push(reference);
    verifyStub.set(reference, successTx(reference, 49999));
    const res = mockRes();
    await checkoutRequest(req(id, { paymentReference: reference }), res);
    assert.equal(res.statusCode, 400);
    const [[{ n }]] = await pool.execute(`SELECT COUNT(*) AS n FROM orders WHERE paymentReference = ?`, [reference]);
    assert.equal(Number(n), 0);
  });

  test('another customer cannot pay for (and claim) someone else\'s request', async () => {
    const id = await mkAcceptedRequest(500);
    const reference = `crh-idor-${TS}`;
    fx.refs.push(reference);
    verifyStub.set(reference, successTx(reference, 50000));
    const res = mockRes();
    await checkoutRequest(req(id, { paymentReference: reference }, fx.other), res);
    assert.equal(res.statusCode, 403);
    const [[{ n }]] = await pool.execute(`SELECT COUNT(*) AS n FROM orders WHERE paymentReference = ?`, [reference]);
    assert.equal(Number(n), 0);
  });
});
