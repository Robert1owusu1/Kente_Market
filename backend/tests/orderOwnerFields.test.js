// FILE LOCATION: backend/tests/orderOwnerFields.test.js
// DESCRIPTION: SEC-1 — PUT /api/orders/:id strips owner-forbidden fields with a
//   denylist. expectedCompletionDate and productionNote were missing from it,
//   so a buyer could rewrite the vendor's promised completion date and progress
//   note on their own order. Admins may still set them; notes stay writable.
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

const TS = Date.now();
const fx = { buyer: null, order: null };
let updateOrder;

const mockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};

describe('order owner cannot write vendor-owned fields (SEC-1)', { skip: !dbAvailable }, () => {
  before(async () => {
    fx.buyer = (await pool.execute(
      `INSERT INTO users (email, password, firstName, lastName, role, is_email_verified)
       VALUES (?, 'x', 'OOF', 'buyer', 'customer', 1)`, [`oof-${TS}@example.com`]
    ))[0].insertId;
    fx.order = (await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
         paymentMethod, paymentStatus, orderStatus, expectedCompletionDate, productionNote)
       VALUES (?, ?, '[]', 50, '{}', '{}', 'paystack', 'paid', 'processing', '2030-01-15', 'warp prepared')`,
      [fx.buyer, `OOF-${TS}`]
    ))[0].insertId;
    ({ updateOrder } = await import('../controllers/orderController.js'));
  });

  after(async () => {
    if (!dbAvailable) return;
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [fx.order]).catch(() => {});
    await pool.execute(`DELETE FROM users WHERE id = ?`, [fx.buyer]).catch(() => {});
    await pool.end();
  });

  test('buyer update keeps the vendor completion date and production note', async () => {
    const res = mockRes();
    await updateOrder({
      params: { id: String(fx.order) },
      body: { notes: 'please call first', expectedCompletionDate: '2026-01-01', productionNote: 'DONE (forged)' },
      user: { id: fx.buyer, role: 'customer' },
    }, res);
    assert.ok(res.statusCode < 400, `update refused: ${res.statusCode} ${JSON.stringify(res.body)}`);
    const [[row]] = await pool.execute(
      `SELECT DATE_FORMAT(expectedCompletionDate, '%Y-%m-%d') AS d, productionNote, notes FROM orders WHERE id = ?`, [fx.order]
    );
    assert.equal(row.d, '2030-01-15', 'promised completion date unchanged');
    assert.equal(row.productionNote, 'warp prepared', 'vendor progress note unchanged');
    assert.equal(row.notes, 'please call first', 'the buyer may still edit their own notes');
  });

  test('buyer update with only forbidden fields is a 400, not a 500', async () => {
    // Every key is stripped for an owner, which used to reach Order.update with
    // nothing to write and surface its "No valid fields to update" as a 500.
    const snap = `SELECT totalAmount, paymentStatus, orderStatus, escrowReleaseDeadline FROM orders WHERE id = ?`;
    const [[before]] = await pool.execute(snap, [fx.order]);
    const res = mockRes();
    await updateOrder({
      params: { id: String(fx.order) },
      body: { totalAmount: 1, paymentStatus: 'refunded', orderStatus: 'delivered', escrowReleaseDeadline: '2000-01-01' },
      user: { id: fx.buyer, role: 'customer' },
    }, res);
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
    const [[after]] = await pool.execute(snap, [fx.order]);
    assert.deepEqual(after, before, 'nothing written');
  });
});
