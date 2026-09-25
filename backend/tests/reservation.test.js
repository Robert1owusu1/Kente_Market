// FILE LOCATION: backend/tests/reservation.test.js
// DESCRIPTION: DB-backed tests for stock reservation (backend/Services/
//              reservationService.js + orderController integration). Verifies:
//   - reserveStockForItems deducts units atomically and only succeeds when stock
//     is available,
//   - a failed reservation returns a failure without corrupting stock,
//   - a paid order does NOT double-decrement its reserved units,
//   - releaseExpiredReservations returns abandoned units and zeroes the order's
//     reserved markers.
// NOTE: Uses the real (dev) database; inserts and cleans up after itself.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

let pool = null;
// DB gate: probe at module load (top-level await) so `{ skip: !dbAvailable }`
// is already correct when the tests are REGISTERED — a before() hook runs too
// late for that, and the suite would fail without a database (CI).
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

const state = { productId: null };
const ts = Date.now();

before(async () => {
  if (!dbAvailable || !pool) return;
  const [pRes] = await pool.execute(
    `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'approved')`,
    [`RESERVE ${ts}`, 'test.png', 10.0, 'test', 2, 240001]
  );
  state.productId = pRes.insertId;
});

after(async () => {
  if (!dbAvailable || !pool) return;
  try {
    await pool.execute(`DELETE FROM escrow_allocations WHERE orderId IN (SELECT id FROM orders WHERE notes = 'RESERVETEST')`);
    await pool.execute(`DELETE FROM orders WHERE notes = 'RESERVETEST'`);
    await pool.execute(`DELETE FROM product WHERE id = ?`, [state.productId]);
  } finally {
    await pool.end();
  }
});

describe('Stock reservation', () => {
  test('reserves exactly the available units, later requests fail cleanly', { skip: !dbAvailable }, async () => {
    const { reserveStockForItems } = await import('../Services/reservationService.js');

    const first = await reserveStockForItems([
      { productId: state.productId, quantity: 2, madeToOrder: false, stock: 2 },
    ]);
    assert.equal(first.reserved.get(state.productId), 2);
    assert.equal(first.failures.length, 0);

    const second = await reserveStockForItems([
      { productId: state.productId, quantity: 1, madeToOrder: false, stock: 0 },
    ]);
    assert.equal(second.reserved.size, 0, 'nothing reserved when stock is gone');
    assert.equal(second.failures.length, 1);
    assert.equal(second.failures[0].available, 0);
  });

  test('a paid order does NOT double-decrement fully reserved units', { skip: !dbAvailable }, async () => {
    const { decrementStockForOrder } = await import('../controllers/orderController.js');
    // Stock is currently 0 (reserved by the first test). Create the items the
    // way addOrderItems would after reserving: reserved === qty.
    const items = [{ product: state.productId, qty: 2, reserved: 2 }];
    const res = await decrementStockForOrder(items, null);
    assert.equal(Object.keys(res.decremented).length, 0, 'fully reserved -> nothing taken');
    assert.equal(res.shortfall, 0, 'no artificial shortfall from reserved units');
    const [[prod]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [state.productId]);
    assert.equal(Number(prod.stock), 0, 'stock stays 0, not -2');
  });

  test('partially reserved units are only taken for the unreserved remainder', { skip: !dbAvailable }, async () => {
    const { reserveStockForItems, releaseExpiredReservations } = await import('../Services/reservationService.js');
    const { decrementStockForOrder } = await import('../controllers/orderController.js');

    await pool.execute(`UPDATE product SET stock = 3 WHERE id = ?`, [state.productId]);
    const reserve = await reserveStockForItems([
      { productId: state.productId, quantity: 1, madeToOrder: false, stock: 3 },
    ]);
    assert.equal(reserve.reserved.get(state.productId), 1, 'reserved 1 of 3');

    // The paid order decrements the non-reserved remainder (2).
    const items = [{ product: state.productId, qty: 3, reserved: 1 }];
    const res = await decrementStockForOrder(items, null);
    assert.equal(res.decremented[state.productId], 2, 'only the 2 unreserved units taken');
    const [[prod]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [state.productId]);
    assert.equal(Number(prod.stock), 0, 'stock 3 -> 0 (1 reserved + 2 taken)');

    // Release the (now) abandoned reservation — nothing meaningful should return.
    await releaseExpiredReservations(0);
  });

  test('releaseExpiredReservations returns abandoned units and zeroes reserved markers', { skip: !dbAvailable }, async () => {
    const { releaseExpiredReservations } = await import('../Services/reservationService.js');

    await pool.execute(`UPDATE product SET stock = 0 WHERE id = ?`, [state.productId]);
    const items = [{ product: state.productId, qty: 2, reserved: 2, price: 10, vendorId: 240001 }];
    const [oRes] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentMethod, shippingAddress, billingAddress, shippingCost, tax, discount, notes, created_at)
       VALUES (?, ?, ?, ?, 'pending', 'pending', 'none', 'pending', '{}', '{}', 0, 0, 0, 'RESERVETEST', DATE_SUB(NOW(), INTERVAL 2 HOUR))`,
      [270001, `ORD-RESERVE-${ts}`, JSON.stringify(items), 20.0]
    );

    const released = await releaseExpiredReservations(0);
    assert.ok(released >= 1);

    const [[prod]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [state.productId]);
    assert.equal(Number(prod.stock), 2, 'abandoned units returned to the catalog');

    const [[ord]] = await pool.execute(`SELECT items FROM orders WHERE id = ?`, [oRes.insertId]);
    const parsed = Array.isArray(ord.items) ? ord.items : JSON.parse(ord.items || '[]');
    const anyReserved = parsed.some((it) => parseInt(it.reserved, 10) > 0);
    assert.equal(anyReserved, false, 'reserved markers zeroed so cancel cannot double-release');
  });

  test('releaseExpiredReservations skips orders that became paid', { skip: !dbAvailable }, async () => {
    const { releaseExpiredReservations } = await import('../Services/reservationService.js');

    await pool.execute(`UPDATE product SET stock = 0 WHERE id = ?`, [state.productId]);
    const items = [{ product: state.productId, qty: 1, reserved: 1, price: 10, vendorId: 240001 }];
    const [oRes] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentMethod, shippingAddress, billingAddress, shippingCost, tax, discount, notes, created_at)
       VALUES (?, ?, ?, ?, 'paid', 'processing', 'held', 'pending', '{}', '{}', 0, 0, 0, 'RESERVETEST', DATE_SUB(NOW(), INTERVAL 2 HOUR))`,
      [270001, `ORD-RESERVE-PAID-${ts}`, JSON.stringify(items), 10.0]
    );
    assert.ok(oRes.insertId, 'inserted the paid order');

    const released = await releaseExpiredReservations(0);
    const [[prod]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [state.productId]);
    assert.equal(Number(prod.stock), 0, 'paid order reservation is NOT released');
    assert.ok(released >= 0, 'expiry still ran without error');
  });
});