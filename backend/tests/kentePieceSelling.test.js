// FILE LOCATION: backend/tests/kentePieceSelling.test.js
// DESCRIPTION: DB-backed. Kente is sold as the seller's packaged piece
//              (e.g. 6 yards for one price), like GTP wax print: the buyer
//              chooses only how many pieces. Proves, through the real
//              handlers:
//   - a seller must give the piece length, a description, the dominant
//     colours and the thread (and cannot blank them later);
//   - an order line records the piece length FROM THE PRODUCT, never a
//     yardage, colour or size the buyer's browser sent;
//   - the price is per piece whatever yardage the browser claims.
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

const { createVendorProduct, updateVendorProduct } = await import('../controllers/vendorController.js');
const { addOrderItems } = await import('../controllers/orderController.js');

const TS = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
const fx = { products: [], orders: [] };

const call = async (handler, req) => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler(req, res);
  return res;
};
const sellerReq = (body, params = {}) => ({ user: { id: fx.seller, role: 'vendor' }, params, body });
const piece = (over = {}) => ({
  title: `PIECE ${TS}`,
  img: '/images/image2.jpeg',
  price: 1000,
  category: 'Kente',
  yards: 6,
  stock: 4,
  description: 'Six yards of Sika Futuro, woven in Bonwire.',
  colors: ['Gold', 'Black'],
  threadTypes: ['Cotton'],
  ...over,
});

describe(`Kente sold as a packaged piece${dbAvailable ? '' : ' — SKIPPED: no database'}`, { skip: !dbAvailable }, () => {
  before(async () => {
    const mkUser = async (role, tag) => (await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
       VALUES ('PIECE', ?, ?, 'hashed', ?, 1, 1)`,
      [tag, `piece-${tag}-${TS}@test.local`, role],
    ))[0].insertId;
    fx.seller = await mkUser('vendor', 'seller');
    fx.buyer = await mkUser('customer', 'buyer');
    await pool.execute(`INSERT INTO vendors (userId, businessName, status) VALUES (?, ?, 'approved')`, [fx.seller, `PIECE ${TS}`]);
  });

  after(async () => {
    const del = async (sql, params) => { try { await pool.execute(sql, params); } catch (e) { console.warn('cleanup:', e.message); } };
    if (fx.orders.length) await del(`DELETE FROM orders WHERE id IN (${fx.orders.map(() => '?').join(',')})`, fx.orders);
    if (fx.products.length) await del(`DELETE FROM product WHERE id IN (${fx.products.map(() => '?').join(',')})`, fx.products);
    await del('DELETE FROM vendors WHERE userId = ?', [fx.seller]);
    await del('DELETE FROM users WHERE id IN (?, ?)', [fx.seller, fx.buyer]);
    await pool.end();
  });

  test('a seller must describe the piece: length, description, dominant colours and thread', async () => {
    const refused = [
      [{ description: '' }, /description/],
      [{ description: undefined }, /description/],
      [{ colors: [] }, /colours/],
      [{ colors: ['  '] }, /colours/],
      [{ threadTypes: [] }, /thread/],
      [{ yards: 0 }, /Length per piece/],
      [{ yards: 250 }, /Length per piece/],
      [{ yards: 'six' }, /Length per piece/],
    ];
    for (const [over, reason] of refused) {
      const r = await call(createVendorProduct, sellerReq(piece(over)));
      assert.equal(r.code, 400, JSON.stringify(over));
      assert.match(r.body.message, reason);
    }
    const [[{ n }]] = await pool.execute('SELECT COUNT(*) AS n FROM product WHERE vendorId = ?', [fx.seller]);
    assert.equal(Number(n), 0, 'nothing was created');

    const ok = await call(createVendorProduct, sellerReq(piece()));
    assert.equal(ok.code, 201, JSON.stringify(ok.body));
    fx.products.push(ok.body.product.id);
    assert.equal(Number(ok.body.product.yards), 6);
    assert.equal(Number(ok.body.product.stock), 4);
  });

  test('those details cannot be blanked later; other edits still work', async () => {
    const id = fx.products[0];
    for (const [over, reason] of [[{ description: ' ' }, /description/], [{ colors: [] }, /colours/], [{ threadTypes: [] }, /thread/], [{ yards: -6 }, /Length per piece/]]) {
      const r = await call(updateVendorProduct, sellerReq(over, { id: String(id) }));
      assert.equal(r.code, 400, JSON.stringify(over));
      assert.match(r.body.message, reason);
    }
    const ok = await call(updateVendorProduct, sellerReq({ stock: 3, yards: 12 }, { id: String(id) }));
    assert.equal(ok.code, 200, JSON.stringify(ok.body));
    const [[row]] = await pool.execute('SELECT stock, yards, description FROM product WHERE id = ?', [id]);
    assert.equal(Number(row.stock), 3);
    assert.equal(Number(row.yards), 12);
    assert.match(row.description, /Sika Futuro/);
  });

  test("an order line records the product's piece length and price, not what the browser sent", async () => {
    const id = fx.products[0];
    await pool.execute(`UPDATE product SET approvalStatus = 'approved' WHERE id = ?`, [id]);
    const r = await call(addOrderItems, {
      user: { id: fx.buyer, role: 'customer' },
      body: {
        items: [{ product: id, quantity: 2, yards: '2', size: '2', selectedSize: '2', selectedColor: 'Pink', price: 1 }],
        shippingAddress: { firstName: 'Ama', lastName: 'K', email: 'a@test.local', phone: '+233200000000', address: '1 Road', city: 'Kumasi', countryCode: 'GH' },
        paymentMethod: 'pending',
      },
    });
    assert.equal(r.code, 201, JSON.stringify(r.body));
    fx.orders.push(r.body.order.id);
    // Park it: other suites' unscoped abandoned-order sweeps must not touch it.
    await pool.execute(`UPDATE orders SET escrowStatus = 'releasing' WHERE id = ?`, [r.body.order.id]);
    const [[line]] = await pool.execute('SELECT qty, price, yards, selectedSize, selectedColor FROM order_items WHERE orderId = ?', [r.body.order.id]);
    assert.equal(Number(line.qty), 2);
    assert.equal(Number(line.price), 1000, 'price per piece from the product');
    assert.equal(Number(line.yards), 12, "the seller's piece length");
    assert.equal(line.selectedSize, null);
    assert.equal(line.selectedColor, null);
  });
});
