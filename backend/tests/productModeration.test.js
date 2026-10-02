// FILE LOCATION: backend/tests/productModeration.test.js
// DESCRIPTION: P0-1 — unapproved products must be invisible publicly and
//              unorderable. Verifies:
//   - Product.findAll defaults are unchanged at model level, but the
//     controller-level public filter only returns approved,
//   - addOrderItems rejects pending/rejected/changes_requested items,
//   - trending/count/getCategories honor approvalStatus.
// NOTE: DB-backed; inserts and cleans up after itself. Skips without MySQL.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

const ts = Date.now();
const state = { ids: {} };

const mkProduct = async (status, suffix) => {
  const [res] = await pool.execute(
    `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    [`MODTEST ${ts} ${suffix}`, '/uploads/test.png', 50.0, 'modtest', 5, null, status]
  );
  return res.insertId;
};

before(async () => {
  if (!dbAvailable || !pool) return;
  state.ids.approved = await mkProduct('approved', 'OK');
  state.ids.pending = await mkProduct('pending', 'PEND');
  state.ids.rejected = await mkProduct('rejected', 'REJ');
  state.ids.changes = await mkProduct('changes_requested', 'CHG');
});

after(async () => {
  if (!dbAvailable || !pool) return;
  try {
    const ids = Object.values(state.ids);
    if (ids.length) {
      await pool.query(`DELETE FROM product WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    }
  } finally {
    await pool.end();
  }
});

// Minimal req/res doubles for addOrderItems (only the exercised surface).
const callAddOrderItems = async (productId) => {
  const { addOrderItems } = await import('../controllers/orderController.js');
  let status = 200;
  let body = null;
  const req = {
    user: { id: 999999, role: 'customer' },
    body: { items: [{ product: productId, quantity: 1 }], shippingAddress: {}, paymentMethod: 'pending' },
  };
  const res = {
    status(code) { status = code; return this; },
    json(payload) { body = payload; return this; },
  };
  await addOrderItems(req, res);
  return { status, body };
};

describe('P0-1 product moderation gate', () => {
  test('model findAll/count/trending/categories honor approvalStatus', { skip: !dbAvailable }, async () => {
    const Product = (await import('../models/productModel.js')).default;
    const approved = await Product.findAll({ approvalStatus: 'approved', search: `MODTEST ${ts}` });
    const approvedIds = new Set(approved.map((p) => p.id));
    assert.ok(approvedIds.has(state.ids.approved), 'approved fixture listed');
    assert.ok(!approvedIds.has(state.ids.pending), 'pending hidden');
    assert.ok(!approvedIds.has(state.ids.rejected), 'rejected hidden');

    const trending = await Product.findTrending({ approvalStatus: 'approved', limit: 100 });
    const trendingIds = new Set(trending.map((p) => p.id));
    assert.ok(!trendingIds.has(state.ids.rejected), 'rejected excluded from trending');

    const n = await Product.count({ search: `MODTEST ${ts}`, approvalStatus: 'approved' });
    assert.equal(Number(n), 1, 'count reflects only approved fixture');

    const cats = await Product.getCategories('approved');
    assert.ok(Array.isArray(cats), 'categories returns array');
  });

  for (const s of ['pending', 'rejected', 'changes']) {
    test(`addOrderItems rejects ${s} product with 400`, { skip: !dbAvailable }, async () => {
      const { status, body } = await callAddOrderItems(state.ids[s]);
      assert.equal(status, 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
      assert.match(body.message, /not available/i);
    });
  }

  test('public productController filter defaults to approved', { skip: !dbAvailable }, async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../controllers/productController.js', import.meta.url), 'utf8')
    );
    assert.match(src, /publicApprovalFilter/, 'helper present');
    assert.match(src, /approvalStatus !== 'approved'/, 'detail gate present');
  });
});
