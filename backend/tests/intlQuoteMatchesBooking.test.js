// FILE LOCATION: backend/tests/intlQuoteMatchesBooking.test.js
// DESCRIPTION: DB-backed. The international shipping QUOTE that checkout
//              shows must agree with what order creation BOOKS.
//
// Two defects this pins:
//   1. Checkout sends the quote only product ids, and the quote looked for
//      vendors only in a client-sent `vendorId` per item, so it answered
//      "supported" (with a price) for a vendor who does not ship to the
//      destination; order creation then refused the order at Pay.
//   2. The quote returned no figure that matched the booking, so checkout
//      displayed Ghana's flat shipping and a lower total than the order
//      the server then created and Paystack charged.
// Skips itself without a database.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.EMAIL_DISABLED = '1';
process.env.REDIS_URL = '';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
  await pool.query('SELECT 1 FROM vendor_shipping_destinations LIMIT 1');
  await pool.query('SELECT 1 FROM exchange_rates LIMIT 1');
} catch {
  dbAvailable = false;
}

const { getShippingOptions } = await import('../controllers/internationalCheckoutController.js');
const { addOrderItems } = await import('../controllers/orderController.js');

const TS = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
const fx = {};

const call = async (handler, req) => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler(req, res);
  return res;
};
const quote = (countryCode, items, subtotal) =>
  call(getShippingOptions, { body: { countryCode, subtotal, items } });
const gbAddress = { firstName: 'Ama', lastName: 'K', email: 'a@test.local', phone: '+447700900123', address: '1 Road', city: 'London', postalCode: 'SW1A 1AA', countryCode: 'GB' };

describe(`international quote agrees with order booking${dbAvailable ? '' : ' — SKIPPED: no database'}`, { skip: !dbAvailable }, () => {
  before(async () => {
    const mkUser = async (role, tag) => (await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
       VALUES ('IQ', ?, ?, 'hashed', ?, 1, 1)`,
      [tag, `iq-${tag}-${TS}@test.local`, role],
    ))[0].insertId;
    fx.buyer = await mkUser('customer', 'buyer');
    fx.shipsGB = await mkUser('vendor', 'ships');
    fx.noGB = await mkUser('vendor', 'noship');
    for (const v of [fx.shipsGB, fx.noGB]) {
      await pool.execute(`INSERT INTO vendors (userId, businessName, status) VALUES (?, ?, 'approved')`, [v, `IQ ${v} ${TS}`]);
    }
    await pool.execute(`INSERT INTO vendor_shipping_destinations (vendorId, countryCode, region, isActive) VALUES (?, 'GB', NULL, 1)`, [fx.shipsGB]);
    const mkProduct = async (vendorId, price) => (await pool.execute(
      `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
       VALUES (?, '/images/image2.jpeg', ?, 'Kente', 50, ?, 0, 'approved')`,
      [`IQ ${vendorId} ${TS}`, price, vendorId],
    ))[0].insertId;
    fx.shipsProduct = await mkProduct(fx.shipsGB, 450);
    fx.noShipProduct = await mkProduct(fx.noGB, 300);
  });

  after(async () => {
    const del = async (sql, params) => { try { await pool.execute(sql, params); } catch (e) { console.warn('cleanup:', e.message); } };
    await del('DELETE FROM orders WHERE userId = ?', [fx.buyer]);
    await del('DELETE FROM vendor_shipping_destinations WHERE vendorId IN (?, ?)', [fx.shipsGB, fx.noGB]);
    await del('DELETE FROM product WHERE id IN (?, ?)', [fx.shipsProduct, fx.noShipProduct]);
    await del('DELETE FROM vendors WHERE userId IN (?, ?)', [fx.shipsGB, fx.noGB]);
    await del('DELETE FROM users WHERE id IN (?, ?, ?)', [fx.buyer, fx.shipsGB, fx.noGB]);
    await pool.end();
  });

  test('a quote with only product ids refuses a vendor who does not ship there', async () => {
    const r = await quote('GB', [{ productId: fx.noShipProduct, qty: 1 }], 300);
    assert.equal(r.body.supported, false, JSON.stringify(r.body));
    assert.match(r.body.message, /does not ship to GB/);
  });

  test('Ghana stays domestic: no vendor-destination check', async () => {
    // Neither vendor lists GH; Ghana orders never require it. Each seller's
    // items (450 and 300) are over the GHS 200 free-delivery default.
    const r = await quote('GH', [{ productId: fx.shipsProduct, qty: 1 }, { productId: fx.noShipProduct, qty: 1 }], 750);
    assert.equal(r.body.supported, true, JSON.stringify(r.body));
    assert.equal(r.body.chargeableShippingGHS, 0);
  });

  test('a mixed cart is refused when ANY vendor does not ship there', async () => {
    const r = await quote('GB', [{ productId: fx.shipsProduct, qty: 1 }, { productId: fx.noShipProduct, qty: 1 }], 750);
    assert.equal(r.body.supported, false);
  });

  test('the quoted chargeable shipping is exactly what the order books', async () => {
    const qty = 2;
    const subtotal = 450 * qty;
    const q = await quote('GB', [{ productId: fx.shipsProduct, qty }], subtotal);
    assert.equal(q.body.supported, true, JSON.stringify(q.body));
    assert.equal(typeof q.body.chargeableShippingGHS, 'number');
    assert.ok(q.body.chargeableShippingGHS > 0, 'GB shipping is not Ghana\'s free/flat figure');

    const o = await call(addOrderItems, {
      user: { id: fx.buyer, role: 'customer' },
      body: { items: [{ product: fx.shipsProduct, quantity: qty }], shippingAddress: gbAddress, paymentMethod: 'pending' },
    });
    assert.equal(o.code, 201, JSON.stringify(o.body));
    // Park the row (as couponMaxUses.test.js does): a fresh pending order
    // looks like an abandoned checkout to other suites' unscoped expiry
    // sweeps running in parallel, which would release its stock under them.
    await pool.execute(`UPDATE orders SET escrowStatus = 'releasing' WHERE id = ?`, [o.body.order.id]);
    const booked = Number(o.body.order.totalAmount);
    const tax = Math.round(subtotal * 0.15 * 100) / 100;
    assert.equal(booked, Math.round((subtotal + tax + q.body.chargeableShippingGHS) * 100) / 100);
  });
});
