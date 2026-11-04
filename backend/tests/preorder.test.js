// FILE LOCATION: backend/tests/preorder.test.js
// DESCRIPTION: Pre-orders (Phase 3, Step 11). A vendor can flag a product as a
//   pre-order with a ship date; the flags persist and surface via the model.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

let pool = null;
let dbAvailable = true;
try { pool = (await import('../config/db.js')).default; await pool.query('SELECT 1'); } catch { dbAvailable = false; }

const { updateVendorProduct } = await import('../controllers/vendorController.js');

const readProduct = async (id) => {
  const [[row]] = await pool.query(`SELECT isPreorder, preorderAvailableOn, stock FROM product WHERE id = ?`, [id]);
  return row;
};

const TS = Date.now();
const fx = { vendorId: null, productId: null };
const mockRes = () => { const r = { statusCode: 200, body: undefined }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (p) => { r.body = p; return r; }; return r; };

after(async () => {
  if (!dbAvailable) return;
  if (fx.productId) await pool.query('DELETE FROM product WHERE id = ?', [fx.productId]).catch(() => {});
  if (fx.vendorId) await pool.query('DELETE FROM users WHERE id = ?', [fx.vendorId]).catch(() => {});
  await pool.end().catch(() => {});
});

describe('pre-orders', { skip: !dbAvailable }, () => {
  before(async () => {
    const [u] = await pool.query(`INSERT INTO users (firstName,lastName,email,password,role) VALUES ('Pre','Order',?, 'x','vendor')`, [`preorder_${TS}@t.local`]);
    fx.vendorId = u.insertId;
    const [p] = await pool.query(`INSERT INTO product (title,img,price,category,vendorId,approvalStatus,stock) VALUES ('Run Kente','r.jpg',150,'kente',?, 'approved', 48)`, [fx.vendorId]);
    fx.productId = p.insertId;
  });

  test('vendor flags a product as a pre-order with a ship date', async () => {
    const res = mockRes();
    await updateVendorProduct({
      user: { id: fx.vendorId, role: 'vendor' },
      params: { id: String(fx.productId) },
      body: { isPreorder: true, preorderAvailableOn: '2026-12-15' },
    }, res);
    assert.equal(res.statusCode, 200);

    const prod = await readProduct(fx.productId);
    assert.equal(prod.isPreorder, 1);
    assert.equal(String(new Date(prod.preorderAvailableOn).toISOString()).slice(0, 10), '2026-12-15');
    assert.equal(prod.stock, 48); // run size = stock, unchanged
  });

  test('clearing the flag turns a product back to normal', async () => {
    const res = mockRes();
    await updateVendorProduct({
      user: { id: fx.vendorId, role: 'vendor' },
      params: { id: String(fx.productId) },
      body: { isPreorder: false, preorderAvailableOn: '' },
    }, res);
    assert.equal(res.statusCode, 200);
    const prod = await readProduct(fx.productId);
    assert.equal(prod.isPreorder, 0);
    assert.equal(prod.preorderAvailableOn, null);
  });
});
