// FILE LOCATION: backend/tests/recoveryFairness.test.js
// DESCRIPTION: FV-6 (stale refund claims), FV-7 (stuck-pending recovery),
//              FV-8 (platform revenue reversal on refund).
//   FV-6/7: rows that never resolve used to fill every batch (LIMIT, no fair
//   ordering) and re-alert every run, starving genuine cases. Now: durable
//   per-order state in reconciliation_checks, due-only + never-checked-first
//   selection, back-off, one alert per reason, a queryable review list.
//   FV-8: a full refund writes one negated `refund` row per order (and a
//   journal entry); a bounded sweep backfills missing reversals.
//
// Isolation: both jobs scan the whole database and other suites call them
// concurrently with their own provider mocks. Fixtures here are FRESH rows
// (invisible to the default scans, which need rows 15 min / 1 h old) and every
// call is scoped to this file's order ids with the age threshold lowered —
// the same selection SQL (due filter, ordering, back-off) the scheduler runs.
// DISPOSABLE DATABASE ONLY.
import { describe, test, before, after, mock } from 'node:test';
import { assertDisposableDb } from './helpers/disposableDb.mjs';
import assert from 'node:assert/strict';

process.env.EMAIL_DISABLED = '1';
process.env.REDIS_URL = '';

let dbAvailable = true;
/** @type {any} */ let pool;
{
  pool = (await import('../config/db.js')).default;
  try { await pool.query('SELECT 1'); } catch { dbAvailable = false; }
}

/** @type {any} */ let paystackServices, axios, buildRefundClaim;
/** @type {any} */ let reconcileStaleRefundClaims, recoverStuckPendingOrders;
/** @type {any} */ let reversePlatformRevenueForRefund, reconcileRefundedPlatformRevenue, cancelOrder;
const TS = Date.now();
const fx = { users: [], orders: [] };
let seq = 0;

const mkUser = async (role = 'customer') => {
  const [r] = await pool.execute(
    `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
     VALUES ('Fair', 'Test', ?, 'x', ?, 1, 1)`, [`fair-${TS}-${++seq}@test.local`, role]);
  fx.users.push(r.insertId);
  return r.insertId;
};
const mkOrder = async (userId, { total = 100, paymentStatus = 'pending', orderStatus = 'pending', reference = null, items = '[]' } = {}) => {
  seq += 1;
  const [r] = await pool.execute(
    `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
       paymentMethod, paymentStatus, orderStatus, paymentReference, discount, shippingCost, tax, escrowStatus)
     VALUES (?, ?, ?, ?, '{}', '{}', 'paystack', ?, ?, ?, 0, 0, 0, 'none')`,
    [userId, `FAIR-${TS}-${seq}`, items, total, paymentStatus, orderStatus, reference ?? `FAIR-REF-${TS}-${seq}`]);
  fx.orders.push(r.insertId);
  return r.insertId;
};
/** A late-charge claim exactly as reconcileTerminalOrderCharge writes it. */
const mkStaleClaim = async (userId) => {
  const id = await mkOrder(userId, { paymentStatus: 'failed', orderStatus: 'cancelled' });
  const [[o]] = await pool.execute(`SELECT paymentReference FROM orders WHERE id = ?`, [id]);
  await pool.execute(`UPDATE orders SET refundReference = ? WHERE id = ?`, [buildRefundClaim(id, 'late-charge', o.paymentReference), id]);
  return { id, reference: o.paymentReference };
};
const check = async (job, id) =>
  (await pool.execute(`SELECT * FROM reconciliation_checks WHERE job = ? AND entityId = ?`, [job, id]))[0][0];
const alertRows = async (orderId) =>
  Number((await pool.execute(`SELECT COUNT(*) AS c FROM notifications WHERE message LIKE ? OR message LIKE ?`, [`Order #${orderId}:%`, `Order #${orderId} %`]))[0][0].c);
const makeDue = (job, ids) => pool.query(
  `UPDATE reconciliation_checks SET nextCheckAt = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE job = ? AND entityId IN (${ids.join(',')})`, [job]);

before(async () => {
  if (!dbAvailable) return;
  await assertDisposableDb(pool);
  await pool.query('SELECT entityId FROM reconciliation_checks LIMIT 0')
    .catch((e) => { throw new Error(`reconciliation_checks missing — run npm run db:migrate: ${e.message}`); });
  ({ default: paystackServices } = await import('../Services/paystackservices.js'));
  ({ default: axios } = await import('axios'));
  ({ buildRefundClaim } = await import('../utils/refundClaim.js'));
  ({ reconcileStaleRefundClaims } = await import('../Services/paymentReconciliationService.js'));
  ({ recoverStuckPendingOrders, reversePlatformRevenueForRefund, reconcileRefundedPlatformRevenue } = await import('../Services/escrowService.js'));
  ({ cancelOrder } = await import('../controllers/orderController.js'));
  await mkUser('admin'); // alert recipient
});

after(async () => {
  mock.restoreAll();
  if (dbAvailable) {
    const ids = fx.orders;
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      await pool.execute(`DELETE FROM reconciliation_checks WHERE entityId IN (${ph})`, ids).catch(() => {});
      await pool.execute(`DELETE FROM financial_events WHERE orderId IN (${ph})`, ids).catch(() => {});
      await pool.execute(`DELETE FROM platform_revenue WHERE orderId IN (${ph})`, ids).catch(() => {});
      await pool.execute(`DELETE FROM escrow_allocations WHERE orderId IN (${ph})`, ids).catch(() => {});
      await pool.execute(`DELETE FROM stock_moves WHERE orderId IN (${ph})`, ids).catch(() => {});
      await pool.execute(`DELETE FROM orders WHERE id IN (${ph})`, ids).catch(() => {});
    }
    for (const id of fx.users) {
      await pool.execute(`DELETE FROM notifications WHERE userId = ?`, [id]).catch(() => {});
      await pool.execute(`DELETE FROM users WHERE id = ?`, [id]).catch(() => {});
    }
  }
  await pool.end().catch(() => {});
});

describe('FV-6 stale refund claims: durable review state, fair rotation, one alert', { skip: !dbAvailable }, () => {
  test('claims that need a human are processed once, then wait their re-check interval', async () => {
    const buyer = await mkUser();
    const claims = [];
    for (let i = 0; i < 6; i += 1) claims.push(await mkStaleClaim(buyer));
    const ids = claims.map((c) => c.id);
    const verified = [];
    mock.method(paystackServices, 'verifyTransaction', async (ref) => {
      verified.push(ref);
      return { status: true, data: { status: 'failed', id: 1 } }; // charge not confirmed → needs a human
    });
    try {
      await reconcileStaleRefundClaims({ orderIds: ids, staleMinutes: 0, limit: 4 });
      assert.equal(verified.length, 4, 'bounded batch');
      await reconcileStaleRefundClaims({ orderIds: ids, staleMinutes: 0, limit: 4 });
      assert.equal(verified.length, 6, 'second run takes the two never checked — not the same four again');
      await reconcileStaleRefundClaims({ orderIds: ids, staleMinutes: 0, limit: 4 });
      assert.equal(verified.length, 6, 'nothing due: review rows wait their re-check interval');
      for (const id of ids) {
        const c = await check('staleRefundClaim', id);
        assert.equal(c.state, 'needs_review');
        assert.equal(c.reviewReason, 'charge_not_confirmed');
        assert.ok(new Date(c.nextCheckAt).getTime() - Date.now() > 5 * 3600 * 1000, 're-checked in ~6 h');
        assert.equal(await alertRows(id) > 0, true, 'operators were told');
      }
      // Due again (6 h later): re-checked, but the same reason is NOT re-alerted.
      const before = await Promise.all(ids.map(alertRows));
      await makeDue('staleRefundClaim', ids);
      await reconcileStaleRefundClaims({ orderIds: ids, staleMinutes: 0, limit: 10 });
      assert.equal(verified.length, 12);
      assert.deepEqual(await Promise.all(ids.map(alertRows)), before, 'no duplicate alerts within 24 h');
      const [[cnt]] = await pool.execute(
        `SELECT COUNT(*) AS c FROM reconciliation_checks WHERE job = 'staleRefundClaim' AND state = 'needs_review' AND entityId IN (${ids.join(',')})`);
      assert.equal(Number(cnt.c), 6, 'durable, queryable review list');
    } finally {
      mock.restoreAll();
    }
  });

  test('a resolvable claim is not starved by a backlog of review rows', async () => {
    const buyer = await mkUser();
    const backlog = [];
    for (let i = 0; i < 5; i += 1) backlog.push(await mkStaleClaim(buyer));
    const genuine = await mkStaleClaim(buyer);
    const ids = [...backlog.map((c) => c.id), genuine.id];
    const [[g]] = await pool.execute(`SELECT totalAmount FROM orders WHERE id = ?`, [genuine.id]);
    mock.method(paystackServices, 'verifyTransaction', async (ref) => (ref === genuine.reference
      ? { status: true, data: { status: 'success', id: 777000 + genuine.id, amount: Math.round(Number(g.totalAmount) * 100) } }
      : { status: true, data: { status: 'failed', id: 1 } }));
    mock.method(paystackServices, 'listRefunds', async () => ({
      data: [{ transaction: 777000 + genuine.id, status: 'processed', amount: Math.round(Number(g.totalAmount) * 100), id: 5 }],
    }));
    mock.method(paystackServices, 'refundTransaction', async () => { throw new Error('must not re-issue'); });
    try {
      // Backlog checked once and made due again, so it competes with the new claim.
      await reconcileStaleRefundClaims({ orderIds: backlog.map((c) => c.id), staleMinutes: 0, limit: 10 });
      await makeDue('staleRefundClaim', backlog.map((c) => c.id));
      await reconcileStaleRefundClaims({ orderIds: ids, staleMinutes: 0, limit: 1 });
      const [[o]] = await pool.execute(`SELECT paymentStatus FROM orders WHERE id = ?`, [genuine.id]);
      assert.equal(o.paymentStatus, 'refunded', 'never-checked claim goes first and is finalized');
      assert.equal((await check('staleRefundClaim', genuine.id)).state, 'resolved');
    } finally {
      mock.restoreAll();
    }
  });
});

describe('FV-7 stuck-pending recovery: back-off and fairness', { skip: !dbAvailable }, () => {
  /** axios.get stub: refs in `paid` succeed at their amount, others are abandoned. */
  const stubVerify = (paid, calls) => mock.method(axios, 'get', async (url) => {
    const ref = decodeURIComponent(String(url).split('/').pop());
    calls.push(ref);
    const hit = paid.get(ref);
    return { data: { status: true, data: hit ? { status: 'success', amount: hit.amount, currency: hit.currency ?? 'GHS', reference: ref } : { status: 'abandoned', reference: ref } } };
  });

  test('abandoned checkouts back off; a newly paid order is recovered ahead of them', async () => {
    const buyer = await mkUser();
    const abandoned = [];
    for (let i = 0; i < 6; i += 1) abandoned.push(await mkOrder(buyer));
    const calls = [];
    const paid = new Map();
    stubVerify(paid, calls);
    try {
      await recoverStuckPendingOrders({ orderIds: abandoned, minAgeMinutes: 0, limit: 4 });
      await recoverStuckPendingOrders({ orderIds: abandoned, minAgeMinutes: 0, limit: 4 });
      assert.equal(calls.length, 6, 'second run covers the two never checked');
      const c0 = await check('stuckPending', abandoned[0]);
      assert.equal(c0.state, 'waiting');
      assert.equal(c0.reviewReason, 'provider_abandoned');
      const gap0 = (new Date(c0.nextCheckAt).getTime() - new Date(c0.lastCheckedAt).getTime()) / 60000;
      assert.ok(gap0 >= 29 && gap0 <= 31, `first back-off ≈ 30 min (got ${gap0})`);
      await makeDue('stuckPending', abandoned);
      await recoverStuckPendingOrders({ orderIds: abandoned, minAgeMinutes: 0, limit: 10 });
      const c1 = await check('stuckPending', abandoned[0]);
      const gap1 = (new Date(c1.nextCheckAt).getTime() - new Date(c1.lastCheckedAt).getTime()) / 60000;
      assert.ok(gap1 >= 59 && gap1 <= 61, `back-off doubles (got ${gap1})`);

      // A genuinely paid order arrives while the backlog is due again.
      const paidOrder = await mkOrder(buyer, { total: 70 });
      const [[po]] = await pool.execute(`SELECT paymentReference FROM orders WHERE id = ?`, [paidOrder]);
      paid.set(po.paymentReference, { amount: 7000 });
      await makeDue('stuckPending', abandoned);
      await recoverStuckPendingOrders({ orderIds: [...abandoned, paidOrder], minAgeMinutes: 0, limit: 1 });
      const [[o]] = await pool.execute(`SELECT paymentStatus FROM orders WHERE id = ?`, [paidOrder]);
      assert.equal(o.paymentStatus, 'paid', 'never-checked order first: recovered in the first slot');
      assert.equal((await check('stuckPending', paidOrder)).state, 'resolved');
    } finally {
      mock.restoreAll();
    }
  });

  test('a successful charge that does not match the order is a durable review item, alerted once', async () => {
    const buyer = await mkUser();
    const id = await mkOrder(buyer, { total: 500 });
    const [[o]] = await pool.execute(`SELECT paymentReference FROM orders WHERE id = ?`, [id]);
    const calls = [];
    stubVerify(new Map([[o.paymentReference, { amount: 100 }]]), calls);
    try {
      await recoverStuckPendingOrders({ orderIds: [id], minAgeMinutes: 0 });
      const c = await check('stuckPending', id);
      assert.equal(c.state, 'needs_review');
      assert.equal(c.reviewReason, 'charge_amount_mismatch');
      const [[row]] = await pool.execute(`SELECT paymentStatus FROM orders WHERE id = ?`, [id]);
      assert.equal(row.paymentStatus, 'pending', 'never marked paid on a mismatched charge');
      const alerted = await alertRows(id);
      assert.ok(alerted > 0);
      await makeDue('stuckPending', [id]);
      await recoverStuckPendingOrders({ orderIds: [id], minAgeMinutes: 0 });
      assert.equal(calls.length, 2);
      assert.equal(await alertRows(id), alerted, 'not re-alerted');
    } finally {
      mock.restoreAll();
    }
  });
});

describe('FV-8 platform revenue reversal on refund', { skip: !dbAvailable }, () => {
  const revenue = async (orderId) =>
    (await pool.execute(`SELECT source, amount, grossAmount, discountAmount FROM platform_revenue WHERE orderId = ? ORDER BY source`, [orderId]))[0];

  test('a full refund writes one negated reversal; net platform revenue is zero; idempotent', async () => {
    const buyer = await mkUser();
    const id = await mkOrder(buyer, { paymentStatus: 'refunded', orderStatus: 'cancelled' });
    await pool.execute(
      `INSERT INTO platform_revenue (orderId, amount, grossAmount, discountAmount, source) VALUES (?, 90, 100, 10, 'platform_product')`, [id]);
    assert.equal(await reversePlatformRevenueForRefund(id, 'test'), true);
    assert.equal(await reversePlatformRevenueForRefund(id, 'test'), false, 'second call is a no-op');
    const rows = await revenue(id);
    assert.deepEqual(rows.map((r) => [r.source, Number(r.amount), Number(r.grossAmount), Number(r.discountAmount)]),
      [['platform_product', 90, 100, 10], ['refund', -90, -100, -10]]);
    assert.equal(rows.reduce((s, r) => s + Number(r.amount), 0), 0, 'net platform revenue');
    const [[j]] = await pool.execute(`SELECT COUNT(*) AS c, MAX(amount) AS a FROM financial_events WHERE dedupeKey = ?`, [`platform_revenue.reversed:${id}`]);
    assert.equal(Number(j.c), 1);
    assert.equal(Number(j.a), 90);
  });

  test('no revenue booked (vendor-only order / late charge) → nothing reversed', async () => {
    const buyer = await mkUser();
    const id = await mkOrder(buyer, { paymentStatus: 'refunded', orderStatus: 'cancelled' });
    assert.equal(await reversePlatformRevenueForRefund(id, 'test'), false);
    assert.equal((await revenue(id)).length, 0);
  });

  test('the sweep backfills refunded orders missing a reversal, once', async () => {
    const buyer = await mkUser();
    const id = await mkOrder(buyer, { paymentStatus: 'refunded', orderStatus: 'cancelled' });
    await pool.execute(`INSERT INTO platform_revenue (orderId, amount, grossAmount, discountAmount, source) VALUES (?, 40, 40, 0, 'platform_product')`, [id]);
    const paidId = await mkOrder(buyer, { paymentStatus: 'paid', orderStatus: 'processing' });
    await pool.execute(`INSERT INTO platform_revenue (orderId, amount, grossAmount, discountAmount, source) VALUES (?, 40, 40, 0, 'platform_product')`, [paidId]);
    let guard = 0;
    while ((await revenue(id)).length < 2 && guard++ < 50) await reconcileRefundedPlatformRevenue({ limit: 100 });
    assert.equal((await revenue(id)).find((r) => r.source === 'refund')?.amount * 1, -40);
    assert.equal((await revenue(paidId)).length, 1, 'paid orders are never reversed');
    await reconcileRefundedPlatformRevenue({ limit: 100 });
    assert.equal((await revenue(id)).filter((r) => r.source === 'refund').length, 1);
  });

  test('admin cancel of a paid order with platform lines reverses its revenue', async () => {
    const buyer = await mkUser();
    const id = await mkOrder(buyer, { paymentStatus: 'paid', orderStatus: 'processing', total: 60 });
    await pool.execute(`INSERT INTO platform_revenue (orderId, amount, grossAmount, discountAmount, source) VALUES (?, 60, 60, 0, 'platform_product')`, [id]);
    mock.method(paystackServices, 'refundTransaction', async () => ({ status: true, message: 'mock refund', data: { status: 'pending' } }));
    try {
      const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
      await cancelOrder({ params: { id: String(id) }, body: { reason: 'test' }, user: { id: fx.users[0], role: 'admin', email: 'a@test.local' }, headers: {}, ip: '127.0.0.1', get: () => undefined }, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      const [[o]] = await pool.execute(`SELECT paymentStatus FROM orders WHERE id = ?`, [id]);
      assert.equal(o.paymentStatus, 'refunded');
      const rows = await revenue(id);
      assert.equal(rows.reduce((s, r) => s + Number(r.amount), 0), 0, 'net platform revenue after a refunded cancel');
    } finally {
      mock.restoreAll();
    }
  });
});

describe('durable review list endpoint', { skip: !dbAvailable }, () => {
  test('GET /api/admin/ops/reconciliation-reviews is admin-only, validated, and lists review items', async () => {
    const express = (await import('express')).default;
    const cookieParser = (await import('cookie-parser')).default;
    const jwt = (await import('jsonwebtoken')).default;
    const { default: adminOpsRoutes } = await import('../routes/adminOpsRoutes.js');
    const { errorHandeler } = await import('../middleware/errorMiddleware.js');
    const { startServer } = await import('./helpers/httpHarness.js');
    const app = express();
    app.use(cookieParser());
    app.use('/api/admin/ops', adminOpsRoutes);
    app.use(errorHandeler);
    const srv = await startServer(app);
    const admin = await mkUser('admin');
    const customer = await mkUser();
    const tok = (id) => jwt.sign({ id, tv: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const get = (path, id) => fetch(`${srv.baseUrl}${path}`, { headers: id ? { cookie: `jwt=${tok(id)}` } : {} });
    try {
      const claim = await mkStaleClaim(customer);
      mock.method(paystackServices, 'verifyTransaction', async () => ({ status: true, data: { status: 'failed', id: 1 } }));
      await reconcileStaleRefundClaims({ orderIds: [claim.id], staleMinutes: 0 });
      mock.restoreAll();
      assert.equal((await get('/api/admin/ops/reconciliation-reviews')).status, 401);
      assert.equal((await get('/api/admin/ops/reconciliation-reviews', customer)).status, 403);
      assert.equal((await get('/api/admin/ops/reconciliation-reviews?job=drop%20table', admin)).status, 400);
      assert.equal((await get('/api/admin/ops/reconciliation-reviews?state=everything', admin)).status, 400);
      const list = await (await get('/api/admin/ops/reconciliation-reviews?job=staleRefundClaim', admin)).json();
      const item = list.items.find((i) => Number(i.orderId) === claim.id);
      assert.ok(item, 'the stale claim is on the review list');
      assert.equal(item.reviewReason, 'charge_not_confirmed');
      assert.equal(item.paymentStatus, 'failed');
    } finally {
      mock.restoreAll();
      await srv.close();
    }
  });
});
