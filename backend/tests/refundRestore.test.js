// FILE LOCATION: backend/tests/refundRestore.test.js
// DESCRIPTION: P0-10 (return-approve restores stock like cancel does) + P0-9
// (fail-closed Paystack boot guard + custom-checkout key toast). DB-backed
// for the stock helper; source assertions for wiring/guards.
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
const state = {};

before(async () => {
  if (!dbAvailable || !pool) return;
  const [r] = await pool.execute(
    `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'approved')`,
    [`RESTORE ${ts}`, '/uploads/test.png', 20.0, 'test', 10, null]
  );
  state.productId = r.insertId;
  const [r2] = await pool.execute(
    `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'approved')`,
    [`RESTORE-MTO ${ts}`, '/uploads/test.png', 20.0, 'test', 0, null]
  );
  state.mtoProductId = r2.insertId;
});

after(async () => {
  if (!dbAvailable || !pool) return;
  try {
    await pool.execute(`DELETE FROM product WHERE id IN (?, ?)`, [state.productId, state.mtoProductId]);
  } finally {
    await pool.end();
  }
});

const stockOf = async (id) => {
  const [[row]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [id]);
  return parseInt(row.stock, 10);
};

describe('P0-10 return-approve stock restore', () => {
  test('restoreStockForOrder puts back paid-order qty, skips conflicts + made-to-order', { skip: !dbAvailable }, async () => {
    const { restoreStockForOrder } = await import('../controllers/orderController.js');
    assert.equal(await stockOf(state.productId), 10);
    // Paid-order shape: full qty restores.
    await restoreStockForOrder([{ product: state.productId, qty: 3 }]);
    assert.equal(await stockOf(state.productId), 13);
    // Conflict lines (never taken at payment) must NOT inflate stock.
    await restoreStockForOrder(
      [{ product: state.productId, qty: 5 }],
      { skipProductIds: new Set([state.productId]) }
    );
    assert.equal(await stockOf(state.productId), 13, 'skipped lines do not restore');
    // Made-to-order never restores.
    await restoreStockForOrder([{ product: state.mtoProductId, qty: 2 }]);
    assert.equal(await stockOf(state.mtoProductId), 0, 'made-to-order untouched');
    // Reset fixture.
    await pool.execute(`UPDATE product SET stock = 10 WHERE id = ?`, [state.productId]);
  });

  test('updateReturnStatus wires stock restore + coupon release', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(new URL('../controllers/returnController.js', import.meta.url), 'utf8');
    assert.match(src, /restoreStockForOrder\(order\.items, \{ skipProductIds \}\)/, 'restore wired on approve');
    assert.match(src, /Coupon\.decrementUses\(order\.couponId\)/, 'coupon release wired');
  });
});

describe('P0-9 fail-closed payment config', () => {
  test('server exits in production without PAYSTACK_SECRET_KEY', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(new URL('../server.js', import.meta.url), 'utf8');
    assert.match(src, /PAYSTACK_SECRET_KEY must be set in production/, 'guard message present');
    const guard = src.slice(src.indexOf('P0-9'));
    assert.match(guard.slice(0, 600), /process\.exit\(1\)/, 'guard exits');
  });

  test('custom-request checkout toasts on missing public key', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(
      new URL('../../src/Pages/CustomRequest/CustomRequestCheckout.tsx', import.meta.url), 'utf8'
    );
    assert.match(src, /Payment system not configured/, 'key guard toast present');
  });
});
