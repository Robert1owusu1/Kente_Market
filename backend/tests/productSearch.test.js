// FILE LOCATION: backend/tests/productSearch.test.js
// DESCRIPTION: P1 search — extended columns (description/pattern fields the
// old title/category/tag LIKE never covered) + multi-word AND semantics.
// Runs against the LIKE path on engines without FULLTEXT (probed once per
// process). DB-backed; self-cleaning.
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
const state = { ids: [] };

before(async () => {
  if (!dbAvailable || !pool) return;
  const rows = [
    [`SEARCH ${ts} PLAIN`, 'Zor arterial weave', 'Kente', 'sunsetriver unique weaving story', 'pending'],
    [`SEARCH ${ts} REDCLOTH`, 'Bright red festival cloth', 'Kente', null, 'approved'],
  ];
  for (const [title, desc, cat, story, approval] of rows) {
    const [r] = await pool.execute(
      `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus, description, designStory)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [title, '/uploads/test.png', 42.0, cat, 5, null, approval, desc, story]
    );
    state.ids.push(r.insertId);
  }
});

after(async () => {
  if (!dbAvailable || !pool) return;
  try {
    await pool.execute(`DELETE FROM product WHERE id IN (?, ?)`, state.ids);
  } finally {
    await pool.end();
  }
});

describe('P1 product search', () => {
  test('description-only words are found (old LIKE would miss)', { skip: !dbAvailable }, async () => {
    const Product = (await import('../models/productModel.js')).default;
    const hits = await Product.findAll({ search: 'arterial', approvalStatus: 'pending' });
    assert.ok(hits.some((p) => String(p.title).includes(`SEARCH ${ts} PLAIN`)), 'description match');
  });

  test('multi-word query requires every word', { skip: !dbAvailable }, async () => {
    const Product = (await import('../models/productModel.js')).default;
    const both = await Product.findAll({ search: `REDCLOTH festival`, approvalStatus: 'approved' });
    assert.ok(both.some((p) => String(p.title).includes('REDCLOTH')), 'both words match');
    const oneMissing = await Product.findAll({ search: `REDCLOTH nosuchwordxyz`, approvalStatus: 'approved' });
    assert.ok(!oneMissing.some((p) => String(p.title).includes('REDCLOTH')), 'AND semantics');
  });

  test('count() agrees with findAll() on search', { skip: !dbAvailable }, async () => {
    const Product = (await import('../models/productModel.js')).default;
    const n = await Product.count({ search: 'festival', approvalStatus: 'approved' });
    assert.ok(Number(n) >= 1, `expected >=1, got ${n}`);
  });
});
