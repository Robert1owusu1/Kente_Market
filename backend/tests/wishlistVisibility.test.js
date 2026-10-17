// FILE LOCATION: backend/tests/wishlistVisibility.test.js
// DESCRIPTION: DB-backed. The wishlist must not be a side door to products the
//              public storefront hides. POST /api/wishlist used to accept any
//              product id and GET /api/wishlist returned title, image and price
//              for every saved row, so a signed-in user could read a pending
//              listing or a suspended vendor's product. Both now apply the
//              product page's rule: approvalStatus 'approved' AND (approved
//              vendor OR platform product). Skips itself without a database.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.EMAIL_DISABLED = '1';
process.env.REDIS_URL = '';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

const { addToWishlist, getMyWishlist } = await import('../controllers/wishlistController.js');

const TS = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
const fx = { users: [], products: {} };

const call = async (handler, req) => {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler(req, res);
  return res;
};
const shopper = () => ({ id: fx.users[0], role: 'customer' });

describe(`wishlist only exposes publicly visible products${dbAvailable ? '' : ' — SKIPPED: no database'}`, { skip: !dbAvailable }, () => {
  before(async () => {
    for (const role of ['customer', 'vendor', 'vendor']) {
      const [u] = await pool.execute(
        `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
         VALUES ('WISH', ?, ?, 'hashed', ?, 1, 1)`,
        [role, `wish-${role}-${TS}-${fx.users.length}@test.local`, role],
      );
      fx.users.push(u.insertId);
    }
    const [, approvedVendor, suspendedVendor] = fx.users;
    await pool.execute(`INSERT INTO vendors (userId, businessName, status) VALUES (?, ?, 'approved')`, [approvedVendor, `WISH OK ${TS}`]);
    await pool.execute(`INSERT INTO vendors (userId, businessName, status) VALUES (?, ?, 'suspended')`, [suspendedVendor, `WISH SUSP ${TS}`]);
    for (const [key, vendorId, approval] of [
      ['visible', approvedVendor, 'approved'],
      ['platform', null, 'approved'],
      ['pending', approvedVendor, 'pending'],
      ['suspendedVendor', suspendedVendor, 'approved'],
    ]) {
      const [p] = await pool.execute(
        `INSERT INTO product (title, img, price, category, stock, vendorId, approvalStatus)
         VALUES (?, '/images/image2.jpeg', 100.0, 'Kente', 5, ?, ?)`,
        [`WISH ${key} ${TS}`, vendorId, approval],
      );
      fx.products[key] = p.insertId;
    }
  });

  after(async () => {
    const del = async (sql, params) => { try { await pool.execute(sql, params); } catch (e) { console.warn('cleanup:', e.message); } };
    await del('DELETE FROM wishlist WHERE userId = ?', [fx.users[0]]);
    const ids = Object.values(fx.products);
    if (ids.length) await del(`DELETE FROM product WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    for (const v of fx.users.slice(1)) await del('DELETE FROM vendors WHERE userId = ?', [v]);
    if (fx.users.length) await del(`DELETE FROM users WHERE id IN (${fx.users.map(() => '?').join(',')})`, fx.users);
    await pool.end();
  });

  test('visible products can be saved; hidden ones are refused as not found', async () => {
    for (const key of ['visible', 'platform']) {
      const r = await call(addToWishlist, { user: shopper(), body: { productId: fx.products[key] } });
      assert.equal(r.statusCode, 201, `${key}: ${JSON.stringify(r.body)}`);
    }
    for (const key of ['pending', 'suspendedVendor']) {
      const r = await call(addToWishlist, { user: shopper(), body: { productId: fx.products[key] } });
      assert.equal(r.statusCode, 404, `${key} must not be saveable`);
    }
    const [[{ n }]] = await pool.execute('SELECT COUNT(*) AS n FROM wishlist WHERE userId = ?', [fx.users[0]]);
    assert.equal(Number(n), 2);
  });

  test('a saved product that becomes hidden drops out of the list, and returns when visible again', async () => {
    // Saved while visible (e.g. before the vendor was suspended).
    await pool.execute('INSERT IGNORE INTO wishlist (userId, productId) VALUES (?, ?)', [fx.users[0], fx.products.suspendedVendor]);
    await pool.execute('INSERT IGNORE INTO wishlist (userId, productId) VALUES (?, ?)', [fx.users[0], fx.products.pending]);

    const r = await call(getMyWishlist, { user: shopper() });
    assert.equal(r.statusCode, 200);
    const listed = r.body.map((row) => row.productId).sort();
    assert.deepEqual(listed, [fx.products.visible, fx.products.platform].sort());
    assert.ok(!JSON.stringify(r.body).includes(`WISH pending ${TS}`), 'a pending title leaked');
    assert.ok(!JSON.stringify(r.body).includes(`WISH suspendedVendor ${TS}`), 'a suspended vendor title leaked');

    await pool.execute(`UPDATE vendors SET status = 'approved' WHERE userId = ?`, [fx.users[2]]);
    const again = await call(getMyWishlist, { user: shopper() });
    assert.ok(again.body.some((row) => row.productId === fx.products.suspendedVendor), 'visible again once the vendor is reinstated');
  });
});
