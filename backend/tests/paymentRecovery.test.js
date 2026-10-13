// FILE LOCATION: backend/tests/paymentRecovery.test.js
// DESCRIPTION: Recovery for what a crash can strand on the payment path.
//
//   Finding 1 — a refund CLAIM that never finalized (process death or DB
//   failure after the provider call; or before it) used to strand money with
//   nobody retrying: redeliveries stand down on the claim and mark the
//   webhook processed, and the paid-only reconcileRefundedButPaid never saw
//   pending/failed rows. reconcileStaleRefundClaims converges them from the
//   provider's ACTUAL refund state — finalize when confirmed (own journal or
//   provider list), wait when pending, re-issue exactly once when provably
//   never issued, alert and change nothing when the state is unknown. A claim
//   alone is never treated as proof of a refund.
//
//   Finding 2 — charge.success receipts with no bound order are re-verified
//   server-side, reported to operators once (marker-deduped), and handed to
//   the existing stuck-order recovery when the order finally appears. No
//   order is ever created and no refund is ever issued for an unmatched
//   charge; the signed receipt and its payload are preserved as evidence and
//   customer data never reaches the logs.
//
//   Related: refund claims are bounded to the VARCHAR(191) column (long
//   external refs), verify-paystack validates amount/currency BEFORE the
//   terminal-order branch can journal a collection, and webhook convergence
//   never sends a second confirmation email.
//
// Everything here runs against real HTTP with the HMAC computed exactly as
// Paystack computes it, and axios fully stubbed — no test may ever reach the
// live provider, place a charge, or issue a real refund.
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.EMAIL_DISABLED = '1';
// Same REDIS_URL guard as paymentLateCharge/paystackReferenceGuard: an empty
// string (not delete) so rateLimitMiddleware's dotenv pass leaves it alone,
// and no open redis socket keeps `node --test` alive past the summary.
process.env.REDIS_URL = '';
process.env.JWT_SECRET ||= 'payment-recovery-secret-for-tests-only-not-a-key';
// Set BEFORE paymentRoutes is imported: the module captures the secret at
// module scope and the webhook HMAC is computed with it.
process.env.PAYSTACK_SECRET_KEY ||= 'sk_test_payment_recovery_secret_for_tests';

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

const state = { userA: null, adminId: null, tokenA: null, crash: null, orphanRef: null };
let server = null;
let verifyCalls = [];    // axios.get URLs (Paystack verify + refund list)
let refundCalls = [];    // axios.post {url, payload}
// Per-reference provider behavior for the stubs.
let verifyStub = new Map();      // ref -> Paystack transaction
let verifyErrors = new Map();    // ref -> Error thrown by verify
let refundScript = new Map();    // ref -> array of booleans consumed per refund POST
let refundListStub = new Map();  // ref -> array of provider refund rows
let refundListErrors = new Map(); // ref -> Error thrown by the refund list

const fixtureIds = [];
const { buildRefundClaim } = await import('../utils/refundClaim.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (fn, timeoutMs = 8000, stepMs = 100) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await sleep(stepMs);
  }
  return fn();
};

describe('payment recovery: stale claims, unmatched charges, verification hardening', { skip: !dbAvailable }, () => {
  before(async () => {
    if (!dbAvailable || !pool) return;

    const User = (await import('../models/usersModel.js')).default;
    const userA = await User.create({
      firstName: 'Recovery', lastName: 'caseA', email: `payment-recovery-a-${ts}@example.com`,
      password: 'Test1234x', role: 'customer', legalConsentAccepted: true,
    });
    state.userA = userA.id;
    // Operator alerts go to admin accounts. Own the recipient instead of
    // depending on admins that happen to exist in the database (on a fresh
    // database there were none, and the alert assertions failed).
    const admin = await User.create({
      firstName: 'Recovery', lastName: 'admin', email: `payment-recovery-admin-${ts}@example.com`,
      password: 'Test1234x', role: 'admin', legalConsentAccepted: true,
    });
    state.adminId = admin.id;

    const { signUserToken } = await import('../utils/generateToken.js');
    state.tokenA = signUserToken(userA);

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
      const u = String(url);
      verifyCalls.push(u);
      if (u.includes('/refund?')) {
        const ref = decodeURIComponent((u.split('transaction=')[1] || '').split('&')[0]);
        if (refundListErrors.has(ref)) throw refundListErrors.get(ref);
        return { data: { status: true, data: refundListStub.get(ref) ?? [] } };
      }
      const ref = u.split('/transaction/verify/')[1] || '';
      if (verifyErrors.has(ref)) throw verifyErrors.get(ref);
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
      return { data: { status: true, data: { id: 777000 + refundCalls.length, transaction: reference, amount: payload?.amount ?? null } } };
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
          await pool.execute('DELETE FROM notifications WHERE message LIKE ?', [`%Order #${id}%`]);
          await pool.execute('DELETE FROM orders WHERE id = ?', [id]);
        } catch (err) {
          console.error(`paymentRecovery cleanup FAILED for order ${id}: ${err.message}`);
        }
      }
      if (state.orphanRef) {
        try {
          await pool.execute('DELETE FROM webhook_events WHERE reference = ?', [state.orphanRef]);
          await pool.execute('DELETE FROM notifications WHERE message LIKE ?', [`%${state.orphanRef}%`]);
        } catch (err) {
          console.error(`paymentRecovery orphan cleanup FAILED: ${err.message}`);
        }
      }
    }
    if (dbAvailable && pool && state.adminId) {
      try {
        await pool.execute('DELETE FROM notifications WHERE userId = ?', [state.adminId]);
        await pool.execute('DELETE FROM users WHERE id = ?', [state.adminId]);
      } catch (err) {
        console.error(`paymentRecovery admin cleanup FAILED: ${err.message}`);
      }
    }
    if (dbAvailable && pool && state.userA) {
      try {
        await pool.execute('DELETE FROM users WHERE id = ?', [state.userA]);
      } catch (err) {
        console.error(`paymentRecovery user cleanup FAILED: ${err.message}`);
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

  /** A CANCELLED order whose charge is about to settle (or already settled) late. */
  const mkCancelledOrder = async (tag, totalGhs, opts = {}) => {
    const reference = opts.reference ?? `RECOV-${tag}-${ts}`;
    const [r] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
        paymentMethod, paymentStatus, orderStatus, paymentReference, created_at)
       VALUES (?, ?, '[]', ?, '{}', '{}', 'paystack', 'pending', 'cancelled', ?,
               DATE_SUB(NOW(), INTERVAL 10 MINUTE))`,
      [state.userA, `RECOVFIX-${tag}-${ts}`, totalGhs, reference]
    );
    fixtureIds.push(r.insertId);
    verifyStub.set(reference, {
      status: 'success', reference, amount: Math.round(totalGhs * 100),
      currency: 'GHS', channel: 'card', paid_at: new Date().toISOString(),
      customer: { email: 'payer-secret@example.com', name: 'Secret Payer' },
    });
    return { id: r.insertId, reference };
  };

  /** The crashed state: claim set, no finalize. */
  const mkStrandedClaim = async (tag, totalGhs) => {
    const { id, reference } = await mkCancelledOrder(tag, totalGhs);
    await pool.execute(
      `UPDATE orders SET refundReference = ?, updated_at = DATE_SUB(NOW(), INTERVAL 30 MINUTE)
       WHERE id = ?`,
      [buildRefundClaim(id, 'late-charge', reference), id]
    );
    return { id, reference };
  };

  const postWebhook = async ({ rawBody, signature }) => {
    const res = await fetch(`${server.baseUrl}/api/payments/paystack-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature },
      body: rawBody,
    });
    return { status: res.status, text: await res.text() };
  };

  const chargeSuccessDelivery = (reference, amountKobo) => {
    const rawBody = JSON.stringify({
      event: 'charge.success',
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

  const refundsFor = (reference) => refundCalls.filter((c) => c.payload?.transaction === reference);

  // ==== Finding 1: stale refund claims converge from provider state ========

  test('1a. refund succeeded but the DB write failed: the claim survives as evidence', async () => {
    const total = 310.11;
    const { id, reference } = await mkCancelledOrder('CRASH', total);
    state.crash = { id, reference };
    // The provider will report a completed refund for this transaction — the
    // "money already left" half of the crash window.
    refundListStub.set(reference, [
      { id: 9101, status: 'success', amount: Math.round(total * 100), currency: 'GHS', transaction: reference },
    ]);

    // Simulate the crash: the provider accepts the refund, then the database
    // write fails. The service must NOT release the claim on a DB failure —
    // releasing it would let a retry re-issue a refund that already exists.
    const realExecute = pool.execute.bind(pool);
    let failArmed = true;
    pool.execute = async (...args) => {
      const sql = String(args[0] ?? '');
      if (failArmed && sql.includes("SET paymentStatus = 'refunded'")) {
        failArmed = false;
        throw new Error('simulated DB outage during refund finalization');
      }
      return realExecute(...args);
    };
    let outcome;
    try {
      const { reconcileTerminalOrderCharge } = await import('../Services/paymentReconciliationService.js');
      const [[row]] = await realExecute(
        `SELECT id, paymentStatus, orderStatus, refundReference, totalAmount, paymentReference
         FROM orders WHERE id = ?`, [id]
      );
      outcome = await reconcileTerminalOrderCharge(row);
    } finally {
      pool.execute = realExecute;
    }

    assert.equal(outcome.action, 'finalization-failed',
      `a provider-accepted refund with a failed DB write must be classified finalization-failed, got ${outcome.action}`);
    assert.match(String(outcome.error?.message || ''), /simulated DB outage/);
    assert.equal(refundsFor(reference).length, 1, 'exactly one refund reached the provider');

    const order = await getOrder(id);
    assert.equal(order.paymentStatus, 'pending', 'the DB write failed, so the flip did not land');
    assert.equal(order.refundReference, buildRefundClaim(id, 'late-charge', reference),
      'the claim is KEPT — it is the durable evidence that a refund may exist');
    const [[journal]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM financial_events WHERE orderId = ? AND eventType = 'refund' AND dedupeKey = ?`,
      [id, `refund:${id}`]
    );
    assert.equal(journal.n, 1, 'the refund journal was booked before the flip (journal-then-flip ordering)');
  });

  test('1b. a redelivery during the stranded window stands down on the claim — still one refund', async () => {
    const { id, reference } = state.crash;
    const r = await postWebhook(chargeSuccessDelivery(reference, 31011));
    assert.equal(r.status, 200, `the redelivery must be acknowledged, got ${r.status}: ${r.text}`);
    assert.equal(refundsFor(reference).length, 1, 'the held claim keeps the redelivery from re-issuing the refund');
    const order = await getOrder(id);
    assert.equal(order.paymentStatus, 'pending', 'the redelivery does not touch the money state');
    assert.equal(order.refundReference, buildRefundClaim(id, 'late-charge', reference), 'the claim is untouched');
    const [[ev]] = await pool.execute(
      `SELECT processing_status FROM webhook_events WHERE event = 'charge.success' AND reference = ?`,
      [reference]
    );
    assert.equal(ev.processing_status, 'processed', 'the event converges to processed while the claim remains the durable signal');
  });

  test('1c. the reconciler finalizes from provider state without a second refund', async () => {
    const { id, reference } = state.crash;
    // The claim CAS in 1a stamped updated_at = NOW; the scan only picks up
    // claims that have been stale for 15+ minutes, so age the fixture the
    // same way mkStrandedClaim does.
    await pool.execute(
      `UPDATE orders SET updated_at = DATE_SUB(NOW(), INTERVAL 30 MINUTE) WHERE id = ?`,
      [id]
    );
    const { reconcileStaleRefundClaims } = await import('../Services/paymentReconciliationService.js');
    const resolved = await reconcileStaleRefundClaims();
    assert.ok(resolved >= 1, 'the stranded claim was resolved');

    const order = await getOrder(id);
    assert.equal(order.paymentStatus, 'refunded', 'the reconciler flips from CONFIRMED state, never from the claim alone');
    assert.equal(order.orderStatus, 'cancelled', 'the order is never resurrected');
    assert.equal(refundsFor(reference).length, 1, 'no second refund is issued — the provider already had one');
    const [[journal]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM financial_events WHERE dedupeKey = ?`, [`refund:${id}`]
    );
    assert.equal(journal.n, 1, 'the shared full-refund dedupe key keeps the books single-booking');
  });

  test('1d. re-running the reconciler after finalization is a no-op (idempotent)', async () => {
    const { id, reference } = state.crash;
    const { reconcileStaleRefundClaims } = await import('../Services/paymentReconciliationService.js');
    await reconcileStaleRefundClaims();
    const order = await getOrder(id);
    assert.equal(order.paymentStatus, 'refunded');
    assert.equal(refundsFor(reference).length, 1, 'a second run never re-issues');
    const [[journal]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM financial_events WHERE dedupeKey = ?`, [`refund:${id}`]
    );
    assert.equal(journal.n, 1, 'a second run never double-books');
  });

  test('2. process death after the provider call (no journal at all): finalized from the provider list', async () => {
    // The other half of the crash window: the process died before ANY
    // bookkeeping landed. Only the provider can prove the refund happened.
    const total = 320.22;
    const { id, reference } = await mkStrandedClaim('PROVIDER', total);
    refundListStub.set(reference, [
      { id: 9201, status: 'success', amount: Math.round(total * 100), currency: 'GHS', transaction: reference },
    ]);
    const [[pre]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM financial_events WHERE dedupeKey = ?`, [`refund:${id}`]
    );
    assert.equal(pre.n, 0, 'precondition: no refund journal exists');

    const { reconcileStaleRefundClaims } = await import('../Services/paymentReconciliationService.js');
    const resolved = await reconcileStaleRefundClaims();
    assert.ok(resolved >= 1);

    const order = await getOrder(id);
    assert.equal(order.paymentStatus, 'refunded', 'the provider-listed refund finalizes the order');
    assert.equal(refundsFor(reference).length, 0, 'no new refund is issued when the provider already has one');
    const [[journal]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM financial_events WHERE dedupeKey = ?`, [`refund:${id}`]
    );
    assert.equal(journal.n, 1, 'the refund is journaled exactly once, by the reconciler');
  });

  test('3. a refund pending at the provider is never finalized early and never re-issued', async () => {
    const total = 330.33;
    const { id, reference } = await mkStrandedClaim('PENDING', total);
    refundListStub.set(reference, [
      { id: 9301, status: 'pending', amount: Math.round(total * 100), currency: 'GHS', transaction: reference },
    ]);

    const { reconcileStaleRefundClaims } = await import('../Services/paymentReconciliationService.js');
    await reconcileStaleRefundClaims();

    const order = await getOrder(id);
    assert.equal(order.paymentStatus, 'pending', 'an in-flight provider refund is never marked complete');
    assert.equal(order.refundReference, buildRefundClaim(id, 'late-charge', reference), 'the claim is retained while the provider refund is in flight');
    assert.equal(refundsFor(reference).length, 0, 'no second refund is stacked behind a pending one');
  });

  test('4. when the provider refund state cannot be established: no finalize, no re-issue, operator alerted', async () => {
    const { id, reference } = await mkStrandedClaim('UNCONFIRM', 340.44);
    refundListErrors.set(reference, new Error('provider timeout'));

    const { reconcileStaleRefundClaims } = await import('../Services/paymentReconciliationService.js');
    await reconcileStaleRefundClaims();

    const order = await getOrder(id);
    assert.equal(order.paymentStatus, 'pending', 'an unknown provider state never finalizes a refund');
    assert.equal(order.refundReference, buildRefundClaim(id, 'late-charge', reference), 'the claim is retained for the next run');
    assert.equal(refundsFor(reference).length, 0, 'nothing is re-issued while the state is unknown');
    const [[notes]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM notifications WHERE title LIKE 'Stale refund claim%' AND message LIKE ?`,
      [`%Order #${id}%`]
    );
    assert.ok(notes.n >= 1, 'operators get an actionable alert when the provider cannot confirm state');
  });

  test('5. a claim whose refund never reached the provider is re-issued exactly once, then converges', async () => {
    const { id, reference } = await mkStrandedClaim('REISSUE', 350.55);
    refundListStub.set(reference, []); // provider definitively has NO refund

    const { reconcileStaleRefundClaims } = await import('../Services/paymentReconciliationService.js');
    const resolved = await reconcileStaleRefundClaims();
    assert.ok(resolved >= 1);

    const order = await getOrder(id);
    assert.equal(order.paymentStatus, 'refunded', 'the recovered refund completes the books');
    const issued = refundsFor(reference);
    assert.equal(issued.length, 1, 'exactly ONE refund is re-issued under the held claim');
    assert.match(String(issued[0].url), /\/refund$/, 'the re-issue goes through the normal refund endpoint');
    const [[journal]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM financial_events WHERE dedupeKey = ?`, [`refund:${id}`]
    );
    assert.equal(journal.n, 1);

    // Retry: the order has left the scan population; nothing moves again.
    await reconcileStaleRefundClaims();
    assert.equal(refundsFor(reference).length, 1, 'a retry never re-issues a second refund');
    const [[after]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM financial_events WHERE dedupeKey = ?`, [`refund:${id}`]
    );
    assert.equal(after.n, 1, 'a retry never double-books');
  });

  test('6. overlong refund claims are bounded, deterministic, and release cleanly', async () => {
    // Unit: the builder guarantees the VARCHAR(191) limit.
    const longRef = `LONGREF-${ts}-${'A'.repeat(240)}`;
    const claim = buildRefundClaim(123, 'late-charge', longRef);
    assert.ok(claim.length <= 191, `claim must fit the column, got ${claim.length}`);
    assert.equal(claim, buildRefundClaim(123, 'late-charge', longRef), 'the claim is deterministic (CAS round-trips)');
    assert.notEqual(claim, buildRefundClaim(123, 'late-charge', `${longRef.slice(0, -1)}B`),
      'two long references sharing a prefix claim differently');
    assert.notEqual(claim, buildRefundClaim(124, 'late-charge', longRef), 'different orders never share a claim');
    assert.ok(!Number.isFinite(parseInt(claim.split(':').pop(), 10)),
      'the digest tail can never parse as a numeric vendor id');

    // Integration: a 250-char reference must survive the live claim/release
    // path inside the column limit (pre-fix this UPDATE overflows 191).
    const { id, reference } = await mkCancelledOrder('LONGOK', 40.40, { reference: `LONGOK-${ts}-${'B'.repeat(230)}` });
    const { reconcileTerminalOrderCharge } = await import('../Services/paymentReconciliationService.js');
    const [[row]] = await pool.execute(
      `SELECT id, paymentStatus, orderStatus, refundReference, totalAmount, paymentReference FROM orders WHERE id = ?`, [id]
    );
    const outcome = await reconcileTerminalOrderCharge(row);
    assert.equal(outcome.action, 'refunded');
    const order = await getOrder(id);
    assert.equal(order.paymentStatus, 'refunded');
    assert.ok(order.refundReference && order.refundReference.length <= 191,
      'the stored claim fits the column');
    assert.equal(order.refundReference, buildRefundClaim(id, 'late-charge', reference),
      'the stored claim is exactly what the deterministic builder recomputes');

    // Release CAS: a provider refusal releases by exact claim match even for
    // an overlong reference.
    const second = await mkCancelledOrder('LONGREL', 41.41, { reference: `LONGREL-${ts}-${'C'.repeat(230)}` });
    refundScript.set(second.reference, [false]);
    const [[row2]] = await pool.execute(
      `SELECT id, paymentStatus, orderStatus, refundReference, totalAmount, paymentReference FROM orders WHERE id = ?`, [second.id]
    );
    const failed = await reconcileTerminalOrderCharge(row2);
    assert.equal(failed.action, 'refund-failed');
    const order2 = await getOrder(second.id);
    assert.equal(order2.refundReference, null, 'the bounded claim is released by exact match — nothing is stranded');
  });

  // ==== C: verify-paystack validates before reconciling ====================

  test('7. amount mismatch on a terminal order is refused before any refund or journal', async () => {
    const { id, reference } = await mkCancelledOrder('AMT', 200.00);
    // The verified charge is real but collected a different amount.
    verifyStub.set(reference, {
      status: 'success', reference, amount: 5000, currency: 'GHS', channel: 'card',
      paid_at: new Date().toISOString(), customer: { email: 'mismatch-payer@example.com' },
    });

    const res = await postVerify(reference, state.tokenA);
    assert.equal(res.status, 400, 'a mismatched charge must never reach terminal-order reconciliation');
    assert.match(res.json?.message || '', /does not match/i);
    const order = await getOrder(id);
    assert.equal(order.paymentStatus, 'pending', 'nothing is flipped');
    assert.equal(order.refundReference, null, 'no claim is taken for a mismatched charge');
    assert.equal(refundsFor(reference).length, 0, 'no refund is issued for a mismatched charge');
    const [[journal]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM financial_events WHERE dedupeKey = ?`, [`charge.collected:${reference}`]
    );
    assert.equal(journal.n, 0, 'a mismatched charge is never journaled as a collection');
  });

  test('8. currency mismatch on a terminal order is refused before any refund', async () => {
    const { id, reference } = await mkCancelledOrder('CUR', 150.00);
    verifyStub.set(reference, {
      status: 'success', reference, amount: 15000, currency: 'NGN', channel: 'card',
      paid_at: new Date().toISOString(), customer: { email: 'ngn-payer@example.com' },
    });

    const res = await postVerify(reference, state.tokenA);
    assert.equal(res.status, 400, 'a charge in the wrong currency is never reconciled');
    assert.equal(refundsFor(reference).length, 0, 'no refund is issued for a foreign-currency charge');
    const order = await getOrder(id);
    assert.equal(order.paymentStatus, 'pending');
    assert.equal(order.refundReference, null);
  });

  // ==== D: no duplicate confirmation email on convergence ==================

  test('9. verify fallback + webhook convergence sends exactly ONE confirmation email', async () => {
    const total = 88.00;
    const reference = `EMAILD-${ts}`;
    const [r] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
        paymentMethod, paymentStatus, orderStatus, paymentReference)
       VALUES (?, ?, '[]', ?, '{}', '{}', 'paystack', 'pending', 'pending', ?)`,
      [state.userA, `EMAILDFIX-${ts}`, total, reference]
    );
    fixtureIds.push(r.insertId);
    verifyStub.set(reference, {
      status: 'success', reference, amount: Math.round(total * 100), currency: 'GHS', channel: 'card',
      paid_at: new Date().toISOString(), customer: { email: 'email-d-payer@example.com' },
    });

    // EMAIL_DISABLED=1: sendEmailSafely logs `Email disabled/skipped for
    // "Order Confirmation — ..."`, which is the observable for detached sends.
    const warns = [];
    mock.method(console, 'warn', (...args) => { warns.push(args.join(' ')); });
    const emailCount = () => warns.filter((w) => w.includes('Order Confirmation')).length;

    const res = await postVerify(reference, state.tokenA);
    assert.equal(res.status, 200, 'the fallback flips the pending order');
    const flipped = await getOrder(r.insertId);
    assert.equal(flipped.paymentStatus, 'paid');
    await waitFor(() => emailCount() >= 1);
    assert.equal(emailCount(), 1, 'the verify fallback sends exactly one confirmation');

    const wh = await postWebhook(chargeSuccessDelivery(reference, Math.round(total * 100)));
    assert.equal(wh.status, 200, 'the webhook converges on the already-paid order');
    await sleep(1000); // give a wrongly-fired detached email time to log
    assert.equal(emailCount(), 1, 'webhook convergence must NOT send a second confirmation email');
    const [[ev]] = await pool.execute(
      `SELECT processing_status FROM webhook_events WHERE event = 'charge.success' AND reference = ?`, [reference]
    );
    assert.equal(ev.processing_status, 'processed', 'the converging event is still terminally processed');
  });

  // ==== Finding 2: unmatched successful charges ============================

  test('10. a successful charge with no matching order: no order, no refund, durable verified report', async () => {
    const reference = `ORPHAN-${ts}`;
    state.orphanRef = reference;
    verifyStub.set(reference, {
      status: 'success', reference, amount: 7700, currency: 'GHS', channel: 'card',
      paid_at: new Date().toISOString(), customer: { email: 'orphan-payer@example.com' },
    });

    // Real delivery: the order never appears, so the handler retries
    // (~10s of backoff) and fails durably — exactly how orphans are born.
    const r = await postWebhook(chargeSuccessDelivery(reference, 7700));
    assert.equal(r.status, 500, 'no order → non-2xx so Paystack keeps the receipt redeliverable for a while');
    const [[ev]] = await pool.execute(
      `SELECT processing_status, last_error, payload FROM webhook_events WHERE event = 'charge.success' AND reference = ?`,
      [reference]
    );
    assert.equal(ev.processing_status, 'failed');
    assert.match(ev.last_error || '', /Order was not found/);
    assert.ok(ev.payload, 'the signed receipt is preserved as evidence');

    const { reconcileUnmatchedCharges } = await import('../Services/paymentReconciliationService.js');
    const unmatched = await reconcileUnmatchedCharges();
    assert.ok(unmatched >= 1, 'the orphaned receipt is reported');

    const [[ev2]] = await pool.execute(
      `SELECT processing_status, last_error, payload FROM webhook_events WHERE event = 'charge.success' AND reference = ?`,
      [reference]
    );
    assert.match(ev2.last_error || '', /unmatched-charge: verified success/,
      'the report rests on a fresh server-side verification, not the stored payload');
    // mysql2 parses the JSON column into a fresh object per query, so this
    // must be a deep value comparison — not an object-identity check.
    assert.deepEqual(ev2.payload, ev.payload, 'the receipt payload is preserved untouched');
    const [[orders]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM orders WHERE paymentReference = ?`, [reference]
    );
    assert.equal(orders.n, 0, 'an unmatched charge must never auto-create an order');
    assert.equal(refundsFor(reference).length, 0, 'an unmatched charge must never be refunded');
    const [[notes]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM notifications WHERE message LIKE ?`, [`%${reference}%`]
    );
    assert.ok(notes.n >= 1, 'operators get an actionable alert (reference + amount, no customer PII)');

    // Second run: still reported, never re-alerted, nothing re-acted.
    await reconcileUnmatchedCharges();
    const [[notes2]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM notifications WHERE message LIKE ?`, [`%${reference}%`]
    );
    assert.equal(notes2.n, notes.n, 'the operator alert is deduplicated across runs');
    assert.equal(refundsFor(reference).length, 0);
    const [[orders2]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM orders WHERE paymentReference = ?`, [reference]
    );
    assert.equal(orders2.n, 0, 'reprocessing is idempotent — still no order created');
  });

  test('11. when the order appears later, the receipt converges through the existing verified recovery', async () => {
    const reference = state.orphanRef;
    // The slow POST /api/orders finally completes: an order row appears,
    // pending and old enough for the stuck-order recovery to own it.
    const [r] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
        paymentMethod, paymentStatus, orderStatus, paymentReference, created_at)
       VALUES (?, ?, '[]', 77.00, '{}', '{}', 'paystack', 'pending', 'pending', ?,
               DATE_SUB(NOW(), INTERVAL 2 HOUR))`,
      [state.userA, `ORPHANBOUND-${ts}`, reference]
    );
    fixtureIds.push(r.insertId);

    const { reconcileUnmatchedCharges } = await import('../Services/paymentReconciliationService.js');
    await reconcileUnmatchedCharges();

    const order = await getOrder(r.insertId);
    assert.equal(order.paymentStatus, 'paid',
      'the existing stuck-order recovery flips the late-appearing order (server-verified, flip-guarded)');
    assert.equal(order.orderStatus, 'processing');
    assert.equal(refundsFor(reference).length, 0, 'no refund is issued once the payment is matched');
    const [[ev]] = await pool.execute(
      `SELECT last_error FROM webhook_events WHERE event = 'charge.success' AND reference = ?`, [reference]
    );
    assert.match(ev.last_error || '', /order #\d+ bound/, 'the receipt records its disposition');

    // Idempotent: a later run changes nothing.
    await reconcileUnmatchedCharges();
    const orderAfter = await getOrder(r.insertId);
    assert.equal(orderAfter.paymentStatus, 'paid');
    assert.equal(refundsFor(reference).length, 0);
  });
});
