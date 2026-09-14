// FILE LOCATION: backend/tests/stockRace.test.js
// DESCRIPTION: DB-backed regression tests for the oversell/race-condition fix
//              (backend/controllers/orderController.js). Verifies that when more
//              buyers pay than units are in stock, the atomic conditional
//              decrement lets exactly "stock" buyers take units, the rest get
//              flagged as stock conflicts on their order, stock never goes
//              negative, the right parties are notified, and a cancelled order
//              only restores stock that was actually taken.
// NOTE: Uses the real (dev) database, so it inserts then cleans up after itself.
//       If the DB is unreachable, tests are skipped instead of failing (so CI
//       without a DB can still run the pure-logic suites).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

let pool = null;
let dbAvailable = true;

/** @type {{ productId?: number; orderIds: number[] }} */
const state = { productId: null, orderIds: [] };
const ts = Date.now();

before(async () => {
  try {
    pool = (await import('../config/db.js')).default;
    await pool.query('SELECT 1');
  } catch {
    dbAvailable = false;
    return;
  }

  const [pRes] = await pool.execute(
    `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'approved')`,
    [`STOCKRACE ${ts}`, 'test.png', 10.0, 'test', 2, 240001]
  );
  state.productId = pRes.insertId;

  for (let i = 0; i < 5; i++) {
    const items = [{ product: state.productId, qty: 1, price: 10, vendorId: 240001, isCustomizable: 0, productionTime: 1 }];
    const [oRes] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, paymentMethod, shippingAddress, billingAddress, shippingCost, tax, discount, notes)
       VALUES (?, ?, ?, ?, 'pending', 'processing', 'pending', '{}', '{}', 0, 0, 0, 'STOCKRACE')`,
      [270001, `ORD-STOCKRACE-${i}-${ts}`, JSON.stringify(items), 10.0]
    );
    state.orderIds.push(oRes.insertId);
  }
});

after(async () => {
  if (!dbAvailable || !pool) return;
  try {
    for (const oid of state.orderIds) {
      await pool.execute(`DELETE FROM escrow_allocations WHERE orderId = ?`, [oid]);
      await pool.execute(`DELETE FROM orders WHERE id = ?`, [oid]);
    }
    if (state.productId) {
      await pool.execute(`DELETE FROM product WHERE id = ?`, [state.productId]);
    }
    await pool.execute(
      `DELETE FROM notifications
       WHERE title LIKE 'Stock shortage%' OR title LIKE 'Sold more than%' OR title LIKE 'Confirming your stock%'`
    );
  } finally {
    await pool.end();
  }
});

const itemsFor = () => [{ product: state.productId, qty: 1, price: 10, vendorId: 240001, isCustomizable: 0, productionTime: 1 }];

describe('Oversell protection under a purchase race (5 buyers vs stock=2)', () => {
  test('exactly 2 concurrent decrements take stock, 3 are flagged as conflicts', { skip: !dbAvailable }, async () => {
    const { decrementStockForOrder } = await import('../controllers/orderController.js');
    const results = await Promise.all(
      state.orderIds.map((oid) => decrementStockForOrder(itemsFor(), oid))
    );

    const wins = results.filter((r) => Object.keys(r.decremented).length > 0).length;
    const conflicts = results.filter((r) => r.conflicts.length > 0).length;
    const totalShortfall = results.reduce((n, r) => n + r.shortfall, 0);

    assert.equal(wins, 2, 'exactly two buyers should get the two units');
    assert.equal(conflicts, 3, 'three buyers must be flagged, not silently oversold');
    assert.equal(totalShortfall, 3);
  });

  test('product stock lands exactly on 0 (never negative)', { skip: !dbAvailable }, async () => {
    const [[prod]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [state.productId]);
    assert.equal(Number(prod.stock), 0);
  });

  test('the 3 losing orders are flagged with stockShortfall, 2 winning orders are not', { skip: !dbAvailable }, async () => {
    const [rows] = await pool.execute(
      `SELECT id, stockShortfall FROM orders WHERE id IN (${state.orderIds.join(',')})`
    );
    const flagged = rows.filter((r) => Number(r.stockShortfall) > 0);
    const clean = rows.filter((r) => Number(r.stockShortfall) === 0);
    assert.equal(flagged.length, 3);
    assert.equal(clean.length, 2);
    for (const r of flagged) assert.equal(Number(r.stockShortfall), 1);
  });

  test('admin, vendor and customer are each notified about the shortages', { skip: !dbAvailable }, async () => {
    const [notifs] = await pool.execute(
      `SELECT DISTINCT userId FROM notifications
       WHERE (title LIKE 'Stock shortage%' OR title LIKE 'Sold more than%' OR title LIKE 'Confirming your stock%')
         AND created_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)`
    );
    const users = new Set(notifs.map((n) => n.userId));
    assert.ok(users.has(30001), 'an admin must be notified');
    assert.ok(users.has(240001), 'the vendor must be notified');
    assert.ok(users.has(270001), 'the customer must be notified');
  });

  test('cancelling a flagged order does NOT inflate stock (conflicted units are skipped)', { skip: !dbAvailable }, async () => {
    const { restoreStockForOrder } = await import('../controllers/orderController.js');
    const [[flagged]] = await pool.execute(
      `SELECT id FROM orders WHERE id IN (${state.orderIds.join(',')}) AND stockShortfall > 0 LIMIT 1`
    );
    const [[ord]] = await pool.execute(`SELECT stockConflicts FROM orders WHERE id = ?`, [flagged.id]);
    const conflicts = Array.isArray(ord.stockConflicts) ? ord.stockConflicts : JSON.parse(ord.stockConflicts || '[]');
    const skip = new Set(conflicts.map((c) => c.productId));

    const [[before]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [state.productId]);
    await restoreStockForOrder(itemsFor(), { skipProductIds: skip });
    const [[after]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [state.productId]);

    assert.equal(Number(after.stock), Number(before.stock), 'stock must stay 0 — the failed unit was never taken');
  });

  test('restore WITHOUT skip adds the units back (paid+taken order cancelled)', { skip: !dbAvailable }, async () => {
    const { decrementStockForOrder, restoreStockForOrder } = await import('../controllers/orderController.js');
    // Top the product back up to 1, then take it, then restore it.
    await pool.execute(`UPDATE product SET stock = 1 WHERE id = ?`, [state.productId]);

    const [oRes] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, paymentMethod, shippingAddress, billingAddress, shippingCost, tax, discount, notes)
       VALUES (?, ?, ?, ?, 'pending', 'processing', 'pending', '{}', '{}', 0, 0, 0, 'STOCKRACE')`,
      [270001, `ORD-STOCKRACE-R-${ts}`, JSON.stringify(itemsFor()), 10.0]
    );
    try {
      const res = await decrementStockForOrder(itemsFor(), oRes.insertId);
      assert.equal(Object.keys(res.decremented).length, 1, 'unit taken');
      const [[midway]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [state.productId]);
      assert.equal(Number(midway.stock), 0);

      await restoreStockForOrder(itemsFor());
      const [[after]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [state.productId]);
      assert.equal(Number(after.stock), 1, 'restored on cancel');
    } finally {
      await pool.execute(`DELETE FROM orders WHERE id = ?`, [oRes.insertId]);
    }
  });
});