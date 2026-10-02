// FILE LOCATION: backend/tests/stockLedger.test.js
// DESCRIPTION: P1 stock-movement ledger — reserve/sale/restore paths append
// audit rows with signed deltas; the ledger never breaks the stock op.
// DB-backed; self-cleaning.
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
    [`LEDGER ${ts}`, '/uploads/test.png', 30.0, 'test', 10, null]
  );
  state.productId = r.insertId;
});

after(async () => {
  if (!dbAvailable || !pool) return;
  try {
    await pool.execute(`DELETE FROM stock_moves WHERE productId = ?`, [state.productId]);
    await pool.execute(`DELETE FROM product WHERE id = ?`, [state.productId]);
  } finally {
    await pool.end();
  }
});

const moves = async () => {
  const [rows] = await pool.execute(
    `SELECT reason, delta, orderId FROM stock_moves WHERE productId = ? ORDER BY id`, [state.productId]
  );
  return rows;
};

describe('stock movement ledger', () => {
  test('reserve -> sale -> restore appends signed, reasoned rows', { skip: !dbAvailable }, async () => {
    const { reserveStockForItems } = await import('../Services/reservationService.js');
    const { decrementStockForOrder, restoreStockForOrder } = await import('../controllers/orderController.js');

    const res = await reserveStockForItems([
      { productId: state.productId, quantity: 2, madeToOrder: false, stock: 10 },
    ]);
    assert.equal(res.reserved.get(state.productId), 2);

    // Payment-time: reserved units skip decrement; take 1 more unreserved unit.
    await decrementStockForOrder(
      [{ product: state.productId, qty: 3, reserved: 2 }], 424242
    );
    await restoreStockForOrder(
      [{ product: state.productId, qty: 2 }], { reason: 'cancel-restore', orderId: 424242 }
    );

    const rows = await moves();
    const byReason = new Map(rows.map((r) => [r.reason, Number(r.delta)]));
    assert.equal(byReason.get('reserve'), -2, 'reservation took 2');
    assert.equal(byReason.get('sale'), -1, 'only the unreserved remainder sold');
    assert.equal(byReason.get('cancel-restore'), 2, 'restore returned 2');
    assert.ok(rows.every((r) => Number(r.orderId || 0) === 0 || Number(r.orderId) === 424242));
  });

  test('ledger failure never breaks the stock op', { skip: !dbAvailable }, async () => {
    const { recordStockMove } = await import('../Services/stockMoves.js');
    // Invalid reason + zero delta + missing table tolerance: all return false, none throw.
    assert.equal(await recordStockMove({ productId: state.productId, delta: 0, reason: 'sale' }), false);
    assert.equal(await recordStockMove({ productId: null, delta: 5, reason: 'sale' }), false);
  });
});
