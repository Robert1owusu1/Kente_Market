// FILE LOCATION: backend/tests/payoutLifecycle.test.js
// DESCRIPTION: Vendor payout lifecycle (R-8 redesign, PAYOUT_LIFECYCLE_DESIGN.md).
//              Drives the real controller, claim, settlement, reconciler and
//              admin API against a disposable database with Paystack stubbed
//              (a fake provider ledger keyed by our transfer reference). After
//              every transition the vendor's wallet must equal the withdrawable
//              remainder + in-flight reservations (invariant I-15).
//
// DISPOSABLE DATABASE ONLY (tests/helpers/testDbGuard.mjs + interlock below).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';

let dbAvailable = true;
{
  const probe = (await import('../config/db.js')).default;
  try {
    await probe.query('SELECT 1');
  } catch {
    dbAvailable = false;
  }
}

/** @type {any} */ let pool;
/** @type {any} */ let paystackServices, origInitiate;
/** @type {any} */ let hooks, origVerify;
/** @type {any} */ let withdrawVendorBalance, parseWithdrawalAmountMinor;
/** @type {any} */ let settleTransferSuccess, settleTransferFailed, settleTransferReversed;
/** @type {any} */ let checkVendorPayoutConsistency, alertPayoutAttempt;
/** @type {any} */ let reconcilePayoutAttempt, reconcileStuckTransfers;
/** @type {any} */ let creditVendorBalance, voidEscrowForOrder;
/** @type {any} */ let signUserToken, startServer;

const TS = Date.now();
const tag = (s) => `r8lc-${s}-${TS}`;
const state = { users: [], orders: [], allocs: [] };
let seq = 0;

// ---------------------------------------------------------------------------
// Fake provider. `transfers` is Paystack's side of the world: a reference is
// in it only if Paystack accepted that transfer.
// ---------------------------------------------------------------------------
const provider = {
  /** @type {Map<string, { status: string, amount: number, currency: string, reference: string }>} */
  transfers: new Map(),
  /** @type {Set<string>} references created by THIS file */
  known: new Set(),
  /** @type {Array<string | ((ref: string, amount: number) => Promise<any>)>} */
  nextInitiate: [],
  initiateCalls: 0,
  verifyCalls: /** @type {string[]} */ ([]),
  /** @type {any} */ verifyError: null,
};

const httpError = (status, message) => Object.assign(new Error(message), { response: { status } });

const mockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};

async function mkUser(role, name) {
  const [r] = await pool.execute(
    `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
     VALUES ('R8', ?, ?, 'x', ?, 1, 1)`,
    [name, `${tag(name)}-${++seq}@test.local`, role]
  );
  state.users.push(r.insertId);
  return r.insertId;
}

async function mkVendor(name) {
  const id = await mkUser('vendor', name);
  await pool.execute(
    `INSERT INTO vendors (userId, businessName, status, recipientCode) VALUES (?, ?, 'approved', ?)`,
    [id, `${tag(name)}-${seq}`, `RCP_R8_${id}`]
  );
  return id;
}

/** Released + credited allocation, exactly as releaseAllocation leaves it. */
async function mkCreditedAlloc(vendorId, amount) {
  seq += 1;
  const [o] = await pool.execute(
    `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
       paymentMethod, paymentStatus, orderStatus, shippingCost, tax, discount, escrowStatus)
     VALUES (?, ?, '[]', ?, '{}', '{}', 'card', 'paid', 'delivered', 0, 0, 0, 'released')`,
    [vendorId, `R8LC-${TS}-${seq}`, amount]
  );
  state.orders.push(o.insertId);
  const [a] = await pool.execute(
    `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status)
     VALUES (?, ?, ?, 0, 0, ?, 'available')`,
    [o.insertId, vendorId, amount, amount]
  );
  state.allocs.push(a.insertId);
  await creditVendorBalance(vendorId, a.insertId, amount, `R8LC-${seq}`);
  return { orderId: o.insertId, allocId: a.insertId };
}

const withdraw = async (vendorId, body, headers = {}) => {
  const res = mockRes();
  await withdrawVendorBalance({
    user: { id: vendorId, role: 'vendor' },
    body,
    headers,
    get: (h) => headers[String(h).toLowerCase()],
  }, res);
  return res;
};

const alloc = async (id) => (await pool.execute(`SELECT * FROM escrow_allocations WHERE id = ?`, [id]))[0][0];
const attemptsOf = async (vendorId) =>
  (await pool.execute(`SELECT * FROM payout_attempts WHERE vendorId = ? ORDER BY id ASC`, [vendorId]))[0];
const wallet = async (vendorId) =>
  Number((await pool.execute(`SELECT available_balance AS b FROM vendor_wallets WHERE vendorId = ?`, [vendorId]))[0][0]?.b ?? 0);
const ledgerCount = async (type, reference) =>
  Number((await pool.execute(`SELECT COUNT(*) AS c FROM wallet_transactions WHERE type = ? AND reference = ?`, [type, reference]))[0][0].c);
const notificationsFor = async (reference) =>
  Number((await pool.execute(`SELECT COUNT(*) AS c FROM notifications WHERE message LIKE ?`, [`%${reference}%`]))[0][0].c);
const backdate = (reference, minutes) =>
  pool.execute(`UPDATE payout_attempts SET created_at = DATE_SUB(NOW(), INTERVAL ${Number(minutes)} MINUTE) WHERE reference = ?`, [reference]);
const reload = async (reference) => (await pool.execute(`SELECT * FROM payout_attempts WHERE reference = ?`, [reference]))[0][0];

/** Invariant I-15 after a transition. */
const assertConsistent = async (vendorId, label = '') => {
  const c = await checkVendorPayoutConsistency(vendorId);
  assert.ok(c.ok, `wallet/ledger inconsistent ${label}: ${JSON.stringify(c)}`);
};
const ev = (attempt, extra = {}) => ({ amountMinor: Math.round(Number(attempt.amount) * 100), currency: 'GHS', ...extra });

before(async () => {
  if (!dbAvailable) return;
  pool = (await import('../config/db.js')).default;
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(String(process.env.DB_HOST)),
    `REFUSING TO RUN: DB_HOST ${process.env.DB_HOST} is not a local disposable database`);
  // A reachable database without the payout lifecycle schema is a FAILURE,
  // not a skip — otherwise a missing migration would look green.
  await pool.query('SELECT withdrawalId, amountMinor, lastCheckedAt FROM payout_attempts LIMIT 0')
    .catch((err) => { throw new Error(`payout lifecycle schema missing — run \`npm run db:migrate\` (migratePayoutLifecycle.js): ${err.message}`); });
  ({ default: paystackServices } = await import('../Services/paystackservices.js'));
  ({ withdrawVendorBalance, parseWithdrawalAmountMinor } = await import('../controllers/vendorController.js'));
  ({ settleTransferSuccess, settleTransferFailed, settleTransferReversed, checkVendorPayoutConsistency, alertPayoutAttempt } =
    await import('../Services/transferSettlementService.js'));
  const rec = await import('../Services/transferReconciliationService.js');
  ({ reconcilePayoutAttempt, reconcileStuckTransfers } = rec);
  hooks = rec.transferReconciliationHooks;
  ({ creditVendorBalance } = await import('../Services/walletService.js'));
  ({ voidEscrowForOrder } = await import('../Services/escrowService.js'));
  ({ signUserToken } = await import('../utils/generateToken.js'));
  ({ startServer } = await import('./helpers/httpHarness.js'));

  // At least one admin, so alerts have a recipient.
  await mkUser('admin', 'admin');

  origInitiate = paystackServices.initiateTransfer;
  paystackServices.initiateTransfer = async (amount, _recipient, _reason, reference) => {
    provider.initiateCalls += 1;
    provider.known.add(reference);
    const mode = provider.nextInitiate.shift() ?? 'ok';
    const amountMinor = Math.round(Number(amount) * 100);
    if (typeof mode === 'function') return mode(reference, amountMinor);
    if (mode === 'ok' || mode === 'otp') {
      const status = mode === 'otp' ? 'otp' : 'pending';
      provider.transfers.set(reference, { status, amount: amountMinor, currency: 'GHS', reference });
      return { status: true, message: 'Transfer has been queued', data: { reference, status, transfer_code: `TRF_${reference.slice(-8)}` } };
    }
    if (mode === 'timeout-accepted') {
      // Paystack accepted it, our process never saw the answer.
      provider.transfers.set(reference, { status: 'pending', amount: amountMinor, currency: 'GHS', reference });
      throw Object.assign(new Error('timeout of 30000ms exceeded'), { hadProviderResponse: false, providerStatus: null });
    }
    if (mode === 'timeout-lost') {
      throw Object.assign(new Error('socket hang up'), { hadProviderResponse: false, providerStatus: null });
    }
    if (mode === 'reject4xx') {
      throw Object.assign(new Error('Insufficient balance'), { hadProviderResponse: true, providerStatus: 400 });
    }
    throw new Error(`unknown stub mode ${mode}`);
  };

  origVerify = hooks.verifyTransfer;
  hooks.verifyTransfer = async (reference) => {
    // Never touch payout attempts that other suites own.
    if (!provider.known.has(reference)) throw httpError(503, 'not a test transfer');
    provider.verifyCalls.push(reference);
    if (provider.verifyError) throw provider.verifyError;
    const t = provider.transfers.get(reference);
    if (!t) throw httpError(404, 'Transfer not found');
    return { data: { status: true, data: { ...t } } };
  };
});

after(async () => {
  if (!dbAvailable) {
    await (await import('../config/db.js')).default.end().catch(() => {});
    return;
  }
  // before() may have failed part-way (e.g. schema missing): restore only
  // what was replaced, and always end the pool so the run cannot hang.
  if (paystackServices && origInitiate) paystackServices.initiateTransfer = origInitiate;
  if (hooks && origVerify) hooks.verifyTransfer = origVerify;
  pool = pool || (await import('../config/db.js')).default;
  const ids = (a) => a.map(() => '?').join(',');
  if (state.users.length) {
    const u = state.users;
    await pool.execute(`DELETE FROM payout_attempts WHERE vendorId IN (${ids(u)})`, u).catch(() => {});
    await pool.execute(`DELETE FROM vendor_withdrawals WHERE vendorId IN (${ids(u)})`, u).catch(() => {});
    await pool.execute(`DELETE FROM financial_events WHERE vendorId IN (${ids(u)})`, u).catch(() => {});
    await pool.execute(`DELETE FROM wallet_transactions WHERE vendorId IN (${ids(u)})`, u).catch(() => {});
  }
  if (state.allocs.length) {
    await pool.execute(`DELETE FROM financial_events WHERE allocationId IN (${ids(state.allocs)})`, state.allocs).catch(() => {});
    await pool.execute(`DELETE FROM escrow_allocations WHERE id IN (${ids(state.allocs)})`, state.allocs).catch(() => {});
  }
  if (state.orders.length) await pool.execute(`DELETE FROM orders WHERE id IN (${ids(state.orders)})`, state.orders).catch(() => {});
  if (state.users.length) {
    const u = state.users;
    await pool.execute(`DELETE FROM notifications WHERE userId IN (${ids(u)})`, u).catch(() => {});
    await pool.execute(`DELETE FROM vendor_wallets WHERE vendorId IN (${ids(u)})`, u).catch(() => {});
    await pool.execute(`DELETE FROM vendors WHERE userId IN (${ids(u)})`, u).catch(() => {});
    await pool.execute(`DELETE FROM users WHERE id IN (${ids(u)})`, u).catch(() => {});
  }
  await pool.end();
});

describe('payout lifecycle (R-8)', { skip: !dbAvailable }, () => {
  // 1 ------------------------------------------------------------------------
  test('1. normal withdrawal: reserve → provider ack → success webhook settles once', async () => {
    const v = await mkVendor('ok');
    const { allocId } = await mkCreditedAlloc(v, 100);
    const res = await withdraw(v, { amount: '100' });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.ok(res.body.withdrawalId);
    const [a] = await attemptsOf(v);
    assert.equal(a.status, 'processing');
    assert.equal(Number(a.amountMinor), 10000);
    assert.equal(a.currency, 'GHS');
    assert.equal(Number(a.withdrawalId), res.body.withdrawalId);
    assert.ok(a.initiatedAt, 'provider acknowledgement recorded');
    assert.equal((await alloc(allocId)).status, 'releasing');
    await assertConsistent(v, 'after reserve');

    assert.equal(await settleTransferSuccess(a.reference, ev(a)), 'settled');
    assert.equal((await reload(a.reference)).status, 'succeeded');
    assert.equal((await alloc(allocId)).status, 'released');
    assert.equal(await wallet(v), 0);
    assert.equal(await ledgerCount('withdrawal', a.reference), 1);
    await assertConsistent(v, 'after success');
  });

  // 2 / 15 -------------------------------------------------------------------
  test('2/15. definitive failure restores exactly the reserved amount, exactly once', async () => {
    const v = await mkVendor('fail');
    const { allocId } = await mkCreditedAlloc(v, 80);
    await withdraw(v, { amount: 80 });
    const [a] = await attemptsOf(v);
    provider.transfers.get(a.reference).status = 'failed';

    assert.equal(await settleTransferFailed(a.reference, ev(a)), 'settled');
    assert.equal(await settleTransferFailed(a.reference, ev(a)), 'already');
    await backdate(a.reference, 120);
    assert.equal(await reconcilePayoutAttempt(await reload(a.reference)), 'skipped', 'terminal attempts are not reconciled');
    const al = await alloc(allocId);
    assert.equal(al.status, 'available');
    assert.equal(Number(al.payoutAmount), 80, 'restored once, not twice');
    assert.equal(await wallet(v), 80);
    await assertConsistent(v);
    // The restored money is withdrawable again, under a NEW reference.
    const again = await withdraw(v, { amount: 80 });
    assert.equal(again.statusCode, 200);
    const attempts = await attemptsOf(v);
    assert.equal(attempts.length, 2);
    assert.notEqual(attempts[1].reference, attempts[0].reference);
  });

  // 3 / 16 -------------------------------------------------------------------
  test('3/16. initiate timeout keeps the reservation; the same money cannot be reserved again', async () => {
    const v = await mkVendor('timeout');
    const { allocId } = await mkCreditedAlloc(v, 50);
    provider.nextInitiate.push('timeout-lost');
    const res = await withdraw(v, { amount: 50 });
    assert.equal(res.statusCode, 200, 'a reservation exists, so the request is accepted as pending');
    assert.equal(res.body.pending, 1);
    const [a] = await attemptsOf(v);
    assert.equal(a.status, 'processing');
    assert.equal(a.initiatedAt, null);
    assert.match(a.lastError, /socket hang up/);
    assert.equal(Number((await alloc(allocId)).payoutAmount), 0, 'reserved');
    assert.equal(await wallet(v), 50, 'wallet not debited without confirmation');
    await assertConsistent(v);

    const second = await withdraw(v, { amount: 50 });
    assert.equal(second.statusCode, 400, 'no double reservation while the outcome is unknown');

    // Verify says "pending": nothing moves.
    provider.transfers.set(a.reference, { status: 'pending', amount: 5000, currency: 'GHS', reference: a.reference });
    await backdate(a.reference, 45);
    assert.equal(await reconcilePayoutAttempt(await reload(a.reference)), 'pending');
    assert.equal((await reload(a.reference)).status, 'processing');
    assert.equal(Number((await alloc(allocId)).payoutAmount), 0);
    await assertConsistent(v);
  });

  // 4 ------------------------------------------------------------------------
  test('4. provider confirms but the local settlement write fails: rolled back, settled once on redelivery', async () => {
    const v = await mkVendor('dbfail');
    const { allocId } = await mkCreditedAlloc(v, 60);
    await withdraw(v, { amount: 60 });
    const [a] = await attemptsOf(v);
    const trig = `trg_r8_${TS}`;
    await pool.query(
      `CREATE TRIGGER ${trig} BEFORE INSERT ON wallet_transactions FOR EACH ROW
       BEGIN IF NEW.reference = '${a.reference}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected ledger failure'; END IF; END`
    );
    try {
      await assert.rejects(() => settleTransferSuccess(a.reference, ev(a)), /injected ledger failure/);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${trig}`);
    }
    const mid = await reload(a.reference);
    assert.equal(mid.status, 'processing', 'nothing half-applied');
    assert.equal(await wallet(v), 60);
    assert.equal(await ledgerCount('withdrawal', a.reference), 0);
    await assertConsistent(v, 'after failed write');

    // Paystack redelivers the webhook.
    assert.equal(await settleTransferSuccess(a.reference, ev(a)), 'settled');
    assert.equal(await settleTransferSuccess(a.reference, ev(a)), 'already');
    assert.equal(await wallet(v), 0);
    assert.equal(await ledgerCount('withdrawal', a.reference), 1);
    assert.equal((await alloc(allocId)).status, 'released');
    await assertConsistent(v);
  });

  // 5 ------------------------------------------------------------------------
  test('5. duplicate success webhook and a later reconcile are no-ops', async () => {
    const v = await mkVendor('dupwh');
    await mkCreditedAlloc(v, 30);
    await withdraw(v, { amount: 30 });
    const [a] = await attemptsOf(v);
    const results = await Promise.all([settleTransferSuccess(a.reference, ev(a)), settleTransferSuccess(a.reference, ev(a))]);
    assert.deepEqual(results.sort(), ['already', 'settled']);
    provider.transfers.get(a.reference).status = 'success';
    assert.equal(await reconcilePayoutAttempt(await reload(a.reference)), 'skipped');
    assert.equal(await ledgerCount('withdrawal', a.reference), 1);
    assert.equal(await wallet(v), 0);
    await assertConsistent(v);
  });

  // 6 ------------------------------------------------------------------------
  test('6. webhook arrives before the initiate request returns', async () => {
    const v = await mkVendor('early');
    const { allocId } = await mkCreditedAlloc(v, 40);
    provider.nextInitiate.push(async (reference, amountMinor) => {
      provider.transfers.set(reference, { status: 'success', amount: amountMinor, currency: 'GHS', reference });
      // The signed webhook is processed while our POST /transfer is still open.
      assert.equal(await settleTransferSuccess(reference, { amountMinor, currency: 'GHS' }), 'settled');
      return { status: true, data: { reference, status: 'success' } };
    });
    const res = await withdraw(v, { amount: 40 });
    assert.equal(res.statusCode, 200);
    const [a] = await attemptsOf(v);
    assert.equal(a.status, 'succeeded', 'late ack must not resurrect processing');
    assert.ok(a.initiatedAt);
    assert.equal((await alloc(allocId)).status, 'released');
    assert.equal(await ledgerCount('withdrawal', a.reference), 1);
    await assertConsistent(v);
  });

  // 7 ------------------------------------------------------------------------
  test('7. crash after the reservation committed: reconcile restores (never sent) or settles (sent)', async () => {
    const v = await mkVendor('crash');
    const { allocId } = await mkCreditedAlloc(v, 70);
    // Two crashes: one before the request left, one after Paystack accepted it.
    provider.nextInitiate.push('timeout-lost', 'timeout-accepted');
    const r1 = await withdraw(v, { amount: 30 });
    const r2 = await withdraw(v, { amount: 40 });
    assert.equal(r1.statusCode, 200);
    assert.equal(r2.statusCode, 200);
    const [lost, sent] = await attemptsOf(v);
    // Emulate the dead process: no error was ever recorded.
    await pool.execute(`UPDATE payout_attempts SET lastError = NULL WHERE vendorId = ?`, [v]);
    await backdate(lost.reference, 61);
    await backdate(sent.reference, 61);
    await assertConsistent(v, 'while both are unknown');

    assert.equal(await reconcilePayoutAttempt(await reload(lost.reference)), 'failed');
    provider.transfers.get(sent.reference).status = 'success';
    assert.equal(await reconcilePayoutAttempt(await reload(sent.reference)), 'succeeded');

    const al = await alloc(allocId);
    assert.equal(Number(al.payoutAmount), 30, 'only the never-sent part is withdrawable again');
    assert.equal(al.status, 'available');
    assert.equal(await wallet(v), 30);
    assert.equal(provider.initiateCalls >= 2, true);
    await assertConsistent(v);
  });

  test('7b. "not found" inside the grace window does not release; after an ack it escalates', async () => {
    const v = await mkVendor('grace');
    await mkCreditedAlloc(v, 20);
    provider.nextInitiate.push('timeout-lost');
    await withdraw(v, { amount: 20 });
    const [a] = await attemptsOf(v);
    await backdate(a.reference, 35);
    assert.equal(await reconcilePayoutAttempt(await reload(a.reference)), 'pending', '404 within 60 min is not proof');
    assert.equal((await reload(a.reference)).status, 'processing');

    const v2 = await mkVendor('ack404');
    await mkCreditedAlloc(v2, 20);
    await withdraw(v2, { amount: 20 }); // acknowledged
    const [b] = await attemptsOf(v2);
    provider.transfers.delete(b.reference);
    await backdate(b.reference, 300);
    assert.equal(await reconcilePayoutAttempt(await reload(b.reference)), 'review');
    const after = await reload(b.reference);
    assert.equal(after.status, 'reconciliation_required');
    assert.match(after.reviewReason, /provider_not_found_after_ack/);
    assert.equal(await wallet(v2), 20, 'contradictory evidence never releases or debits');
    await assertConsistent(v2);
  });

  test('7c. an initiate the provider rejected with 4xx is released after the short grace', async () => {
    const v = await mkVendor('rej');
    const { allocId } = await mkCreditedAlloc(v, 25);
    provider.nextInitiate.push('reject4xx');
    await withdraw(v, { amount: 25 });
    const [a] = await attemptsOf(v);
    assert.equal(a.initiateHttpStatus, 400);
    await backdate(a.reference, 11);
    assert.equal(await reconcilePayoutAttempt(await reload(a.reference)), 'failed');
    assert.equal(Number((await alloc(allocId)).payoutAmount), 25);
    await assertConsistent(v);
  });

  // 8 ------------------------------------------------------------------------
  test('8. concurrent requests for the same balance reserve it once', async () => {
    const v = await mkVendor('race');
    const { allocId } = await mkCreditedAlloc(v, 100);
    const results = await Promise.all(Array.from({ length: 6 }, () => withdraw(v, { amount: 100 })));
    assert.equal(results.filter((r) => r.statusCode === 200).length, 1);
    assert.equal((await attemptsOf(v)).length, 1);
    assert.equal(Number((await alloc(allocId)).payoutAmount), 0);
    await assertConsistent(v);
  });

  test('8c. overlapping partial requests (3 × 60 against 100) cannot over-reserve', async () => {
    for (let round = 0; round < 3; round += 1) {
      const v = await mkVendor(`overlap${round}`);
      const { allocId } = await mkCreditedAlloc(v, 100);
      const results = await Promise.all([60, 60, 60].map((amount) => withdraw(v, { amount })));
      assert.equal(results.filter((r) => r.statusCode === 200).length, 1, `round ${round}`);
      const reserved = (await attemptsOf(v)).reduce((sum, a) => sum + Number(a.amount), 0);
      assert.equal(reserved, 60);
      assert.equal(Number((await alloc(allocId)).payoutAmount), 40);
      await assertConsistent(v);
    }
  });

  test('8b. a timed-out reservation counts toward the request (no over-reservation across allocations)', async () => {
    const v = await mkVendor('overres');
    await mkCreditedAlloc(v, 100);
    await mkCreditedAlloc(v, 100);
    provider.nextInitiate.push('timeout-lost', 'timeout-lost');
    const res = await withdraw(v, { amount: 100 });
    assert.equal(res.statusCode, 200);
    const attempts = await attemptsOf(v);
    const reserved = attempts.reduce((s, a) => s + Number(a.amount), 0);
    assert.equal(reserved, 100, `requested 100, reserved ${reserved}`);
    assert.equal(attempts.length, 1);
    await assertConsistent(v);
  });

  // 9 ------------------------------------------------------------------------
  test('9. several legitimate partial withdrawals drain one allocation, then it is released', async () => {
    const v = await mkVendor('partials');
    const { allocId } = await mkCreditedAlloc(v, 100);
    for (const amt of ['30', '30.50', '39.50']) {
      const r = await withdraw(v, { amount: amt });
      assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    }
    const attempts = await attemptsOf(v);
    assert.deepEqual(attempts.map((a) => Number(a.amountMinor)), [3000, 3050, 3950]);
    assert.equal((await alloc(allocId)).status, 'releasing');
    for (const a of attempts.slice(0, 2)) assert.equal(await settleTransferSuccess(a.reference, ev(a)), 'settled');
    assert.equal((await alloc(allocId)).status, 'releasing', 'one still in flight');
    await settleTransferSuccess(attempts[2].reference, ev(attempts[2]));
    const al = await alloc(allocId);
    assert.equal(al.status, 'released');
    assert.equal(Number(al.payoutAmount), 0);
    assert.equal(await wallet(v), 0);
    await assertConsistent(v);
  });

  // 10 -----------------------------------------------------------------------
  test('10a. R-8: first partial fails while the later payout of the remainder is in flight', async () => {
    const v = await mkVendor('r8a');
    const { allocId } = await mkCreditedAlloc(v, 100);
    await withdraw(v, { amount: 40 });
    await withdraw(v, { amount: 60 });
    const [first, second] = await attemptsOf(v);
    assert.equal((await alloc(allocId)).status, 'releasing');

    assert.equal(await settleTransferFailed(first.reference, ev(first)), 'settled', 'used to throw forever');
    let al = await alloc(allocId);
    assert.equal(al.status, 'available');
    assert.equal(Number(al.payoutAmount), 40);
    await assertConsistent(v, 'after first failed');

    assert.equal(await settleTransferSuccess(second.reference, ev(second)), 'settled');
    al = await alloc(allocId);
    assert.equal(al.status, 'available');
    assert.equal(Number(al.payoutAmount), 40);
    assert.equal(await wallet(v), 40);
    await assertConsistent(v, 'after second succeeded');
    assert.equal((await withdraw(v, { amount: 40 })).statusCode, 200, 'the 40 is withdrawable again');
  });

  test('10b. R-8: later payout already succeeded (allocation released), then the first fails', async () => {
    const v = await mkVendor('r8b');
    const { allocId } = await mkCreditedAlloc(v, 100);
    await withdraw(v, { amount: 40 });
    await withdraw(v, { amount: 60 });
    const [first, second] = await attemptsOf(v);
    await settleTransferSuccess(second.reference, ev(second));
    assert.equal((await alloc(allocId)).status, 'releasing', 'first still in flight');
    assert.equal(await settleTransferFailed(first.reference, ev(first)), 'settled');
    const al = await alloc(allocId);
    assert.equal(al.status, 'available');
    assert.equal(Number(al.payoutAmount), 40);
    assert.equal(await wallet(v), 40);
    await assertConsistent(v);
  });

  test('10c. R-8: order refunded while a partial is in flight, then that partial fails → clawed back once', async () => {
    const v = await mkVendor('r8c');
    const { orderId, allocId } = await mkCreditedAlloc(v, 100);
    await withdraw(v, { amount: 40 });
    const [first] = await attemptsOf(v);
    await pool.execute(`UPDATE orders SET paymentStatus = 'refunded', orderStatus = 'cancelled' WHERE id = ?`, [orderId]);
    await voidEscrowForOrder(orderId); // claws back the 60 remainder
    assert.equal((await alloc(allocId)).status, 'failed');
    assert.equal(await wallet(v), 40, 'only the in-flight 40 is left');
    await assertConsistent(v, 'after void');

    assert.equal(await settleTransferFailed(first.reference, ev(first)), 'settled', 'used to throw forever');
    assert.equal(await settleTransferFailed(first.reference, ev(first)), 'already');
    assert.equal((await alloc(allocId)).status, 'failed', 'a voided allocation is never re-opened');
    assert.equal(await wallet(v), 0, 'returned money of a refunded order is clawed back');
    assert.equal(await ledgerCount('clawback', `clawback:payout:${first.reference}`), 1);
    assert.equal((await withdraw(v, { amount: 1 })).statusCode, 400);
    await assertConsistent(v);
  });

  test('10d. reversal of a succeeded partial after the remainder was released', async () => {
    const v = await mkVendor('r8d');
    const { allocId } = await mkCreditedAlloc(v, 100);
    await withdraw(v, { amount: 40 });
    await withdraw(v, { amount: 60 });
    const [first, second] = await attemptsOf(v);
    await settleTransferSuccess(first.reference, ev(first));
    await settleTransferSuccess(second.reference, ev(second));
    assert.equal((await alloc(allocId)).status, 'released');
    assert.equal(await settleTransferReversed(first.reference, ev(first)), 'settled');
    assert.equal(await settleTransferReversed(first.reference, ev(first)), 'already');
    const al = await alloc(allocId);
    assert.equal(al.status, 'available');
    assert.equal(Number(al.payoutAmount), 40);
    assert.equal(await wallet(v), 40);
    assert.equal(await ledgerCount('reversal', first.reference), 1);
    await assertConsistent(v);
  });

  test('10e. INT-1: full payout in flight, order fully refunded, then the transfer fails → clawed back, not re-opened', async () => {
    const v = await mkVendor('int1full');
    const { orderId, allocId } = await mkCreditedAlloc(v, 50);
    await withdraw(v, { amount: 50 });
    const [a] = await attemptsOf(v);
    await pool.execute(`UPDATE orders SET paymentStatus = 'refunded', orderStatus = 'cancelled' WHERE id = ?`, [orderId]);
    await voidEscrowForOrder(orderId); // leaves the 'releasing' allocation alone (in flight)
    assert.equal((await alloc(allocId)).status, 'releasing');
    assert.equal(await settleTransferFailed(a.reference, ev(a)), 'settled');
    const al = await alloc(allocId);
    assert.equal(al.status, 'failed', 'returned money of a refunded order is not withdrawable');
    assert.equal(Number(al.payoutAmount), 0);
    assert.equal(await wallet(v), 0);
    assert.equal(await ledgerCount('clawback', `clawback:payout:${a.reference}`), 1);
    assert.equal((await withdraw(v, { amount: 1 })).statusCode, 400);
    await assertConsistent(v);
  });

  test('10f. INT-1: partial (per-vendor) refund while that vendor\'s payout is in flight, then it fails → clawed back', async () => {
    const v = await mkVendor('int1partial');
    const { orderId, allocId } = await mkCreditedAlloc(v, 30);
    await withdraw(v, { amount: 30 });
    const [a] = await attemptsOf(v);
    // The order stays PAID; only this vendor's lines were refunded (as returnController journals it).
    await pool.execute(
      `INSERT INTO financial_events (eventType, currency, amount, direction, vendorId, orderId, dedupeKey)
       VALUES ('refund', 'GHS', 30, 'out', ?, ?, ?)`, [v, orderId, `refund:${orderId}:r8lc:partial:${v}`]);
    assert.equal(await settleTransferFailed(a.reference, ev(a)), 'settled');
    assert.equal((await alloc(allocId)).status, 'failed');
    assert.equal(await wallet(v), 0, 'not withdrawable on a still-paid order either');
    assert.equal((await withdraw(v, { amount: 1 })).statusCode, 400);
    await assertConsistent(v);
  });

  test('10g. INT-2: a crash-stranded wallet credit is recovered even behind 200+ ordinary available balances', async () => {
    const { reconcileAvailableAllocations } = await import('../Services/escrowService.js');
    const v = await mkVendor('int2');
    const N = 205;
    const tagBase = `R8INT2-${TS}`;
    await pool.query(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
         paymentMethod, paymentStatus, orderStatus, shippingCost, tax, discount, escrowStatus)
       VALUES ${Array.from({ length: N + 1 }, (_, i) => `(${v}, '${tagBase}-${i}', '[]', 1, '{}', '{}', 'card', 'paid', 'delivered', 0, 0, 0, 'released')`).join(',')}`);
    const [orderRows] = await pool.execute(`SELECT id FROM orders WHERE orderNumber LIKE ? ORDER BY id`, [`${tagBase}-%`]);
    for (const r of orderRows) state.orders.push(r.id);
    const ordinary = orderRows.slice(0, N);
    const strandedOrder = orderRows[N];
    await pool.query(
      `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status)
       VALUES ${ordinary.map((r) => `(${r.id}, ${v}, 1, 0, 0, 1, 'available')`).join(',')}`);
    const [ids] = await pool.execute(`SELECT id FROM escrow_allocations WHERE vendorId = ? ORDER BY id`, [v]);
    for (const r of ids) state.allocs.push(r.id);
    await pool.query(
      `INSERT INTO wallet_transactions (vendorId, type, amount, allocationId, note, status)
       VALUES ${ids.map((r) => `(${v}, 'credit', 1, ${r.id}, 'fixture', 'succeeded')`).join(',')}`);
    await pool.execute(`INSERT INTO vendor_wallets (vendorId, available_balance, total_earned) VALUES (?, ?, ?)`, [v, N, N]);
    // The newest allocation went available, but the process died before its credit.
    const [stranded] = await pool.execute(
      `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status)
       VALUES (?, ?, 7, 0, 0, 7, 'available')`, [strandedOrder.id, v]);
    state.allocs.push(stranded.insertId);
    await reconcileAvailableAllocations({ vendorId: v, limit: 200 });
    const [[credit]] = await pool.execute(
      `SELECT COUNT(*) AS c FROM wallet_transactions WHERE type = 'credit' AND allocationId = ?`, [stranded.insertId]);
    assert.equal(Number(credit.c), 1, 'the stranded credit is recovered');
    assert.equal(await wallet(v), 212);
    await assertConsistent(v);
  });

  // 11 / 23 ------------------------------------------------------------------
  test('11/23. reconciler is bounded, rotates through a large backlog, and repeated runs are idempotent', async () => {
    const v = await mkVendor('backlog');
    const { allocId } = await mkCreditedAlloc(v, 1);
    const refs = [];
    const values = [];
    for (let i = 0; i < 300; i += 1) {
      const ref = `r8bl_${TS}_${i}`;
      refs.push(ref);
      provider.known.add(ref);
      provider.transfers.set(ref, { status: 'pending', amount: 1, currency: 'GHS', reference: ref });
      values.push(`(${allocId}, ${v}, 0.01, 1, '${ref}', 0, 'processing', DATE_SUB(NOW(), INTERVAL 3 DAY))`);
    }
    // Plus terminal history that must never be scanned.
    for (let i = 0; i < 200; i += 1) {
      values.push(`(${allocId}, ${v}, 0.01, 1, 'r8hist_${TS}_${i}', 0, 'succeeded', DATE_SUB(NOW(), INTERVAL 90 DAY))`);
    }
    await pool.query(
      `INSERT INTO payout_attempts (allocationId, vendorId, amount, amountMinor, reference, isFull, status, created_at) VALUES ${values.join(',')}`
    );
    const mine = new Set(refs);

    provider.verifyCalls.length = 0;
    const s1 = await reconcileStuckTransfers({ limit: 25 });
    const run1 = provider.verifyCalls.filter((r) => mine.has(r));
    assert.ok(provider.verifyCalls.length <= 25, `bounded: ${provider.verifyCalls.length} provider calls`);
    assert.ok(run1.length > 0);
    assert.ok(s1.pending >= run1.length);

    provider.verifyCalls.length = 0;
    await reconcileStuckTransfers({ limit: 25 });
    const run2 = provider.verifyCalls.filter((r) => mine.has(r));
    assert.ok(run2.length > 0);
    assert.equal(run2.filter((r) => run1.includes(r)).length, 0, 'rotation: the second run checks different attempts');
    assert.ok(!provider.verifyCalls.some((r) => r.startsWith('r8hist_')), 'terminal history is never verified');

    // Nothing settled, nothing moved; check counters advanced exactly once.
    const [[counts]] = await pool.execute(
      `SELECT SUM(status = 'processing') AS p, SUM(checkCount) AS c FROM payout_attempts WHERE reference LIKE ?`, [`r8bl_${TS}_%`]
    );
    assert.equal(Number(counts.p), 300);
    assert.equal(Number(counts.c), run1.length + run2.length);

    const [plan] = await pool.query(
      `EXPLAIN SELECT * FROM payout_attempts WHERE status = 'processing'
         AND created_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE) ORDER BY lastCheckedAt ASC, id ASC LIMIT 25`
    );
    assert.notEqual(plan[0].type, 'ALL', `reconciler query must use an index: ${JSON.stringify(plan[0])}`);
    assert.ok(plan[0].key, 'an index is chosen');

    await pool.execute(`DELETE FROM payout_attempts WHERE reference LIKE ? OR reference LIKE ?`, [`r8bl_${TS}_%`, `r8hist_${TS}_%`]);
  });

  // 12 -----------------------------------------------------------------------
  test('12. duplicate withdrawal request (same idempotency key) reserves once', async () => {
    const v = await mkVendor('dupreq');
    await mkCreditedAlloc(v, 90);
    const key = `key-${TS}-dup`;
    const results = await Promise.all([
      withdraw(v, { amount: 30, requestKey: key }),
      withdraw(v, { amount: 30 }, { 'idempotency-key': key }),
    ]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
    assert.equal(results.find((r) => r.statusCode === 409).body.duplicate, true);
    assert.equal((await attemptsOf(v)).length, 1);
    const mismatch = await withdraw(v, { amount: 31, requestKey: key });
    assert.equal(mismatch.statusCode, 422);
    assert.equal((await attemptsOf(v)).length, 1);
    await assertConsistent(v);
  });

  // 13 / 17 ------------------------------------------------------------------
  test('13/17. provider unreachable: reservation kept, one deduplicated alert after 24h', async () => {
    const v = await mkVendor('down');
    await mkCreditedAlloc(v, 15);
    await withdraw(v, { amount: 15 });
    const [a] = await attemptsOf(v);
    provider.verifyError = httpError(503, 'Service Unavailable');
    try {
      await backdate(a.reference, 45);
      assert.equal(await reconcilePayoutAttempt(await reload(a.reference)), 'errored');
      assert.equal(await notificationsFor(a.reference), 0, 'no alert before the window');
      await backdate(a.reference, 25 * 60);
      assert.equal(await reconcilePayoutAttempt(await reload(a.reference)), 'errored');
      const alerted = await notificationsFor(a.reference);
      assert.ok(alerted >= 1, 'admins alerted');
      assert.equal(await reconcilePayoutAttempt(await reload(a.reference)), 'errored');
      assert.equal(await notificationsFor(a.reference), alerted, 'deduplicated');
      assert.equal(await alertPayoutAttempt(await reload(a.reference), 'provider_unreachable', 'again'), false);
    } finally {
      provider.verifyError = null;
    }
    const row = await reload(a.reference);
    assert.equal(row.status, 'processing', 'age alone never fails a payout');
    assert.equal(row.alertedReason, 'provider_unreachable');
    assert.match(row.lastError, /HTTP 503/);
    assert.equal(await wallet(v), 15);
    await assertConsistent(v);
  });

  // 14 -----------------------------------------------------------------------
  test('14. provider confirms success after our local timeout', async () => {
    const v = await mkVendor('latesuccess');
    const { allocId } = await mkCreditedAlloc(v, 45);
    provider.nextInitiate.push('timeout-accepted');
    await withdraw(v, { amount: 45 });
    const [a] = await attemptsOf(v);
    provider.transfers.get(a.reference).status = 'success';
    await backdate(a.reference, 31);
    assert.equal(await reconcilePayoutAttempt(await reload(a.reference)), 'succeeded');
    assert.equal(await wallet(v), 0);
    assert.equal((await alloc(allocId)).status, 'released');
    await assertConsistent(v);
  });

  test('16b. OTP / non-final provider states keep funds reserved and alert once', async () => {
    const v = await mkVendor('otp');
    await mkCreditedAlloc(v, 12);
    provider.nextInitiate.push('otp');
    await withdraw(v, { amount: 12 });
    const [a] = await attemptsOf(v);
    const afterInit = await notificationsFor(a.reference);
    assert.ok(afterInit >= 1, 'OTP is alerted at initiation');
    await backdate(a.reference, 40);
    assert.equal(await reconcilePayoutAttempt(await reload(a.reference)), 'attention');
    assert.equal(await notificationsFor(a.reference), afterInit, 'same reason is not re-alerted');
    assert.equal((await reload(a.reference)).status, 'processing');
    await assertConsistent(v);
  });

  // 21 -----------------------------------------------------------------------
  test('21. client cannot manipulate the amount', async () => {
    const v = await mkVendor('amt');
    await mkCreditedAlloc(v, 10);
    for (const amount of ['50abc', '-5', '1e3', '10.123', '0', '0.00', '', null, undefined, true, 'Infinity', Infinity, NaN, '10.5.1', ' ', {}, [5], ['5'], '0x10', '٥']) {
      const r = await withdraw(v, { amount });
      assert.equal(r.statusCode, 400, `amount ${JSON.stringify(amount)} must be refused`);
    }
    assert.equal((await withdraw(v, { amount: '10.01' })).statusCode, 400, 'above the eligible balance');
    assert.equal(parseWithdrawalAmountMinor('10.10'), 1010);
    assert.equal(parseWithdrawalAmountMinor(0.1 + 0.2), null, 'float noise beyond 2dp is refused, not rounded');
    assert.equal((await attemptsOf(v)).length, 0);
    await assertConsistent(v);
  });

  // 22 -----------------------------------------------------------------------
  test('22. currency mismatch is refused at request time and at settlement time', async () => {
    const v = await mkVendor('ccy');
    const { allocId } = await mkCreditedAlloc(v, 10);
    assert.equal((await withdraw(v, { amount: 5, currency: 'USD' })).statusCode, 400);
    assert.equal((await attemptsOf(v)).length, 0);

    await withdraw(v, { amount: 5, currency: 'ghs' });
    const [a] = await attemptsOf(v);
    assert.equal(await settleTransferSuccess(a.reference, ev(a, { currency: 'NGN' })), 'review');
    let row = await reload(a.reference);
    assert.equal(row.status, 'reconciliation_required');
    assert.match(row.reviewReason, /currency_mismatch/);
    assert.equal(await wallet(v), 10, 'nothing booked');
    assert.ok(await notificationsFor(a.reference) >= 1);
    assert.equal(await settleTransferSuccess(a.reference, ev(a)), 'already', 'automation stays stopped');

    await withdraw(v, { amount: 5 });
    const [, b] = await attemptsOf(v);
    assert.equal(await settleTransferFailed(b.reference, ev(b, { amountMinor: 499 })), 'review');
    row = await reload(b.reference);
    assert.match(row.reviewReason, /amount_mismatch/);
    assert.equal(Number((await alloc(allocId)).payoutAmount), 0, 'mismatched failure does not restore');
    await assertConsistent(v, 'review attempts keep their reservation');
  });

  test('9b. a confirmed success the wallet cannot absorb is parked, never failed', async () => {
    const v = await mkVendor('unbookable');
    await mkCreditedAlloc(v, 20);
    await withdraw(v, { amount: 20 });
    const [a] = await attemptsOf(v);
    // Corrupt the wallet (as a historical bug might have): it now holds less
    // than the in-flight transfer.
    await pool.execute(`UPDATE vendor_wallets SET available_balance = 5 WHERE vendorId = ?`, [v]);
    assert.equal(await settleTransferSuccess(a.reference, ev(a)), 'review');
    const row = await reload(a.reference);
    assert.equal(row.status, 'reconciliation_required');
    assert.equal(row.providerStatus, 'success');
    assert.match(row.reviewReason, /confirmed_success_unbookable/);
    const c = await checkVendorPayoutConsistency(v);
    assert.equal(c.ok, false, 'the inconsistency is visible');
  });

  // 18 / 19 ------------------------------------------------------------------
  test('18/19. admin recovery is admin-only; vendors only see their own withdrawals', async () => {
    const vendorA = await mkVendor('authA');
    const vendorB = await mkVendor('authB');
    const adminId = await mkUser('admin', 'authAdmin');
    await mkCreditedAlloc(vendorA, 10);
    await mkCreditedAlloc(vendorB, 10);
    const key = `key-${TS}-shared`;
    assert.equal((await withdraw(vendorA, { amount: 5, requestKey: key })).statusCode, 200);
    const [a] = await attemptsOf(vendorA);
    await backdate(a.reference, 45);

    const { default: adminPayoutRoutes } = await import('../routes/adminPayoutRoutes.js');
    const { default: vendorRoutes } = await import('../routes/vendorRoutes.js');
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/admin/payouts', adminPayoutRoutes);
    app.use('/api/vendors', vendorRoutes);
    const srv = await startServer(app);
    const call = (method, path, userId, body) => fetch(`${srv.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(userId ? { cookie: `jwt=${signUserToken({ id: userId, tokenVersion: 0 })}` } : {}),
      },
      body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
    });
    try {
      provider.verifyCalls.length = 0;
      for (const [method, path] of [['GET', '/api/admin/payouts/unresolved'], ['GET', `/api/admin/payouts/${a.id}`],
        ['POST', `/api/admin/payouts/${a.id}/reconcile`], ['POST', `/api/admin/payouts/${a.id}/note`]]) {
        assert.equal((await call(method, path, null, { note: 'anonymous attempt' })).status, 401, `${method} ${path} anonymous`);
        const asVendor = await call(method, path, vendorA, { note: 'vendor attempt here' });
        assert.ok([401, 403].includes(asVendor.status), `${method} ${path} as vendor → ${asVendor.status}`);
      }
      assert.equal(provider.verifyCalls.length, 0, 'no provider call on a rejected request');
      assert.equal((await reload(a.reference)).resolutionNote, null);

      const list = await (await call('GET', '/api/admin/payouts/unresolved', adminId)).json();
      const listed = list.payouts.find((p) => p.id === a.id);
      assert.ok(listed, 'admin sees the unresolved payout');
      assert.equal(listed.recipientCode, undefined, 'no payout destination details exposed');
      assert.ok(listed.explanation);

      const detail = await (await call('GET', `/api/admin/payouts/${a.id}`, adminId)).json();
      assert.equal(detail.consistency.ok, true);

      provider.transfers.get(a.reference).status = 'success';
      const rec = await call('POST', `/api/admin/payouts/${a.id}/reconcile`, adminId);
      assert.equal(rec.status, 200);
      assert.equal((await rec.json()).outcome, 'succeeded');
      const again = await call('POST', `/api/admin/payouts/${a.id}/reconcile`, adminId);
      assert.equal(again.status, 409, 'nothing to do on a settled payout');
      const noted = await call('POST', `/api/admin/payouts/${a.id}/note`, adminId, { note: 'checked dashboard, settled' });
      assert.equal(noted.status, 200);
      const [[audit]] = await pool.execute(
        `SELECT COUNT(*) AS c FROM admin_audit_log WHERE entityType = 'payout_attempt' AND entityId = ? AND actorId = ?`,
        [String(a.id), adminId]
      );
      assert.ok(Number(audit.c) >= 3, 'every admin action is audited');

      // Vendor B: own list only; reusing A's key creates B's own request.
      const bList = await (await call('GET', '/api/vendors/withdrawals', vendorB)).json();
      assert.equal(bList.withdrawals.length, 0, 'vendor B cannot see vendor A');
      const bRes = await withdraw(vendorB, { amount: 5, requestKey: key });
      assert.equal(bRes.statusCode, 200, 'keys are scoped per vendor');
      const aList = await (await call('GET', '/api/vendors/withdrawals', vendorA)).json();
      assert.equal(aList.withdrawals.length, 1);
      assert.ok(aList.withdrawals.every((w) => Number(w.vendorId) === vendorA));
    } finally {
      await srv.close();
    }
  });
});
