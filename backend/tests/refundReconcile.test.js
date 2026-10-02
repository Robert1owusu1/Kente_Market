// FILE LOCATION: backend/tests/refundReconcile.test.js
// DESCRIPTION: P1 refund crash reconciler — an order stuck "paid" with a
// refund marker + refund journal (crash between provider-accept and flip)
// gets escrow voided + status flipped + journaled, exactly once. A marker
// WITHOUT a journal (outcome unknown) changes no money, only alerts.
// DB-backed; cleans up after itself.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.EMAIL_DISABLED = '1';

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
  const User = (await import('../models/usersModel.js')).default;
  const mk = (tag, role) => User.create({
    firstName: 'Recon', lastName: tag, email: `recon-${tag}-${ts}@example.com`,
    password: 'Test1234x', role, legalConsentAccepted: true,
  });
  const buyer = await mk('buyer', 'customer');
  const vendor = await mk('vendor', 'vendor');
  const admin = await mk('admin', 'admin');
  Object.assign(state, { buyer: buyer.id, vendor: vendor.id, admin: admin.id });

  const mkOrder = async (tag, marker) => {
    const [r] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
        paymentMethod, paymentStatus, orderStatus, paymentReference, escrowStatus, refundReference)
       VALUES (?, ?, ?, ?, ?, ?, 'paystack', 'paid', 'processing', ?, 'held', ?)`,
      [buyer.id, `RECON-${ts}-${tag}`, JSON.stringify([{ product: 1, qty: 1, price: 100, vendorId: vendor.id }]),
       245, '{}', '{}', `RECONREF-${ts}-${tag}`, marker]
    );
    return r.insertId;
  };
  // Crashed AFTER provider accept: marker + journal present.
  state.journaledOrder = await mkOrder('J', `refund:0:RECONREF-${ts}-J`);
  await pool.execute(
    `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status)
     VALUES (?, ?, 90, 0.1, 10, 90, 'held')`,
    [state.journaledOrder, vendor.id]
  );
  const { recordFinancialEvent } = await import('../Services/ledgerService.js');
  await recordFinancialEvent({
    eventType: 'refund', direction: 'out', amount: 245, orderId: state.journaledOrder,
    reference: `RECONREF-${ts}-J`, dedupeKey: `refund:${state.journaledOrder}`,
    payload: { reason: 'test crash simulation' },
  });
  // Attempt threw (outcome unknown): marker, no journal.
  state.unknownOrder = await mkOrder('U', `refund:0:RECONREF-${ts}-U`);
  await pool.execute(
    `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status)
     VALUES (?, ?, 90, 0.1, 10, 90, 'held')`,
    [state.unknownOrder, vendor.id]
  );
});

after(async () => {
  if (!dbAvailable || !pool) return;
  try {
    for (const oid of [state.journaledOrder, state.unknownOrder].filter(Boolean)) {
      await pool.execute(`DELETE FROM escrow_allocations WHERE orderId = ?`, [oid]);
      await pool.execute(`DELETE FROM financial_events WHERE orderId = ?`, [oid]);
      await pool.execute(`DELETE FROM orders WHERE id = ?`, [oid]);
    }
    await pool.execute(`DELETE FROM notifications WHERE userId = ?`, [state.admin]);
    await pool.execute(`DELETE FROM users WHERE id IN (?, ?, ?)`, [state.buyer, state.vendor, state.admin]);
  } finally {
    await pool.end();
  }
});

describe('reconcileRefundedButPaid', () => {
  test('journaled crash: escrow voided, order refunded, journaled once', { skip: !dbAvailable }, async () => {
    const { reconcileRefundedButPaid } = await import('../Services/escrowService.js');
    const n = await reconcileRefundedButPaid();
    assert.ok(n >= 2, `expected both fixtures handled, got ${n}`);

    const [[order]] = await pool.execute(`SELECT paymentStatus FROM orders WHERE id = ?`, [state.journaledOrder]);
    assert.equal(order.paymentStatus, 'refunded', 'books completed');
    const [[alloc]] = await pool.execute(`SELECT status FROM escrow_allocations WHERE orderId = ?`, [state.journaledOrder]);
    assert.equal(alloc.status, 'failed', 'held escrow voided so vendor is not also paid');
    const [[j]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM financial_events WHERE dedupeKey = ?`, [`refund.reconciled:${state.journaledOrder}`]
    );
    assert.equal(Number(j.n), 1, 'reconcile journaled exactly once');

    // Idempotent re-run: nothing left to do.
    const n2 = await reconcileRefundedButPaid();
    const [[order2]] = await pool.execute(`SELECT paymentStatus FROM orders WHERE id = ?`, [state.journaledOrder]);
    assert.equal(order2.paymentStatus, 'refunded');
    assert.ok(n2 <= 1, 'second run only sees the unknown fixture (or nothing)');
  });

  test('unknown outcome: money untouched, admin alerted', { skip: !dbAvailable }, async () => {
    const [[order]] = await pool.execute(`SELECT paymentStatus, escrowStatus FROM orders WHERE id = ?`, [state.unknownOrder]);
    assert.equal(order.paymentStatus, 'paid', 'no automatic flip without proof');
    assert.equal(order.escrowStatus, 'held', 'no automatic void without proof');
    const [[alloc]] = await pool.execute(`SELECT status FROM escrow_allocations WHERE orderId = ?`, [state.unknownOrder]);
    assert.equal(alloc.status, 'held', 'allocation untouched');
    const [[note]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM notifications WHERE userId = ? AND title LIKE 'Refund outcome unknown%'`,
      [state.admin]
    );
    assert.ok(Number(note.n) >= 1, 'admin alerted to verify in dashboard');
  });
});
