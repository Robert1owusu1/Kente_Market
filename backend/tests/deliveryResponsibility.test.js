// FILE LOCATION: backend/tests/deliveryResponsibility.test.js
// DESCRIPTION: Who delivers a seller's parcels — the seller, or the platform
//              (the seller drops the parcel at the hub). DB-backed.
//
// Proves, through the real handlers:
//   - a new seller application must say who delivers, in Ghana and abroad;
//   - a seller who delivers is charged (and paid, as a commission-free
//     'shipping' escrow allocation) their own fee; a parcel the platform
//     delivers is charged the platform default and the platform keeps it;
//   - the choice and fee are frozen on the order (order_delivery_parts), so
//     changing the setting later never moves a placed order;
//   - abroad, a seller who delivers must list the country; when the platform
//     delivers, the platform's price list decides;
//   - a seller who delivers sees the full delivery address; a seller who drops
//     off at the hub sees no buyer contact details;
//   - a hub parcel: the seller packs it and marks it dropped off, cannot mark
//     it shipped; the admin receives it and moves only that seller's parcel;
//   - a partial (per-seller) refund returns goods only, so the seller who
//     delivered keeps the delivery-fee allocation.
// Ghana's platform default (GHS 15, free from 200) is never changed here.
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
  await pool.query('SELECT 1 FROM order_delivery_parts LIMIT 1');
} catch {
  dbAvailable = false;
}

const svc = await import('../Services/shippingService.js');
const { buildDeliveryFeeRows } = await import('../Services/commissionService.js');
const { voidVendorEscrow } = await import('../Services/escrowService.js');
const { addOrderItems } = await import('../controllers/orderController.js');
const { applyVendor, updateVendorDeliverySettings, getVendorDeliverySettings } = await import('../controllers/vendorController.js');
const { getVendorOrders, updateVendorOrderStatus, handOverToHub } = await import('../controllers/vendorOrderController.js');
const adminShippingRouter = (await import('../routes/shippingAdminRoutes.js')).default;

const adminRoute = (method, path) => {
  const layer = adminShippingRouter.stack.find((l) => l.route?.path === path && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};

const TS = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
const fx = { orders: [] };

const call = async (handler, req) => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler(req, res);
  return res;
};
const adminReq = (params = {}, body = {}, query = {}) => ({ user: { id: fx.admin, role: 'admin', email: 'admin@test.local' }, params, body, query, headers: {}, ip: '127.0.0.1', get: () => undefined });
const vendorReq = (id, params = {}, body = {}) => ({ user: { id, role: 'vendor' }, params, body });

const ADDRESS = { firstName: 'Ama', lastName: 'Mensah', email: 'a@test.local', phone: '+233200000001', address: '7 Palace Road', city: 'Kumasi', region: 'Ashanti' };
const book = async (lines, address = {}) => {
  const r = await call(addOrderItems, {
    user: { id: fx.buyer, role: 'customer' },
    body: {
      items: lines.map(([product, quantity]) => ({ product, quantity })),
      shippingAddress: { ...ADDRESS, countryCode: 'GH', ...address },
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
const parts = async (orderId) => (await svc.getOrderDeliveryParts(orderId))
  .sort((a, b) => a.vendorId - b.vendorId);
const allocations = async (orderId) => (await pool.execute(
  `SELECT vendorId, allocationType, amount, platformFee, payoutAmount, status FROM escrow_allocations WHERE orderId = ? ORDER BY vendorId, allocationType`,
  [orderId]
))[0];

describe('buildDeliveryFeeRows (pure)', () => {
  test('only sellers who deliver, with a fee, get a commission-free row', () => {
    const rows = buildDeliveryFeeRows([
      { vendorId: 7, deliveredBy: 'seller', shippingFee: 25 },
      { vendorId: 8, deliveredBy: 'platform', shippingFee: 15 },
      { vendorId: 9, deliveredBy: 'seller', shippingFee: 0 },
      { vendorId: null, deliveredBy: 'seller', shippingFee: 10 },
    ]);
    assert.deepEqual(rows, [{ vendorId: 7, allocationType: 'shipping', amount: 25, platformFeeRate: 0, platformFee: 0, payoutAmount: 25 }]);
  });
});

describe(`who delivers: seller or platform hub${dbAvailable ? '' : ' — SKIPPED: no database'}`, { skip: !dbAvailable }, () => {
  before(async () => {
    const mkUser = async (role, tag) => (await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
       VALUES ('DLV', ?, ?, 'hashed', ?, 1, 1)`,
      [tag, `dlv-${tag}-${TS}@test.local`, role],
    ))[0].insertId;
    fx.admin = await mkUser('admin', 'admin');
    fx.buyer = await mkUser('customer', 'buyer');
    fx.applicant = await mkUser('customer', 'applicant');
    // A delivers everywhere themselves; B has the platform deliver everywhere.
    fx.sellerA = await mkUser('vendor', 'a');
    fx.sellerB = await mkUser('vendor', 'b');
    await pool.execute(
      `INSERT INTO vendors (userId, businessName, status, domesticDelivery, internationalDelivery) VALUES (?, ?, 'approved', 'seller', 'seller')`,
      [fx.sellerA, `DLV A ${TS}`]
    );
    await pool.execute(
      `INSERT INTO vendors (userId, businessName, status, domesticDelivery, internationalDelivery) VALUES (?, ?, 'approved', 'platform', 'platform')`,
      [fx.sellerB, `DLV B ${TS}`]
    );
    const mkProduct = async (vendorId, price) => (await pool.execute(
      `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus, weight)
       VALUES (?, '/images/image2.jpeg', ?, 'Kente', 100, ?, 0, 'approved', 0.5)`,
      [`DLV ${vendorId} ${price} ${TS}`, price, vendorId],
    ))[0].insertId;
    fx.a100 = await mkProduct(fx.sellerA, 100);
    fx.b100 = await mkProduct(fx.sellerB, 100);
    // Both sellers set their own Ghana fee; only A's may apply.
    for (const [v, fee] of [[fx.sellerA, 25], [fx.sellerB, 40]]) {
      const r = await svc.setStandardShippingRate(v, 'GH', { baseCost: fee, currency: 'GHS', transitDaysMin: 1, transitDaysMax: 3, carrierCode: 'local_gh' });
      assert.ok(r.ok, JSON.stringify(r));
    }
  });

  after(async () => {
    const del = async (sql, params) => { try { await pool.execute(sql, params); } catch (e) { console.warn('cleanup:', e.message); } };
    if (fx.orders.length) await del(`DELETE FROM orders WHERE id IN (${fx.orders.map(() => '?').join(',')})`, fx.orders);
    await del('DELETE FROM shipping_rates WHERE vendorId IN (?, ?)', [fx.sellerA, fx.sellerB]);
    await del('DELETE FROM vendor_shipping_destinations WHERE vendorId IN (?, ?)', [fx.sellerA, fx.sellerB]);
    await del('DELETE FROM product WHERE id IN (?, ?)', [fx.a100, fx.b100]);
    await del('DELETE FROM vendors WHERE userId IN (?, ?, ?)', [fx.sellerA, fx.sellerB, fx.applicant]);
    await del('DELETE FROM users WHERE id IN (?, ?, ?, ?, ?)', [fx.admin, fx.buyer, fx.applicant, fx.sellerA, fx.sellerB]);
    await pool.end();
  });

  test('a new seller application must say who delivers in Ghana and abroad', async () => {
    const base = { businessName: `DLV apply ${TS}`, payoutType: 'momo', momoProvider: 'MTN', momoNumber: '0550000000' };
    const none = await call(applyVendor, { user: { id: fx.applicant, role: 'customer' }, body: base });
    assert.equal(none.code, 400);
    assert.match(none.body.message, /within Ghana/);
    const half = await call(applyVendor, { user: { id: fx.applicant, role: 'customer' }, body: { ...base, domesticDelivery: 'seller', internationalDelivery: 'courier' } });
    assert.equal(half.code, 400);
    assert.match(half.body.message, /outside Ghana/);
  });

  test("a seller who delivers is charged and paid their own fee; the platform's parcel uses the platform default", async () => {
    const o = await book([[fx.a100, 1], [fx.b100, 1]]);
    assert.equal(o.code, 201, JSON.stringify(o.body));
    // A: own fee 25 (seller delivers). B: platform default 15, not B's own 40.
    assert.equal(Number(o.body.order.shippingCost), 25 + 15);
    fx.mixed = o.body.order.id;

    assert.deepEqual((await parts(fx.mixed)).map((p) => [p.vendorId, p.deliveredBy, p.shippingFee]), [
      [fx.sellerA, 'seller', 25],
      [fx.sellerB, 'platform', 15],
    ].sort((x, y) => x[0] - y[0]));

    const allocs = await allocations(fx.mixed);
    const shippingRows = allocs.filter((a) => a.allocationType === 'shipping');
    assert.equal(shippingRows.length, 1, 'only the seller who delivers is owed a delivery fee');
    assert.equal(Number(shippingRows[0].vendorId), fx.sellerA);
    assert.equal(Number(shippingRows[0].amount), 25);
    assert.equal(Number(shippingRows[0].platformFee), 0, 'no commission on the delivery fee');
    assert.equal(Number(shippingRows[0].payoutAmount), 25);
  });

  test('changing the setting applies to new orders only', async () => {
    const r = await call(updateVendorDeliverySettings, vendorReq(fx.sellerB, {}, { domesticDelivery: 'seller' }));
    assert.equal(r.code, 200, JSON.stringify(r.body));
    try {
      assert.equal((await parts(fx.mixed)).find((p) => p.vendorId === fx.sellerB).deliveredBy, 'platform', 'placed order unchanged');
      const o = await book([[fx.b100, 1]]);
      assert.equal(o.code, 201, JSON.stringify(o.body));
      assert.equal(Number(o.body.order.shippingCost), 40, "B now delivers, so B's own fee applies");
      assert.equal((await allocations(o.body.order.id)).filter((a) => a.allocationType === 'shipping').length, 1);
    } finally {
      await call(updateVendorDeliverySettings, vendorReq(fx.sellerB, {}, { domesticDelivery: 'platform' }));
    }
    const bad = await call(updateVendorDeliverySettings, vendorReq(fx.sellerB, {}, { internationalDelivery: 'dhl' }));
    assert.equal(bad.code, 400);
    const read = await call(getVendorDeliverySettings, vendorReq(fx.sellerB));
    assert.equal(read.body.domesticDelivery, 'platform');
    assert.equal(typeof read.body.hubAddress, 'string');
  });

  test('abroad: a seller who delivers must list the country; the platform decides for its own parcels', async () => {
    assert.equal(await svc.checkVendorDestination(fx.sellerA, 'DE'), false, 'A ships abroad themselves and lists no country');
    assert.equal(await svc.checkVendorDestination(fx.sellerB, 'DE'), true, 'the platform delivers B abroad');
  });

  test('a seller who delivers sees the full address; a hub seller sees no buyer contact details', async () => {
    const a = (await call(getVendorOrders, vendorReq(fx.sellerA))).body.find((o) => o.id === fx.mixed);
    assert.equal(a.delivery.deliveredBy, 'seller');
    assert.equal(a.shipping.address, '7 Palace Road');
    assert.equal(a.shipping.phone, '+233200000001');
    assert.equal(a.shipping.recipient, 'Ama Mensah');

    const b = (await call(getVendorOrders, vendorReq(fx.sellerB))).body.find((o) => o.id === fx.mixed);
    assert.equal(b.delivery.deliveredBy, 'platform');
    assert.equal(b.delivery.fee, 15);
    assert.equal(b.shipping.phone, null);
    assert.ok(!('address' in b.shipping) && !('recipient' in b.shipping));
  });

  test('hub parcel: seller packs and drops off, cannot ship; admin receives and moves only that parcel', async () => {
    await pool.execute(`UPDATE orders SET paymentStatus = 'paid', orderStatus = 'processing', paymentReference = ? WHERE id = ?`, [`DLVREF-${TS}`, fx.mixed]);
    const id = String(fx.mixed);

    const early = await call(handOverToHub, vendorReq(fx.sellerB, { id }));
    assert.equal(early.code, 400, 'must be packed first');

    const packed = await call(updateVendorOrderStatus, vendorReq(fx.sellerB, { id }, { orderStatus: 'packaging' }));
    assert.equal(packed.code, 200, JSON.stringify(packed.body));
    const ship = await call(updateVendorOrderStatus, vendorReq(fx.sellerB, { id }, { orderStatus: 'shipped' }));
    assert.equal(ship.code, 400);
    assert.equal(ship.body.code, 'PLATFORM_DELIVERS');

    const notMine = await call(handOverToHub, vendorReq(fx.sellerA, { id }));
    assert.equal(notMine.code, 400, 'A delivers themselves');

    const drop = await call(handOverToHub, vendorReq(fx.sellerB, { id }));
    assert.equal(drop.code, 200, JSON.stringify(drop.body));
    assert.ok((await parts(fx.mixed)).find((p) => p.vendorId === fx.sellerB).handedOverAt);

    const hub = await call(adminRoute('get', '/hub'), adminReq());
    assert.equal(hub.code, 200, JSON.stringify(hub.body));
    const parcel = hub.body.parcels.find((p) => p.orderId === fx.mixed);
    assert.ok(parcel, 'the hub list shows the parcel');
    assert.equal(parcel.vendorId, fx.sellerB);
    assert.equal(parcel.destination.address, '7 Palace Road');
    assert.ok(!hub.body.parcels.some((p) => p.orderId === fx.mixed && p.vendorId === fx.sellerA), "A's own parcel is not the hub's");

    // Admin moves B's parcel only: A's mark and the order consensus stay put.
    const adminShip = await call(updateVendorOrderStatus, {
      user: { id: fx.admin, role: 'admin' }, params: { id }, body: { orderStatus: 'shipped', vendorId: fx.sellerB, trackingNumber: 'HUB-1' },
    });
    assert.equal(adminShip.code, 200, JSON.stringify(adminShip.body));
    assert.equal(adminShip.body.consensus, 'processing', 'A has not moved');
    const [[markB]] = await pool.execute(`SELECT status, trackingNumber FROM order_vendor_marks WHERE orderId = ? AND vendorId = ?`, [fx.mixed, fx.sellerB]);
    assert.equal(markB.status, 'shipped');
    assert.equal(markB.trackingNumber, 'HUB-1');
    assert.ok((await parts(fx.mixed)).find((p) => p.vendorId === fx.sellerB).hubReceivedAt, 'shipping a hub parcel records its arrival at the hub');

    const stranger = await call(updateVendorOrderStatus, {
      user: { id: fx.admin, role: 'admin' }, params: { id }, body: { orderStatus: 'shipped', vendorId: fx.buyer },
    });
    assert.equal(stranger.code, 400);
  });

  test('admin sets the hub address; received is recorded once', async () => {
    const short = await call(adminRoute('put', '/hub/address'), adminReq({}, { hubAddress: 'x' }));
    assert.equal(short.code, 400);
    const before = (await call(adminRoute('get', '/hub'), adminReq())).body.hubAddress;
    try {
      const ok = await call(adminRoute('put', '/hub/address'), adminReq({}, { hubAddress: 'Hub, 12 Adum Street, Kumasi' }));
      assert.equal(ok.code, 200, JSON.stringify(ok.body));
      assert.equal((await call(getVendorDeliverySettings, vendorReq(fx.sellerB))).body.hubAddress, 'Hub, 12 Adum Street, Kumasi');
    } finally {
      await pool.execute(`UPDATE settings SET settingValue = ? WHERE settingKey = 'delivery.hubAddress'`, [before]);
    }
    // B's parcel was already received when it was shipped.
    const again = await call(adminRoute('post', '/hub/:orderId/:vendorId/received'), adminReq({ orderId: String(fx.mixed), vendorId: String(fx.sellerB) }));
    assert.equal(again.code, 404);
    const sellerParcel = await call(adminRoute('post', '/hub/:orderId/:vendorId/received'), adminReq({ orderId: String(fx.mixed), vendorId: String(fx.sellerA) }));
    assert.equal(sellerParcel.code, 404, "a seller-delivered parcel never passes through the hub");
  });

  test("a partial refund of a seller's goods leaves their delivery fee", async () => {
    await pool.execute(`UPDATE escrow_allocations SET status = 'held' WHERE orderId = ? AND status = 'pending'`, [fx.mixed]);
    await voidVendorEscrow(fx.mixed, fx.sellerA);
    const a = (await allocations(fx.mixed)).filter((r) => Number(r.vendorId) === fx.sellerA);
    assert.equal(a.find((r) => r.allocationType === 'shipping').status, 'held');
    assert.ok(a.filter((r) => r.allocationType !== 'shipping').every((r) => r.status === 'failed'));
  });
});
