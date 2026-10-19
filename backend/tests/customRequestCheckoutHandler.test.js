// FILE LOCATION: backend/tests/customRequestCheckoutHandler.test.js
// DESCRIPTION: Drives the REAL checkoutRequest handler (customRequestCheckout.test.js
//              re-implements its SQL by hand and never calls it). Pins:
//              - C-1: the order transaction used `paymentMethod` outside the block
//                that declared it, so every custom checkout threw ReferenceError
//                AFTER Paystack had verified the charge — customer charged, no order.
//              - C-2: the customer's delivery address must be persisted on the order
//                (the rewrite stored `{}`; HEAD stored the address).
//              - Custom orders carry VAT (admin rate) and delivery (per-seller fee):
//                POST /:id/price saves quote + VAT + delivery before payment and
//                checkout verifies the charge against that saved total.
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
let priceRequest;
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

const GH_ADDRESS = { fullName: 'Ama Mensah', street: '12 Loom Rd', city: 'Kumasi', region: 'Ashanti', country: 'GH', phone: '0240000000' };
/** Price the request for an address (the step the checkout page runs first). */
const priceIt = async (id, address = GH_ADDRESS, userId = fx.customer) => {
  const res = mockRes();
  await priceRequest(req(id, { shippingAddress: address }, userId), res);
  return res;
};

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

    ({ checkoutRequest, priceRequest } = await import('../controllers/customRequestController.js'));
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
    const address = GH_ADDRESS;
    // Quote 500 + 15% VAT 75 + Ghana delivery 0 (500 is over the GH₵200 free threshold).
    const priced = await priceIt(id, address);
    assert.equal(priced.statusCode, 200, JSON.stringify(priced.body));
    assert.deepEqual(priced.body, { subtotal: 500, tax: 75, shipping: 0, total: 575, country: 'GH', currency: 'GHS' });
    verifyStub.set(reference, successTx(reference, 57500));

    const res = mockRes();
    await checkoutRequest(req(id, { paymentReference: reference, paymentMethod: 'Mobile Money', shippingAddress: address }), res);

    assert.equal(res.statusCode, 201, `expected 201, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    const [orders] = await pool.execute(
      `SELECT id, paymentStatus, orderStatus, paymentMethod, shippingAddress, billingAddress, totalAmount, tax, shippingCost
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
    assert.equal(Number(order.totalAmount), 575, 'order total is quote + VAT + delivery, priced on the server');
    assert.equal(Number(order.tax), 75);
    assert.equal(Number(order.shippingCost), 0);

    const [[cr]] = await pool.execute(`SELECT status, orderId FROM custom_requests WHERE id = ?`, [id]);
    assert.equal(cr.status, 'paid');
    assert.equal(cr.orderId, order.id);

    const [allocs] = await pool.execute(
      `SELECT allocationType, status, amount FROM escrow_allocations WHERE orderId = ? ORDER BY allocationType`, [order.id]
    );
    assert.ok(allocs.length >= 1, 'escrow allocations are created for the vendor');
    const total = allocs.reduce((s, a) => s + Number(a.amount), 0);
    assert.equal(Math.round(total * 100), 50000, "allocations sum to the weaver's quote (VAT and delivery stay with the platform)");
  });

  test('COM-4: a request with NO base product still escrows the quote for its weaver', async () => {
    // Before: the escrow step only ran for lines with a product id, so a
    // free-form custom request was charged but the weaver had no allocation
    // and could never be paid. Seeded 10% global rule, 50% advance:
    //   advance 250 -> fee 25, payout 225 (credited now); balance 250 -> fee 25, payout 225 (held).
    const id = await mkAcceptedRequest(500, null);
    const reference = `crh-noprod-${TS}`;
    fx.refs.push(reference);
    assert.equal((await priceIt(id)).body.total, 575);
    verifyStub.set(reference, successTx(reference, 57500));
    const res = mockRes();
    await checkoutRequest(req(id, { paymentReference: reference, shippingAddress: GH_ADDRESS }), res);
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
    await priceIt(id);
    const res = mockRes();
    await checkoutRequest(req(id, { paymentReference: reference, shippingAddress: GH_ADDRESS }), res);
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
    await priceIt(id);
    verifyStub.set(reference, successTx(reference, 57499));
    const res = mockRes();
    await checkoutRequest(req(id, { paymentReference: reference, shippingAddress: GH_ADDRESS }), res);
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

  test('paying only the bare quote (no VAT or delivery) is refused', async () => {
    const id = await mkAcceptedRequest(500);
    await priceIt(id);
    const reference = `crh-bare-${TS}`;
    fx.refs.push(reference);
    verifyStub.set(reference, successTx(reference, 50000));
    const res = mockRes();
    await checkoutRequest(req(id, { paymentReference: reference, shippingAddress: GH_ADDRESS }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /does not match the order total/);
  });

  test('an unpriced request cannot be checked out, even with a valid charge', async () => {
    const id = await mkAcceptedRequest(500);
    const reference = `crh-unpriced-${TS}`;
    fx.refs.push(reference);
    verifyStub.set(reference, successTx(reference, 57500));
    const res = mockRes();
    await checkoutRequest(req(id, { paymentReference: reference, shippingAddress: GH_ADDRESS }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'CUSTOM_ORDER_NOT_PRICED');
  });

  test('changing the delivery country after pricing requires pricing again', async () => {
    const id = await mkAcceptedRequest(500);
    await priceIt(id);
    const reference = `crh-moved-${TS}`;
    fx.refs.push(reference);
    verifyStub.set(reference, successTx(reference, 57500));
    const res = mockRes();
    await checkoutRequest(req(id, { paymentReference: reference, shippingAddress: { ...GH_ADDRESS, country: 'GB' } }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'CUSTOM_ORDER_REPRICE');
  });

  test('pricing: below the free threshold delivery is charged; abroad needs the weaver to ship there', async () => {
    const small = await mkAcceptedRequest(150);
    const p = await priceIt(small);
    // 150 + VAT 22.50 + Ghana delivery 15 (under GH₵200).
    assert.deepEqual([p.body.tax, p.body.shipping, p.body.total], [22.5, 15, 187.5]);

    const abroad = await mkAcceptedRequest(500);
    const refused = await priceIt(abroad, { ...GH_ADDRESS, country: 'GB', postalCode: 'SW1A 1AA' });
    assert.equal(refused.statusCode, 400);
    assert.equal(refused.body.code, 'VENDOR_DOES_NOT_SHIP');

    await pool.execute(`INSERT INTO vendor_shipping_destinations (vendorId, countryCode, region, isActive) VALUES (?, 'GB', NULL, 1)`, [fx.vendor]);
    try {
      const gb = await priceIt(abroad, { ...GH_ADDRESS, country: 'GB', postalCode: 'SW1A 1AA' });
      assert.equal(gb.statusCode, 200, JSON.stringify(gb.body));
      assert.ok(gb.body.shipping > 0, 'UK delivery is charged');
      assert.equal(gb.body.total, Math.round((500 + 75 + gb.body.shipping) * 100) / 100);
    } finally {
      await pool.execute(`DELETE FROM vendor_shipping_destinations WHERE vendorId = ?`, [fx.vendor]);
    }
  });

  test("another customer cannot price someone else's request", async () => {
    const id = await mkAcceptedRequest(500);
    const res = await priceIt(id, GH_ADDRESS, fx.other);
    assert.equal(res.statusCode, 403);
  });
});
