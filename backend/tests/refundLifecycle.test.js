// FILE LOCATION: backend/tests/refundLifecycle.test.js
// DESCRIPTION: Refund-lifecycle gaps found in the 2026-10-12 local validation.
//   REF-ASYNC: Paystack refunds are asynchronous, but every refund path books
//     the order refunded when the refund REQUEST is accepted. refund.* webhooks
//     fell through to "Unhandled event", so a refund that later failed at the
//     provider left the customer unpaid with nobody told. Now: refund events are
//     recorded; refund.failed journals once and alerts admins once; duplicates
//     and unsigned deliveries change nothing.
//   REF-RELEASED: a refund after the vendor allocation was already paid out
//     ('released') cannot be clawed back automatically (R-6) and used to be
//     silent. Now it is recorded as needs_review and alerted once; the vendor
//     wallet and the allocation are left untouched (no invented debit policy).
// Paystack is never called: webhooks are signed locally, refunds are not issued.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.EMAIL_DISABLED = '1';
process.env.REDIS_URL = '';
process.env.JWT_SECRET ||= 'refund-lifecycle-secret-for-tests-only';
// Set BEFORE paymentRoutes is imported: the module captures it at load time.
process.env.PAYSTACK_SECRET_KEY ||= 'sk_test_refund_lifecycle_for_tests_only';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

const TS = `${Date.now()}${crypto.randomBytes(2).toString('hex')}`;
const sign = (raw) => crypto.createHmac('sha512', String(process.env.PAYSTACK_SECRET_KEY)).update(raw).digest('hex');
const fx = { admin: 0, buyer: 0, vendor: 0, vendor2: 0, orders: /** @type {number[]} */ ([]) };
let server = null;
let adminToken = '';

const notificationsFor = async (userId, titleLike) =>
  Number((await pool.execute(
    `SELECT COUNT(*) AS n FROM notifications WHERE userId = ? AND title LIKE ?`, [userId, titleLike]
  ))[0][0].n);

const mkOrder = async (ref, { paymentStatus = 'paid', orderStatus = 'processing', total = 120 } = {}) => {
  const [r] = await pool.execute(
    `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
       paymentMethod, paymentStatus, orderStatus, paymentReference)
     VALUES (?, ?, '[]', ?, '{}', '{}', 'paystack', ?, ?, ?)`,
    [fx.buyer, `RL-${TS}-${fx.orders.length}`, total, paymentStatus, orderStatus, ref]
  );
  fx.orders.push(r.insertId);
  return r.insertId;
};

describe('refund lifecycle gaps (REF-ASYNC, REF-RELEASED)', { skip: !dbAvailable && 'no database' }, () => {
  before(async () => {
    const mkUser = async (tag, role) => (await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
       VALUES ('RL', ?, ?, 'x', ?, 1, 1)`, [tag, `rl-${tag}-${TS}@example.test`, role]
    ))[0].insertId;
    fx.admin = await mkUser('admin', 'admin');
    fx.buyer = await mkUser('buyer', 'customer');
    fx.vendor = await mkUser('vendor', 'vendor');
    fx.vendor2 = await mkUser('vendor2', 'vendor');
    for (const v of [fx.vendor, fx.vendor2]) {
      await pool.execute(`INSERT INTO vendors (userId, businessName, status) VALUES (?, ?, 'approved')`, [v, `RL store ${v} ${TS}`]);
    }

    const express = (await import('express')).default;
    const paymentRoutes = (await import('../routes/paymentRoutes.js')).default;
    const { startServer } = await import('./helpers/httpHarness.js');
    const cookieParser = (await import('cookie-parser')).default;
    const adminOpsRoutes = (await import('../routes/adminOpsRoutes.js')).default;
    const { signUserToken } = await import('../utils/generateToken.js');
    adminToken = signUserToken({ id: fx.admin, role: 'admin', tokenVersion: 0 });
    const app = express();
    app.use(express.json({ verify: (req, res, buf) => { req.rawBody = Buffer.from(buf); } }));
    app.use(cookieParser());
    app.use('/api/payments', paymentRoutes);
    app.use('/api/admin/ops', adminOpsRoutes);
    server = await startServer(app);
  });

  after(async () => {
    if (server) await server.close();
    if (!pool) return;
    const ids = fx.orders.length ? fx.orders : [0];
    const users = [fx.admin, fx.buyer, fx.vendor, fx.vendor2];
    await pool.query(`DELETE FROM reconciliation_checks WHERE job = 'refundAfterRelease' AND entityId IN (?)`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM financial_events WHERE orderId IN (?) OR reference LIKE ?`, [ids, `rl_${TS}%`]).catch(() => {});
    await pool.query(`DELETE FROM webhook_events WHERE reference LIKE ?`, [`rl_${TS}%`]).catch(() => {});
    await pool.query(`DELETE FROM wallet_transactions WHERE vendorId IN (?)`, [[fx.vendor, fx.vendor2]]).catch(() => {});
    await pool.query(`DELETE FROM escrow_allocations WHERE orderId IN (?)`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM orders WHERE id IN (?)`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM notifications WHERE userId IN (?)`, [users]).catch(() => {});
    await pool.query(`DELETE FROM vendors WHERE userId IN (?)`, [[fx.vendor, fx.vendor2]]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id IN (?)`, [users]).catch(() => {});
    await pool.end().catch(() => {});
  });

  const deliver = async (payload, signature) => {
    const raw = JSON.stringify(payload);
    const res = await fetch(`${server.baseUrl}/api/payments/paystack-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature ?? sign(raw) },
      body: raw,
    });
    return { status: res.status, body: await res.text() };
  };

  test('REF-ASYNC: signed refund.failed journals once and alerts admins once; redelivery is a no-op', async () => {
    const ref = `rl_${TS}_failed`;
    const orderId = await mkOrder(ref, { paymentStatus: 'refunded', orderStatus: 'cancelled' });
    const event = { event: 'refund.failed', data: { transaction_reference: ref, refund_reference: 'RF1', amount: 12000, currency: 'GHS', status: 'failed' } };

    const first = await deliver(event);
    assert.equal(first.status, 200, first.body);
    const second = await deliver(event);
    assert.equal(second.status, 200);
    assert.equal(second.body, 'Duplicate ignored');

    const [fe] = await pool.execute(`SELECT eventType, amount, direction FROM financial_events WHERE orderId = ? AND eventType = 'refund.failed'`, [orderId]);
    assert.equal(fe.length, 1, 'journalled exactly once');
    assert.equal(Number(fe[0].amount), 120);
    assert.equal(fe[0].direction, 'info', 'a failed refund books no cash movement');
    assert.equal(await notificationsFor(fx.admin, 'Paystack refund FAILED%'), 1, 'one admin alert');
    const [[we]] = await pool.execute(`SELECT processing_status FROM webhook_events WHERE event = 'refund.failed' AND reference = ?`, [`${ref}:RF1`]);
    assert.equal(we.processing_status, 'processed');
    const [[o]] = await pool.execute(`SELECT paymentStatus, orderStatus FROM orders WHERE id = ?`, [orderId]);
    assert.deepEqual([o.paymentStatus, o.orderStatus], ['refunded', 'cancelled'], 'no automatic state change');
  });

  test('REF-ASYNC: refund.processed / refund.pending are recorded without alerts; unsigned refund.failed is rejected', async () => {
    const ref = `rl_${TS}_ok`;
    await mkOrder(ref, { paymentStatus: 'refunded', orderStatus: 'cancelled' });
    const before = await notificationsFor(fx.admin, 'Paystack refund FAILED%');
    for (const name of ['refund.pending', 'refund.processed', 'refund.processed']) {
      const r = await deliver({ event: name, data: { transaction_reference: ref, refund_reference: 'RF2', amount: 12000, currency: 'GHS' } });
      assert.equal(r.status, 200);
    }
    const [rows] = await pool.execute(`SELECT event FROM webhook_events WHERE reference = ? ORDER BY event`, [`${ref}:RF2`]);
    assert.deepEqual(rows.map((r) => r.event), ['refund.pending', 'refund.processed'], 'one receipt per event');

    const forged = await deliver({ event: 'refund.failed', data: { transaction_reference: ref, refund_reference: 'RF3', amount: 12000 } }, 'f'.repeat(128));
    assert.equal(forged.status, 400);
    const [none] = await pool.execute(`SELECT 1 FROM webhook_events WHERE reference = ?`, [`${ref}:RF3`]);
    assert.equal(none.length, 0, 'unsigned delivery leaves no trace');
    assert.equal(await notificationsFor(fx.admin, 'Paystack refund FAILED%'), before, 'no alert');
  });

  test('REF-RELEASED: refund after payout leaves the paid-out allocation and wallet alone, flags it once', async () => {
    const { voidEscrowForOrder } = await import('../Services/escrowService.js');
    const orderId = await mkOrder(`rl_${TS}_rel`, { paymentStatus: 'refunded', orderStatus: 'cancelled' });
    const [a1] = await pool.execute(
      `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFee, payoutAmount, status)
       VALUES (?, ?, 100, 10, 90, 'released')`, [orderId, fx.vendor]
    );
    const [a2] = await pool.execute(
      `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFee, payoutAmount, status)
       VALUES (?, ?, 20, 2, 18, 'held')`, [orderId, fx.vendor2]
    );
    const walletBefore = (await pool.execute(`SELECT COUNT(*) AS n FROM wallet_transactions WHERE vendorId = ?`, [fx.vendor]))[0][0].n;

    await voidEscrowForOrder(orderId);
    await voidEscrowForOrder(orderId); // retry / second refund path

    const [[rel]] = await pool.execute(`SELECT status FROM escrow_allocations WHERE id = ?`, [a1.insertId]);
    const [[held]] = await pool.execute(`SELECT status FROM escrow_allocations WHERE id = ?`, [a2.insertId]);
    assert.equal(rel.status, 'released', 'paid-out allocation is not rewritten');
    assert.equal(held.status, 'failed', 'held allocation is voided as before');
    const walletAfter = (await pool.execute(`SELECT COUNT(*) AS n FROM wallet_transactions WHERE vendorId = ?`, [fx.vendor]))[0][0].n;
    assert.equal(walletAfter, walletBefore, 'no vendor debit is invented (R-6 decision)');

    const [checks] = await pool.execute(
      `SELECT state, reviewReason, detail FROM reconciliation_checks WHERE job = 'refundAfterRelease' AND entityId = ?`, [orderId]
    );
    assert.equal(checks.length, 1, 'one review row per order');
    assert.deepEqual([checks[0].state, checks[0].reviewReason], ['needs_review', 'paid_out_before_refund']);
    assert.match(checks[0].detail, new RegExp(`allocation ${a1.insertId}\\b`));
    assert.doesNotMatch(checks[0].detail, new RegExp(`allocation ${a2.insertId}\\b`), 'only paid-out allocations are listed');
    assert.equal(await notificationsFor(fx.admin, 'Refund after vendor payout%'), 1, 'alerted once across both runs');

    // The admin review list shows it against the right order.
    const res = await fetch(`${server.baseUrl}/api/admin/ops/reconciliation-reviews?job=refundAfterRelease`, {
      headers: { cookie: `jwt=${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    const item = body.items.find((i) => Number(i.orderId) === orderId);
    assert.ok(item, 'listed in the admin review list');
    assert.equal(item.paymentStatus, 'refunded');
  });
});
