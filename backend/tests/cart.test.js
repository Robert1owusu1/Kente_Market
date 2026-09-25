// FILE LOCATION: backend/tests/cart.test.js
// DESCRIPTION: DB-backed tests for server-side cart persistence and merge logic
//              (models/cartModel.js). Verifies:
//   - an empty cart returns nothing on first fetch,
//   - saved items round-trip correctly,
//   - merge correctly deduplicates and sums quantities,
//   - clear empties the stored cart.
// NOTE: Uses the real (dev) database; inserts and cleans up after itself.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

let pool = null;
// DB gate: probe at module load (top-level await) so `{ skip: !dbAvailable }`
// below is already correct when the tests are REGISTERED — a before() hook
// runs too late for that and the suite would fail without a database (CI).
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

const GUEST_ID = `test-cart-${Date.now()}`;
const userId = 270001; // existing customer in dev DB

after(async () => {
  if (!dbAvailable || !pool) return;
  try {
    await pool.execute(`DELETE FROM carts WHERE guestId = ?`, [GUEST_ID]);
    await pool.execute(`DELETE FROM carts WHERE userId = ?`, [userId]);
  } finally {
    await pool.end();
  }
});

describe('Server-side cart', () => {
  test('returns empty for a brand-new guest', { skip: !dbAvailable }, async () => {
    const { default: Cart } = await import('../models/cartModel.js');
    const found = await Cart.findByOwner({ userId: null, guestId: GUEST_ID });
    assert.ok(!found, 'no cart should exist yet');
  });

  test('saves items and retrieves them', { skip: !dbAvailable }, async () => {
    const { default: Cart } = await import('../models/cartModel.js');
    const items = [{ product: 1, name: 'Kente', qty: 2, price: 10 }];
    await Cart.save({ userId: null, guestId: GUEST_ID, items });
    const found = await Cart.findByOwner({ userId: null, guestId: GUEST_ID });
    assert.ok(found, 'cart should now exist');
    assert.equal(found.items.length, 1);
    assert.equal(found.items[0].product, 1);
    assert.equal(found.items[0].qty, 2);
  });

  test('merge combines incoming and existing items, summing quantities', { skip: !dbAvailable }, async () => {
    const { default: Cart } = await import('../models/cartModel.js');
    const existing = [{ product: 1, name: 'Kente', qty: 1, price: 10 }];
    const incoming = [
      { product: 1, name: 'Kente', qty: 2, price: 10 },
      { product: 2, name: 'Fugu', qty: 1, price: 20 },
    ];
    const merged = Cart.merge(existing, incoming);
    assert.equal(merged.length, 2);
    const kente = merged.find((m) => m.product === 1);
    const fugu = merged.find((m) => m.product === 2);
    assert.equal(kente.quantity, 3, 'product 1 quantities should be summed');
    assert.equal(fugu.quantity, 1, 'new product should be appended');
  });

  test('clear empties the stored cart', { skip: !dbAvailable }, async () => {
    const { default: Cart } = await import('../models/cartModel.js');
    await Cart.save({ userId: null, guestId: GUEST_ID, items: [{ product: 1, qty: 1, price: 10 }] });
    await Cart.clear({ userId: null, guestId: GUEST_ID });
    const found = await Cart.findByOwner({ userId: null, guestId: GUEST_ID });
    assert.ok(!found, 'cart row should be deleted');
  });
});