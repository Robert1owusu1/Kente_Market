// FILE LOCATION: backend/tests/reviewPurchaseGate.test.js
// DESCRIPTION: Pentest 2026-10-21 (F-2) — reviews are published at once, so
//              only a customer who bought and received the product may write
//              one. Before this, any account could rate any product (a seller
//              could inflate their own or sink a competitor's). DB-backed;
//              self-cleaning; skips without a database.
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

const TS = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
const fx = { orders: [] };

const call = async (handler, req) => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler(req, res);
  return res;
};

describe(`reviews need a delivered purchase${dbAvailable ? '' : ' — SKIPPED: no database'}`, { skip: !dbAvailable }, () => {
  let createReview;
  const review = (userId, body) => call(createReview, {
    user: { id: userId, role: 'customer', firstName: 'Rev', lastName: 'Test' },
    body: { productId: fx.product, rating: 5, comment: 'Beautiful weave', ...body },
  });
  const order = async (userId, paymentStatus, orderStatus) => {
    const [o] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress, paymentMethod, paymentStatus, orderStatus, escrowStatus)
       VALUES (?, ?, ?, 100, '{}', '{}', 'paystack', ?, ?, 'releasing')`,
      [userId, `REV-${TS}-${fx.orders.length}`, JSON.stringify([{ product: fx.product, qty: 1, price: 100, vendorId: fx.seller }]), paymentStatus, orderStatus]
    );
    fx.orders.push(o.insertId);
    return o.insertId;
  };

  before(async () => {
    ({ createReview } = await import('../controllers/reviewController.js'));
    const mkUser = async (role, tag) => (await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
       VALUES ('REV', ?, ?, 'hashed', ?, 1, 1)`,
      [tag, `rev-${tag}-${TS}@test.local`, role],
    ))[0].insertId;
    fx.seller = await mkUser('vendor', 'seller');
    fx.buyer = await mkUser('customer', 'buyer');
    fx.waiting = await mkUser('customer', 'waiting');
    fx.stranger = await mkUser('customer', 'stranger');
    await pool.execute(`INSERT INTO vendors (userId, businessName, status) VALUES (?, ?, 'approved')`, [fx.seller, `REV ${TS}`]);
    fx.product = (await pool.execute(
      `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
       VALUES (?, '/images/image2.jpeg', 100, 'Kente', 5, ?, 0, 'approved')`,
      [`REV ${TS}`, fx.seller],
    ))[0].insertId;
    fx.delivered = await order(fx.buyer, 'paid', 'delivered');
    await order(fx.waiting, 'paid', 'shipped');
  });

  after(async () => {
    const del = async (sql, params) => { try { await pool.execute(sql, params); } catch (e) { console.warn('cleanup:', e.message); } };
    await del('DELETE FROM reviews WHERE productId = ?', [fx.product]);
    if (fx.orders.length) await del(`DELETE FROM orders WHERE id IN (${fx.orders.map(() => '?').join(',')})`, fx.orders);
    await del('DELETE FROM product WHERE id = ?', [fx.product]);
    await del('DELETE FROM vendors WHERE userId = ?', [fx.seller]);
    await del('DELETE FROM users WHERE id IN (?, ?, ?, ?)', [fx.seller, fx.buyer, fx.waiting, fx.stranger]);
    await pool.end();
  });

  test('an account that never bought the product cannot review it', async () => {
    const r = await review(fx.stranger);
    assert.equal(r.code, 403);
    assert.equal(r.body.code, 'REVIEW_REQUIRES_PURCHASE');
  });

  test('a paid order that has not arrived yet does not qualify', async () => {
    const r = await review(fx.waiting);
    assert.equal(r.code, 403);
  });

  test('a seller cannot review their own product', async () => {
    const r = await review(fx.seller);
    assert.equal(r.code, 403);
    assert.match(r.body.message, /own products/);
  });

  test('over-long reviews are refused', async () => {
    const r = await review(fx.buyer, { comment: 'x'.repeat(2001) });
    assert.equal(r.code, 400);
  });

  test('a customer who received it can review, recorded as verified against that order', async () => {
    const r = await review(fx.buyer);
    assert.equal(r.code, 201, JSON.stringify(r.body));
    const [[row]] = await pool.execute(
      'SELECT isVerified, orderId, vendorId FROM reviews WHERE productId = ? AND userId = ?', [fx.product, fx.buyer]
    );
    assert.equal(Number(row.isVerified), 1);
    assert.equal(Number(row.orderId), fx.delivered);
    assert.equal(Number(row.vendorId), fx.seller);
    const [[{ n }]] = await pool.execute('SELECT COUNT(*) AS n FROM reviews WHERE productId = ?', [fx.product]);
    assert.equal(Number(n), 1, 'the refused attempts stored nothing');
  });
});
