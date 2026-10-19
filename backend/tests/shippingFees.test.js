// FILE LOCATION: backend/tests/shippingFees.test.js
// DESCRIPTION: DB-backed. Delivery fees set by the admin (platform default per
//              country) and by sellers (their own fee per country, replacing
//              the default for their products), charged per seller parcel.
//
// Proves, through the real quote and order-creation handlers:
//   - a seller's own fee replaces the platform default (it does not merely
//     compete with it on price), and removing it restores the default;
//   - a cart with two sellers pays each seller's fee, and each seller's
//     free-delivery threshold applies to that seller's items only;
//   - the quote shown at checkout equals the shipping the order books;
//   - the admin's platform default applies to sellers with no fee of their own;
//   - invalid fees are refused with a reason; one seller cannot touch another's;
//   - the admin sees every seller's fees and can change or remove them
//     (routes/shippingAdminRoutes.js /sellers), and only an admin can.
//
// The PLATFORM default is only changed for DE (no other suite prices DE) and
// is restored afterwards; Ghana is exercised through seller fees only, so the
// shared GHS 15 / free-from-200 default other suites rely on never moves.
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
  await pool.query('SELECT 1 FROM shipping_rates LIMIT 1');
} catch {
  dbAvailable = false;
}

const svc = await import('../Services/shippingService.js');
const { getShippingOptions } = await import('../controllers/internationalCheckoutController.js');
const { addOrderItems } = await import('../controllers/orderController.js');
const { setVendorShippingRate, removeVendorShippingRate, getVendorShippingRates } = await import('../controllers/vendorController.js');
const adminShippingRouter = (await import('../routes/shippingAdminRoutes.js')).default;

// The admin router's handler for METHOD path (auth is router-level middleware,
// exercised separately below over HTTP).
const adminRoute = (method, path) => {
  const layer = adminShippingRouter.stack.find((l) => l.route?.path === path && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};
const adminReq = (params = {}, body = {}) => ({ user: { id: 1, role: 'admin', email: 'admin@test.local' }, params, body, headers: {}, ip: '127.0.0.1', get: () => undefined });

const TS = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
const fx = { orders: [] };

const call = async (handler, req) => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler(req, res);
  return res;
};
const quote = (countryCode, items) => call(getShippingOptions, { body: { countryCode, items } });
const book = async (countryCode, lines, extra = {}) => {
  const r = await call(addOrderItems, {
    user: { id: fx.buyer, role: 'customer' },
    body: {
      items: lines.map(([product, quantity]) => ({ product, quantity })),
      shippingAddress: { firstName: 'Ama', lastName: 'K', email: 'a@test.local', phone: '+233200000000', address: '1 Road', city: 'Kumasi', countryCode, ...extra },
      paymentMethod: 'pending',
    },
  });
  if (r.code === 201) {
    fx.orders.push(r.body.order.id);
    // Park it: other suites' unscoped abandoned-order sweeps must not touch it.
    await pool.execute(`UPDATE orders SET escrowStatus = 'releasing' WHERE id = ?`, [r.body.order.id]);
  }
  return r;
};
const bookedShipping = (r) => Number(r.body.order.shippingCost ?? r.body.order.shippingPrice);
const vendorReq = (id, params = {}, body = {}) => ({ user: { id, role: 'vendor' }, params, body });

describe(`delivery fees set by admin and sellers${dbAvailable ? '' : ' — SKIPPED: no database'}`, { skip: !dbAvailable }, () => {
  let deBefore = null;

  before(async () => {
    const mkUser = async (role, tag) => (await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
       VALUES ('FEE', ?, ?, 'hashed', ?, 1, 1)`,
      [tag, `fee-${tag}-${TS}@test.local`, role],
    ))[0].insertId;
    fx.buyer = await mkUser('customer', 'buyer');
    fx.sellerA = await mkUser('vendor', 'a');
    fx.sellerB = await mkUser('vendor', 'b');
    for (const v of [fx.sellerA, fx.sellerB]) {
      await pool.execute(`INSERT INTO vendors (userId, businessName, status) VALUES (?, ?, 'approved')`, [v, `FEE ${v} ${TS}`]);
      await pool.execute(`INSERT INTO vendor_shipping_destinations (vendorId, countryCode, region, isActive) VALUES (?, 'DE', NULL, 1)`, [v]);
    }
    const mkProduct = async (vendorId, price) => (await pool.execute(
      `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus, weight)
       VALUES (?, '/images/image2.jpeg', ?, 'Kente', 100, ?, 0, 'approved', 0.5)`,
      [`FEE ${vendorId} ${price} ${TS}`, price, vendorId],
    ))[0].insertId;
    fx.a120 = await mkProduct(fx.sellerA, 120);
    fx.a450 = await mkProduct(fx.sellerA, 450);
    fx.b100 = await mkProduct(fx.sellerB, 100);
    fx.b250 = await mkProduct(fx.sellerB, 250);
    deBefore = (await svc.listShippingRates(null)).find((r) => r.countryCode === 'DE') || null;
  });

  after(async () => {
    const del = async (sql, params) => { try { await pool.execute(sql, params); } catch (e) { console.warn('cleanup:', e.message); } };
    // Restore the DE platform default exactly as it was.
    await del(`DELETE FROM shipping_rates WHERE vendorId IS NULL AND destinationCountry = 'DE' AND effectiveFrom = CURDATE() AND isActive = TRUE`, []);
    if (deBefore) {
      await del(`UPDATE shipping_rates SET isActive = TRUE, effectiveTo = NULL
                 WHERE vendorId IS NULL AND destinationCountry = 'DE' AND serviceLevel = 'standard' AND destinationRegion IS NULL
                   AND baseCost = ? AND currency = ? ORDER BY id DESC LIMIT 1`, [deBefore.baseCost, deBefore.currency]);
    }
    if (fx.orders.length) await del(`DELETE FROM orders WHERE id IN (${fx.orders.map(() => '?').join(',')})`, fx.orders);
    await del('DELETE FROM shipping_rates WHERE vendorId IN (?, ?)', [fx.sellerA, fx.sellerB]);
    await del('DELETE FROM vendor_shipping_destinations WHERE vendorId IN (?, ?)', [fx.sellerA, fx.sellerB]);
    await del('DELETE FROM product WHERE id IN (?, ?, ?, ?)', [fx.a120, fx.a450, fx.b100, fx.b250]);
    await del('DELETE FROM vendors WHERE userId IN (?, ?)', [fx.sellerA, fx.sellerB]);
    await del('DELETE FROM users WHERE id IN (?, ?, ?)', [fx.buyer, fx.sellerA, fx.sellerB]);
    await pool.end();
  });

  test('without seller fees, Ghana is the unchanged platform default (GHS 15, free from 200)', async () => {
    const q = await quote('GH', [{ productId: fx.a120, qty: 1 }]);
    assert.equal(q.body.chargeableShippingGHS, 15);
    const o = await book('GH', [[fx.a120, 1]]);
    assert.equal(o.code, 201, JSON.stringify(o.body));
    assert.equal(bookedShipping(o), 15);
    assert.equal(Number(o.body.order.totalAmount), 120 + 18 + 15);
    const free = await quote('GH', [{ productId: fx.a450, qty: 1 }]);
    assert.equal(free.body.chargeableShippingGHS, 0);
  });

  test("a seller's own Ghana fee replaces the default, even where the default would be free", async () => {
    const r = await call(setVendorShippingRate, vendorReq(fx.sellerA, { countryCode: 'GH' }, {
      baseCost: 25, freeThreshold: '', currency: 'GHS', transitDaysMin: 1, transitDaysMax: 3, carrierCode: 'local_gh',
    }));
    assert.equal(r.code, 200, JSON.stringify(r.body));
    // GHS 450 would ship free on the platform default; seller A charges 25 with no free threshold.
    const q = await quote('GH', [{ productId: fx.a450, qty: 1 }]);
    assert.equal(q.body.chargeableShippingGHS, 25);
    const o = await book('GH', [[fx.a450, 1]]);
    assert.equal(bookedShipping(o), 25);
  });

  test('two sellers in one cart: each parcel pays its own fee and its own free threshold', async () => {
    // A: own fee 25 (never free). B: platform default 15, free from 200 — B's
    // items total 350, so B ships free even though A's do not.
    const items = [{ productId: fx.a120, qty: 1 }, { productId: fx.b100, qty: 1 }, { productId: fx.b250, qty: 1 }];
    const q = await quote('GH', items);
    assert.equal(q.body.chargeableShippingGHS, 25);
    assert.equal(q.body.shippingGroups.length, 2);
    const o = await book('GH', [[fx.a120, 1], [fx.b100, 1], [fx.b250, 1]]);
    assert.equal(bookedShipping(o), 25, 'quote and booking agree');

    // Below B's threshold both parcels pay: 25 + 15.
    const q2 = await quote('GH', [{ productId: fx.a120, qty: 1 }, { productId: fx.b100, qty: 1 }]);
    assert.equal(q2.body.chargeableShippingGHS, 40);
    const o2 = await book('GH', [[fx.a120, 1], [fx.b100, 1]]);
    assert.equal(bookedShipping(o2), 40);
  });

  test("removing a seller's fee restores the platform default", async () => {
    const r = await call(removeVendorShippingRate, vendorReq(fx.sellerA, { countryCode: 'GH' }));
    assert.equal(r.code, 200);
    assert.equal((await quote('GH', [{ productId: fx.a450, qty: 1 }])).body.chargeableShippingGHS, 0);
    const again = await call(removeVendorShippingRate, vendorReq(fx.sellerA, { countryCode: 'GH' }));
    assert.equal(again.code, 404);
  });

  test("the admin's default for a country applies to sellers without their own fee", async () => {
    const set = await svc.setStandardShippingRate(null, 'DE', {
      baseCost: 30, freeThreshold: null, currency: 'GHS', transitDaysMin: 6, transitDaysMax: 12, carrierCode: 'dhl',
    });
    assert.equal(set.ok, true, set.message);
    const q = await quote('DE', [{ productId: fx.b100, qty: 1 }]);
    assert.equal(q.body.supported, true, JSON.stringify(q.body));
    assert.equal(q.body.chargeableShippingGHS, 30);
    const o = await book('DE', [[fx.b100, 1]], { postalCode: '10115' });
    assert.equal(o.code, 201, JSON.stringify(o.body));
    assert.equal(bookedShipping(o), 30);

    // Seller B overrides DE for their own products only.
    await call(setVendorShippingRate, vendorReq(fx.sellerB, { countryCode: 'DE' }, {
      baseCost: 50, currency: 'GHS', transitDaysMin: 5, transitDaysMax: 9, carrierCode: 'dhl',
    }));
    assert.equal((await quote('DE', [{ productId: fx.b100, qty: 1 }])).body.chargeableShippingGHS, 50);
    assert.equal((await quote('DE', [{ productId: fx.a120, qty: 1 }])).body.chargeableShippingGHS, 30);
    assert.equal((await quote('DE', [{ productId: fx.a120, qty: 1 }, { productId: fx.b100, qty: 1 }])).body.chargeableShippingGHS, 80);
  });

  test('a seller sees their own fees and the platform defaults, never another seller\'s', async () => {
    const r = await call(getVendorShippingRates, vendorReq(fx.sellerA));
    assert.equal(r.code, 200);
    assert.ok(!r.body.rates.some((x) => x.countryCode === 'DE'), "seller B's DE fee must not appear for seller A");
    assert.ok(r.body.platformDefaults.some((x) => x.countryCode === 'GH'));
    assert.ok(r.body.carriers.length > 0);
  });

  test("the admin sees every seller's fees and can change or remove them", async () => {
    const list = await call(adminRoute('get', '/sellers'), adminReq());
    assert.equal(list.code, 200);
    const a = list.body.sellers.find((x) => x.vendorId === fx.sellerA);
    assert.ok(a, 'seller A listed even before they have a fee');
    assert.ok(list.body.platformDefaults.some((x) => x.countryCode === 'GH'));

    const set = await call(adminRoute('put', '/sellers/:vendorId/rates/:countryCode'),
      adminReq({ vendorId: String(fx.sellerA), countryCode: 'gh' }, { baseCost: 9, transitDaysMin: 1, transitDaysMax: 3 }));
    assert.equal(set.code, 200, JSON.stringify(set.body));
    assert.equal((await svc.listShippingRates(fx.sellerA)).find((r) => r.countryCode === 'GH').baseCost, 9);
    // The seller's checkout uses the fee the admin set.
    const q = await quote('GH', [{ productId: fx.a120, qty: 1 }]);
    assert.equal(q.body.chargeableShippingGHS, 9);
    const after = await call(adminRoute('get', '/sellers'), adminReq());
    assert.deepEqual(after.body.sellers.find((x) => x.vendorId === fx.sellerA).rates.map((r) => r.countryCode), ['GH']);
    const [[audit]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'seller_shipping_rate.set' AND entityId = ?`, [`${fx.sellerA}:GH`]);
    assert.ok(Number(audit.n) >= 1, 'audit-logged');

    const bad = await call(adminRoute('put', '/sellers/:vendorId/rates/:countryCode'),
      adminReq({ vendorId: String(fx.sellerA), countryCode: 'GH' }, { baseCost: -5, transitDaysMin: 1, transitDaysMax: 3 }));
    assert.equal(bad.code, 400);
    for (const vendorId of [String(fx.buyer), '0', 'abc']) {
      const r = await call(adminRoute('put', '/sellers/:vendorId/rates/:countryCode'),
        adminReq({ vendorId, countryCode: 'GH' }, { baseCost: 9, transitDaysMin: 1, transitDaysMax: 3 }));
      assert.equal(r.code, 404, `vendorId=${vendorId} is not a seller`);
    }

    const del = await call(adminRoute('delete', '/sellers/:vendorId/rates/:countryCode'), adminReq({ vendorId: String(fx.sellerA), countryCode: 'GH' }));
    assert.equal(del.code, 200);
    assert.deepEqual(await svc.listShippingRates(fx.sellerA), []);
    const again = await call(adminRoute('delete', '/sellers/:vendorId/rates/:countryCode'), adminReq({ vendorId: String(fx.sellerA), countryCode: 'GH' }));
    assert.equal(again.code, 404);
    const back = await quote('GH', [{ productId: fx.a120, qty: 1 }]);
    assert.equal(back.body.chargeableShippingGHS, 15, 'platform default applies again');
  });

  test("only an admin reaches the sellers' fee routes", async () => {
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    app.use((await import('cookie-parser')).default());
    app.use('/api/admin/shipping', adminShippingRouter);
    app.use((await import('../middleware/errorMiddleware.js')).errorHandeler);
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${server.address().port}/api/admin/shipping`;
      const get = await fetch(`${base}/sellers`);
      assert.equal(get.status, 401);
      const put = await fetch(`${base}/sellers/${fx.sellerA}/rates/GH`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseCost: 0, transitDaysMin: 1, transitDaysMax: 2 }),
      });
      assert.equal(put.status, 401);
      assert.deepEqual(await svc.listShippingRates(fx.sellerA), []);
    } finally {
      server.close();
    }
  });

  test('invalid fees are refused with a reason and change nothing', async () => {
    const bad = [
      [{ countryCode: 'GH' }, { baseCost: 10, currency: 'USD', transitDaysMin: 1, transitDaysMax: 2 }, /Currency must be GHS/],
      [{ countryCode: 'GH' }, { baseCost: -1, transitDaysMin: 1, transitDaysMax: 2 }, /Fee must be/],
      [{ countryCode: 'GH' }, { baseCost: 10, transitDaysMin: 5, transitDaysMax: 2 }, /Delivery days/],
      [{ countryCode: 'GH' }, { baseCost: 10, transitDaysMin: 1, transitDaysMax: 2, carrierCode: 'dhl' }, /does not deliver to GH/],
      [{ countryCode: 'GB' }, { baseCost: 10, currency: 'EUR', transitDaysMin: 1, transitDaysMax: 2 }, /Currency must be GHS or GBP/],
      [{ countryCode: 'FR' }, { baseCost: 10, transitDaysMin: 1, transitDaysMax: 2 }, /Unsupported country/],
    ];
    for (const [params, body, reason] of bad) {
      const r = await call(setVendorShippingRate, vendorReq(fx.sellerA, params, body));
      assert.equal(r.code, 400, JSON.stringify(body));
      assert.match(r.body.message, reason);
    }
    assert.deepEqual(await svc.listShippingRates(fx.sellerA), []);
  });
});
