// FILE LOCATION: backend/tests/paymentLateCharge.test.js
// DESCRIPTION: Late-charge reconciliation + verify-paystack authorization.
//
// A charge can settle AFTER the order behind it was cancelled (or refunded
// through the return path). Before this suite's subject existed, three
// verified bugs lived in exactly that window:
//
//   1. The webhook's paid-flip UPDATE could never match a terminal order, so
//      the handler fell into the "order not yet created" retry loop, answered
//      500 forever, and the captured funds were dropped with no refund and no
//      reconciliation record. (Fixed: reconcileTerminalOrderCharge pushes a
//      real Paystack refund through the shared refundReference claim.)
//   2. verify-paystack checked order ownership ONLY on the unpaid branch, so
//      any authenticated user could post a reference whose order was already
//      paid and read the payer's Paystack customer block (email/name/phone).
//      (Fixed: ownership is enforced whenever an order is bound, and the
//      customer block is never echoed to unproven callers.)
//   3. A refunded order whose orderStatus had not been moved to a terminal
//      value could be flipped back to 'paid' by a repeated verification
//      (`paymentStatus != 'paid'` admits 'refunded'). (Fixed: the flip is now
//      `paymentStatus IN ('pending','failed')` on every path.)
//
// Everything here runs against real HTTP with the HMAC computed exactly as
// Paystack computes it, and axios fully stubbed — no test may ever reach the
// live provider, place a charge, or issue a real refund.
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.EMAIL_DISABLED = '1';
// Same REDIS_URL guard as paystackReferenceGuard/otpResend/redteam-final:
// an empty string (not delete) so rateLimitMiddleware's dotenv pass leaves it
// alone, and no open redis socket keeps `node --test` alive past the summary.
process.env.REDIS_URL = '';
process.env.JWT_SECRET ||= 'late-charge-secret-for-tests-only-not-a-key';
// Set BEFORE paymentRoutes is imported: the module captures the secret at
// module scope and the webhook HMAC is computed with it.
process.env.PAYSTACK_SECRET_KEY ||= 'sk_test_late_charge_secret_for_tests_only';

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
const SIGNATURE = (rawBody) =>
  crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');

const state = { userA: null, userB: null, tokenA: null, tokenB: null };
let server = null;
let verifyCalls = [];   // axios.get URLs (Paystack verify)
let refundCalls = [];   // axios.post {url, payload}
// Per-reference behavior for the verify stub: ref -> Paystack transaction.
let verifyStub = new Map();
// Scripted refund outcomes: reference -> array of booleans consumed per call.
let refundScript = new Map();

const fixtureIds = [];

describe('late charge on a terminal order is reconciled, never dropped', { skip: !dbAvailable }, () => {
  before(async () => {
    if (!dbAvailable || !pool) return;

    const User = (await import('../models/usersModel.js')).default;
    const userA = await User.create({
      firstName: 'Late', lastName: 'chargeA', email: `late-charge-a-${ts}@example.com`,
      password: 'Test1234x', role: 'customer', legalConsentAccepted: true,
    });
    const userB = await User.create({
      firstName: 'Late', lastName: 'chargeB', email: `late-charge-b-${ts}@example.com`,
      password: 'Test1234x', role: 'customer', legalConsentAccepted: true,
    });
    state.userA = userA.id;
    state.userB = userB.id;

    const { signUserToken } = await import('../utils/generateToken.js');
    state.tokenA = signUserToken(userA);
    state.tokenB = signUserToken(userB);

    const express = (await import('express')).default;
    const cookieParser = (await import('cookie-parser')).default;
    const paymentRoutes = (await import('../routes/paymentRoutes.js')).default;
    const { startServer } = await import('./helpers/httpHarness.js');

    const app = express();
    // Raw body capture, byte-for-byte identical to server.js:234-237 — the
    // webhook HMAC must be computed over the same bytes Paystack signed.
    app.use(express.json({ verify: (req, res, buf) => { req.rawBody = Buffer.from(buf); } }));
    app.use(cookieParser());
    app.use('/api/payments', paymentRoutes);
    app.use((err, req, res, next) => {
      const status = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
      res.status(status).json({ message: err.message });
    });
    server = await startServer(app);

    const { default: axios } = await import('axios');
    verifyCalls = [];
    refundCalls = [];
    mock.method(axios, 'get', async (url) => {
      verifyCalls.push(String(url));
      const ref = String(url).split('/transaction/verify/')[1] || '';
      const tx = verifyStub.get(ref);
      return { data: tx ? { status: true, data: tx } : { status: false, data: null } };
    });
    mock.method(axios, 'post', async (url, payload) => {
      refundCalls.push({ url: String(url), payload });
      const reference = payload?.transaction;
      const script = refundScript.get(reference);
      const ok = script && script.length > 0 ? script.shift() : true;
      if (!ok) {
        // refundTransaction rethrows with the provider message; shape matches.
        const err = new Error('simulated provider outage');
        err.response = { data: { message: 'Refund could not be processed right now' } };
        throw err;
      }
      return { data: { status: true, data: { transaction: reference, amount: payload?.amount ?? null } } };
    });
  });

  after(async () => {
    mock.restoreAll();
    if (server) await server.close();
    if (dbAvailable && pool) {
      for (const id of fixtureIds) {
        try {
          await pool.execute('DELETE FROM financial_events WHERE orderId = ?', [id]);
          await pool.execute('DELETE FROM webhook_events WHERE reference IN (SELECT paymentReference FROM orders WHERE id = ?)', [id]);
          await pool.execute('DELETE FROM escrow_allocations WHERE orderId = ?', [id]);
          await pool.execute('DELETE FROM orders WHERE id = ?', [id]);
        } catch (err) {
          console.error(`paymentLateCharge cleanup FAILED for order ${id}: ${err.message}`);
        }
      }
    }
    if (dbAvailable && pool && state.userA) {
      try {
        await pool.execute('DELETE FROM users WHERE id IN (?, ?)', [state.userA, state.userB]);
      } catch (err) {
        console.error(`paymentLateCharge user cleanup FAILED: ${err.message}`);
      }
    }
    if (pool) {
      try { await pool.end(); } catch { /* already closed */ }
    }
    try {
      const { getRedisClient } = await import('../utils/redisClient.js');
      const redis = getRedisClient();
      if (redis) {
        await Promise.race([
          redis.quit().catch(() => Promise.resolve()),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
        redis.disconnect();
      }
    } catch { /* Redis not configured — nothing to close */ }
  });

  // ---- fixtures -----------------------------------------------------------

  /** A CANCELLED order whose charge is about to settle late. */
  const mkCancelledOrder = async (tag, totalGhs, ownerUserId = null) => {
    const reference = `LATE-${tag}-${ts}`;
    const [r] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
        paymentMethod, paymentStatus, orderStatus, paymentReference, created_at)
       VALUES (?, ?, '[]', ?, '{}', '{}', 'paystack', 'pending', 'cancelled', ?,
               DATE_SUB(NOW(), INTERVAL 10 MINUTE))`,
      [ownerUserId ?? state.userA, `LATEFIX-${tag}-${ts}`, totalGhs, reference]
    );
    fixtureIds.push(r.insertId);
    verifyStub.set(reference, {
      status: 'success', reference, amount: Math.round(totalGhs * 100),
      currency: 'GHS', channel: 'card', paid_at: new Date().toISOString(),
      customer: { email: 'payer-secret@example.com', name: 'Secret Payer' },
    });
    return { id: r.insertId, reference };
  };

  const postWebhook = async ({ rawBody, signature }) => {
    const res = await fetch(`${server.baseUrl}/api/payments/paystack-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature },
      body: rawBody,
    });
    return { status: res.status, text: await res.text() };
  };

  /** Build a signed charge.success delivery for `reference` at `amountKobo`. */
  const chargeSuccessDelivery = (reference, amountKobo, event = 'charge.success') => {
    const rawBody = JSON.stringify({
      event,
      data: { reference, amount: amountKobo, currency: 'GHS', status: 'success' },
    });
    return { rawBody, signature: SIGNATURE(rawBody) };
  };

  const postVerify = async (reference, token) => {
    const res = await fetch(`${server.baseUrl}/api/payments/verify-paystack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `jwt=${token}` },
      body: JSON.stringify({ reference }),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep status-only */ }
    return { status: res.status, text, json };
  };

  const getOrder = async (id) => {
    const [[row]] = await pool.execute(
      `SELECT paymentStatus, orderStatus, refundReference FROM orders WHERE id = ?`, [id]
    );
    return row;
  };

  // ---- webhook reconciliation ---------------------------------------------

  test('webhook: verified charge on a cancelled order refunds the customer instead of looping', async () => {
    const { id, reference } = await mkCancelledOrder('WEBHOOK', 100.00);
    const refundsBefore = refundCalls.filter((c) => c.payload?.transaction === reference).length;

    const r = await postWebhook(chargeSuccessDelivery(reference, 10000));
    assert.equal(r.status, 200, `expected 200 so Paystack stops redelivering, got ${r.status}: ${r.text}`);

    const refunds = refundCalls.filter((c) => c.payload?.transaction === reference);
    assert.equal(refunds.length, refundsBefore + 1, 'exactly one refund must be pushed for the late charge');
    assert.ok(refunds[0].url.endsWith('/refund'), `refund went to unexpected URL ${refunds[0].url}`);

    const order = await getOrder(id);
    assert.equal(order.paymentStatus, 'refunded', 'the cancelled order records the money going back');
    assert.equal(order.orderStatus, 'cancelled', 'the order is NEVER resurrected to processing');

    const [[ev]] = await pool.execute(
      `SELECT processing_status FROM webhook_events WHERE event = 'charge.success' AND reference = ?`,
      [reference]
    );
    assert.equal(ev.processing_status, 'processed', 'the event is terminally processed — no retry storm');

    const [[journal]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM financial_events WHERE orderId = ? AND eventType = 'refund' AND dedupeKey = ?`,
      [id, `refund:${id}`]
    );
    assert.equal(journal.n, 1, 'the refund is journaled once under the shared full-refund dedupe key');
  });

  test('webhook: a duplicate delivery of the same charge does not refund twice', async () => {
    const { id, reference } = await mkCancelledOrder('DUP', 120.00);
    await postWebhook(chargeSuccessDelivery(reference, 12000));
    const refundsAfterFirst = refundCalls.filter((c) => c.payload?.transaction === reference).length;
    assert.equal(refundsAfterFirst, 1, 'precondition: one refund after the first delivery');

    const dup = await postWebhook(chargeSuccessDelivery(reference, 12000));
    assert.equal(dup.status, 200);
    assert.match(dup.text, /Duplicate ignored/i, 'a processed event must be acknowledged, not reprocessed');
    const refundsAfterDup = refundCalls.filter((c) => c.payload?.transaction === reference).length;
    assert.equal(refundsAfterDup, 1, 'the duplicate delivery must not push a second refund');

    const order = await getOrder(id);
    assert.equal(order.paymentStatus, 'refunded');
  });

  test('webhook: an invalid signature is rejected before anything moves', async () => {
    const { id, reference } = await mkCancelledOrder('BADSIG', 130.00);
    const delivery = chargeSuccessDelivery(reference, 13000);
    const r = await postWebhook({ ...delivery, signature: SIGNATURE(delivery.rawBody + 'tampered') });
    assert.equal(r.status, 400);
    assert.match(r.text, /Invalid signature/i);

    const order = await getOrder(id);
    assert.equal(order.paymentStatus, 'pending', 'a forged webhook must not touch the order');
    assert.equal(refundCalls.filter((c) => c.payload?.transaction === reference).length, 0,
      'a forged webhook must not push a refund');
    const [[ev]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM webhook_events WHERE reference = ?`, [reference]
    );
    assert.equal(ev.n, 0, 'an unsigned/forged delivery is not even receipted');
  });

  test('webhook: amount mismatch is rejected before reconciliation (no refund for a mismatched charge)', async () => {
    const { id, reference } = await mkCancelledOrder('MISMATCH', 140.00);
    const r = await postWebhook(chargeSuccessDelivery(reference, 5000)); // paid 50, order says 140
    assert.equal(r.status, 400);
    const order = await getOrder(id);
    assert.equal(order.paymentStatus, 'pending', 'a mismatched charge flips nothing');
    assert.equal(refundCalls.filter((c) => c.payload?.transaction === reference).length, 0,
      'validation failure must precede any refund');
  });

  test('webhook: a failed refund leaves the event retryable and the next delivery completes it', async () => {
    const { id, reference } = await mkCancelledOrder('RETRY', 150.00);
    refundScript.set(reference, [false, true]); // first refund call fails, second succeeds

    const first = await postWebhook(chargeSuccessDelivery(reference, 15000));
    assert.equal(first.status, 500, 'a failed refund must non-2xx so Paystack redelivers');
    let order = await getOrder(id);
    assert.equal(order.paymentStatus, 'pending', 'nothing is recorded as refunded yet');
    assert.equal(order.refundReference, null, 'the claim is released so the retry can re-attempt');
    const [[ev1]] = await pool.execute(
      `SELECT processing_status, last_error FROM webhook_events WHERE reference = ?`, [reference]
    );
    assert.equal(ev1.processing_status, 'failed', 'the failure is durable, not lost');
    assert.ok(ev1.last_error && ev1.last_error.length > 0, 'the failure carries a reason');

    const second = await postWebhook(chargeSuccessDelivery(reference, 15000));
    assert.equal(second.status, 200, 'the redelivery must succeed once the provider recovers');
    order = await getOrder(id);
    assert.equal(order.paymentStatus, 'refunded', 'the redelivery completes the refund');
    assert.equal(refundCalls.filter((c) => c.payload?.transaction === reference).length, 2,
      'exactly two refund attempts: one failed, one succeeded');
  });

  // ---- verify-paystack authorization --------------------------------------

  test('verify: a non-owner cannot read another payer\'s customer details from a paid order', async () => {
    const reference = `LATE-PAID-${ts}`;
    const [r] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
        paymentMethod, paymentStatus, orderStatus, paymentReference)
       VALUES (?, ?, '[]', 90.00, '{}', '{}', 'paystack', 'paid', 'processing', ?)`,
      [state.userA, `LATEPAID-${ts}`, reference]
    );
    fixtureIds.push(r.insertId);
    verifyStub.set(reference, {
      status: 'success', reference, amount: 9000, currency: 'GHS', channel: 'card',
      paid_at: new Date().toISOString(), customer: { email: 'payer-secret@example.com' },
    });

    const res = await postVerify(reference, state.tokenB);
    assert.equal(res.status, 403, 'ownership must be enforced even on already-paid orders');
    assert.ok(!res.text.includes('payer-secret@example.com'),
      'the payer\'s customer block leaked to a non-owner');
  });

  test('verify: an unbound reference never echoes the payer\'s customer block', async () => {
    const reference = `LATE-UNBOUND-${ts}`;
    verifyStub.set(reference, {
      status: 'success', reference, amount: 5500, currency: 'GHS', channel: 'card',
      paid_at: new Date().toISOString(), customer: { email: 'unbound-payer@example.com' },
    });
    const res = await postVerify(reference, state.tokenA);
    assert.equal(res.status, 200, 'the Paystack transaction itself is real — verification succeeds');
    assert.equal(res.json?.data?.orderMarkedPaid, false, 'no order is bound, so nothing was marked paid');
    assert.ok(!res.text.includes('unbound-payer@example.com'),
      'a caller with no proven association must not read the payer block');
  });

  test('verify: a repeated verification of a refunded order never resurrects it to paid', async () => {
    // The shape the return path leaves behind: money refunded, but orderStatus
    // not necessarily terminal. The old flip guard (`paymentStatus != 'paid'`)
    // admitted 'refunded' and would flip this order back to paid.
    const reference = `LATE-REFUNDED-${ts}`;
    const [r] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
        paymentMethod, paymentStatus, orderStatus, paymentReference, refundReference)
       VALUES (?, ?, '[]', 77.77, '{}', '{}', 'paystack', 'refunded', 'processing', ?, ?)`,
      [state.userA, `LATERSD-${ts}`, reference, `refund:${ts}:return`]
    );
    fixtureIds.push(r.insertId);
    verifyStub.set(reference, {
      status: 'success', reference, amount: 7777, currency: 'GHS', channel: 'card',
      paid_at: new Date().toISOString(), customer: { email: 'refunded-payer@example.com' },
    });

    const res = await postVerify(reference, state.tokenA);
    assert.equal(res.status, 200, 'verification of the real charge succeeds (idempotent receipt)');
    assert.equal(res.json?.data?.orderMarkedPaid, false, 'a refunded order is never marked paid again');

    const order = await getOrder(r.insertId);
    assert.equal(order.paymentStatus, 'refunded', 'the refunded state survived the repeated verification');
    assert.equal(order.orderStatus, 'processing', 'the flip must not have run');
    assert.equal(refundCalls.filter((c) => c.payload?.transaction === reference).length, 0,
      'already-refunded short-circuits: no second refund is issued');
  });

  test('verify: owner + verified charge on a cancelled order reconciles by refund (no resurrection)', async () => {
    const { id, reference } = await mkCancelledOrder('VERIFY', 160.00);
    const res = await postVerify(reference, state.tokenA);
    assert.equal(res.status, 200);
    assert.equal(res.json?.data?.orderMarkedPaid, false, 'a cancelled order is never marked paid');
    assert.match(res.json?.message || '', /refund/i, 'the customer is told a refund was initiated');

    const order = await getOrder(id);
    assert.equal(order.paymentStatus, 'refunded');
    assert.equal(order.orderStatus, 'cancelled');
    assert.equal(refundCalls.filter((c) => c.payload?.transaction === reference).length, 1,
      'exactly one refund for the late charge');
  });

  // ---- unattended recovery job --------------------------------------------

  test('recovery job: a cancelled stuck-pending order with a verified charge is refunded, not flipped', async () => {
    // Unique total so the job's unscoped scan (SELECT has no user filter)
    // matches only THIS fixture even on a shared dev database.
    const total = 123.47;
    const { id, reference } = await mkCancelledOrder('RECOV', total);
    await pool.execute(
      `UPDATE orders SET created_at = DATE_SUB(NOW(), INTERVAL 2 HOUR) WHERE id = ?`, [id]
    );

    const { recoverStuckPendingOrders } = await import('../Services/escrowService.js');
    await recoverStuckPendingOrders();

    const order = await getOrder(id);
    assert.equal(order.paymentStatus, 'refunded', 'the last-resort job reconciles by refund');
    assert.equal(order.orderStatus, 'cancelled', 'the order stays cancelled');
    assert.equal(refundCalls.filter((c) => c.payload?.transaction === reference).length, 1,
      'exactly one refund is pushed by the recovery path');
  });
});

// ---------------------------------------------------------------------------
// Pure-logic guards that still contribute coverage on the no-DB CI path.
// ---------------------------------------------------------------------------
describe('flip-guard narrowing (no DB)', () => {
  test('the old guard admitted a refunded order; the new one does not', () => {
    // Semantic truth-table of the UPDATE predicates, independent of MySQL.
    const oldGuard = (paymentStatus, orderStatus) =>
      paymentStatus !== 'paid' && !['cancelled', 'refunded'].includes(orderStatus);
    const newGuard = (paymentStatus, orderStatus) =>
      ['pending', 'failed'].includes(paymentStatus) && !['cancelled', 'refunded'].includes(orderStatus);

    // The resurrection bug: refunded payment status, non-terminal order status.
    assert.equal(oldGuard('refunded', 'processing'), true, 'precondition: the old guard DID admit this');
    assert.equal(newGuard('refunded', 'processing'), false, 'a refunded order must never flip to paid');
    // Ordinary flow unchanged.
    assert.equal(newGuard('pending', 'pending'), true);
    assert.equal(newGuard('failed', 'pending'), true);
    assert.equal(newGuard('paid', 'processing'), false);
    assert.equal(newGuard('pending', 'cancelled'), false);
  });
});
