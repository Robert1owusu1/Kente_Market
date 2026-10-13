// FILE LOCATION: backend/tests/payoutAdminPolicy.test.js
// DESCRIPTION: Payout authorization + resolution policy (PAYOUT_LIFECYCLE_DESIGN.md §7.1).
//   - view_earnings alone no longer initiates withdrawals; request_payouts does,
//     and only the store OWNER can grant it (staff managers cannot);
//   - a reconciliation_required payout can be re-verified only by an admin,
//     with acknowledge + justification note; the outcome goes through the
//     normal settlement checks, so contradictory evidence stays parked and a
//     provider "not found" never releases funds;
//   - every admin action lands in the per-attempt history; inputs validated.
// Real routers + middleware over HTTP; Paystack stubbed; disposable DB only.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

process.env.REDIS_URL = '';
process.env.EMAIL_DISABLED = '1';

let dbAvailable = true;
{
  const probe = (await import('../config/db.js')).default;
  try { await probe.query('SELECT 1'); } catch { dbAvailable = false; }
}

/** @type {any} */ let pool, server, paystackServices, origInitiate, hooks, origVerify;
/** @type {any} */ let creditVendorBalance, settleTransferSuccess;
const TS = Date.now();
const users = [];
const staffIds = [];
const orders = [];
const allocs = [];
const provider = { transfers: new Map(), known: new Set(), verifyCalls: 0 };
let seq = 0;

const ownerToken = (id) => jwt.sign({ id, tv: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
const staffToken = (staffId, vendorId) =>
  jwt.sign({ id: staffId, vendorId, role: 'vendor_staff', tv: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });

const call = async (method, path, token, body) => {
  const res = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { cookie: `jwt=${token}` } : {}) },
    body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, json };
};

async function mkUser(role, name) {
  const [r] = await pool.execute(
    `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified, tokenVersion)
     VALUES ('Pol', ?, ?, 'x', ?, 1, 1, 0)`,
    [name, `pol-${name}-${TS}-${++seq}@test.local`, role]
  );
  users.push(r.insertId);
  return r.insertId;
}
async function mkVendor(name) {
  const id = await mkUser('vendor', name);
  await pool.execute(`INSERT INTO vendors (userId, businessName, status, recipientCode) VALUES (?, ?, 'approved', ?)`,
    [id, `pol-${name}-${TS}-${seq}`, `RCP_POL_${id}`]);
  return id;
}
async function mkStaff(vendorId, permissions) {
  const [r] = await pool.execute(
    `INSERT INTO vendor_staff (vendorId, name, email, password, permissions) VALUES (?, 'Pol Staff', ?, 'x', ?)`,
    [vendorId, `pol-staff-${TS}-${++seq}@test.local`, JSON.stringify(permissions)]
  );
  staffIds.push(r.insertId);
  return r.insertId;
}
async function mkCreditedAlloc(vendorId, amount) {
  seq += 1;
  const [o] = await pool.execute(
    `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
       paymentMethod, paymentStatus, orderStatus, shippingCost, tax, discount, escrowStatus)
     VALUES (?, ?, '[]', ?, '{}', '{}', 'card', 'paid', 'delivered', 0, 0, 0, 'released')`,
    [vendorId, `POL-${TS}-${seq}`, amount]
  );
  orders.push(o.insertId);
  const [a] = await pool.execute(
    `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status)
     VALUES (?, ?, ?, 0, 0, ?, 'available')`,
    [o.insertId, vendorId, amount, amount]
  );
  allocs.push(a.insertId);
  await creditVendorBalance(vendorId, a.insertId, amount, `POL-${seq}`);
  return a.insertId;
}
const attemptsOf = async (vendorId) =>
  (await pool.execute(`SELECT * FROM payout_attempts WHERE vendorId = ? ORDER BY id`, [vendorId]))[0];
const reload = async (id) => (await pool.execute(`SELECT * FROM payout_attempts WHERE id = ?`, [id]))[0][0];
const walletOf = async (v) => Number((await pool.execute(`SELECT available_balance b FROM vendor_wallets WHERE vendorId = ?`, [v]))[0][0].b);

before(async () => {
  if (!dbAvailable) return;
  pool = (await import('../config/db.js')).default;
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(String(process.env.DB_HOST)), 'disposable local DB only');
  ({ default: paystackServices } = await import('../Services/paystackservices.js'));
  ({ creditVendorBalance } = await import('../Services/walletService.js'));
  ({ settleTransferSuccess } = await import('../Services/transferSettlementService.js'));
  const rec = await import('../Services/transferReconciliationService.js');
  hooks = rec.transferReconciliationHooks;
  origInitiate = paystackServices.initiateTransfer;
  paystackServices.initiateTransfer = async (amount, _r, _reason, reference) => {
    provider.known.add(reference);
    provider.transfers.set(reference, { status: 'pending', amount: Math.round(amount * 100), currency: 'GHS', reference });
    return { status: true, data: { reference, status: 'pending' } };
  };
  origVerify = hooks.verifyTransfer;
  hooks.verifyTransfer = async (reference) => {
    if (!provider.known.has(reference)) throw Object.assign(new Error('not a test transfer'), { response: { status: 503 } });
    provider.verifyCalls += 1;
    const t = provider.transfers.get(reference);
    if (!t) throw Object.assign(new Error('Transfer not found'), { response: { status: 404 } });
    return { data: { status: true, data: { ...t } } };
  };

  const { errorHandeler } = await import('../middleware/errorMiddleware.js');
  const { default: vendorRoutes } = await import('../routes/vendorRoutes.js');
  const { default: staffRoutes } = await import('../routes/staffRoutes.js');
  const { default: adminPayoutRoutes } = await import('../routes/adminPayoutRoutes.js');
  const { startServer } = await import('./helpers/httpHarness.js');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/vendors/staff', staffRoutes);
  app.use('/api/vendors', vendorRoutes);
  app.use('/api/admin/payouts', adminPayoutRoutes);
  app.use(errorHandeler);
  server = await startServer(app);
});

after(async () => {
  if (paystackServices && origInitiate) paystackServices.initiateTransfer = origInitiate;
  if (hooks && origVerify) hooks.verifyTransfer = origVerify;
  if (server) await server.close();
  pool = pool || (await import('../config/db.js')).default;
  if (dbAvailable) {
    const ids = (a) => a.map(() => '?').join(',');
    if (users.length) {
      await pool.execute(`DELETE FROM admin_audit_log WHERE entityType = 'payout_attempt' AND actorId IN (${ids(users)})`, users).catch(() => {});
      await pool.execute(`DELETE FROM payout_attempts WHERE vendorId IN (${ids(users)})`, users).catch(() => {});
      await pool.execute(`DELETE FROM vendor_withdrawals WHERE vendorId IN (${ids(users)})`, users).catch(() => {});
      await pool.execute(`DELETE FROM financial_events WHERE vendorId IN (${ids(users)})`, users).catch(() => {});
      await pool.execute(`DELETE FROM wallet_transactions WHERE vendorId IN (${ids(users)})`, users).catch(() => {});
    }
    if (allocs.length) {
      await pool.execute(`DELETE FROM financial_events WHERE allocationId IN (${ids(allocs)})`, allocs).catch(() => {});
      await pool.execute(`DELETE FROM escrow_allocations WHERE id IN (${ids(allocs)})`, allocs).catch(() => {});
    }
    if (orders.length) await pool.execute(`DELETE FROM orders WHERE id IN (${ids(orders)})`, orders).catch(() => {});
    if (staffIds.length) await pool.execute(`DELETE FROM vendor_staff WHERE id IN (${ids(staffIds)})`, staffIds).catch(() => {});
    if (users.length) {
      await pool.execute(`DELETE FROM notifications WHERE userId IN (${ids(users)})`, users).catch(() => {});
      await pool.execute(`DELETE FROM vendor_wallets WHERE vendorId IN (${ids(users)})`, users).catch(() => {});
      await pool.execute(`DELETE FROM vendors WHERE userId IN (${ids(users)})`, users).catch(() => {});
      await pool.execute(`DELETE FROM users WHERE id IN (${ids(users)})`, users).catch(() => {});
    }
  }
  await pool.end().catch(() => {});
});

describe('payout permissions (least privilege)', { skip: !dbAvailable }, () => {
  test('view_earnings alone can read earnings/withdrawals but cannot initiate a withdrawal', async () => {
    const v = await mkVendor('ve');
    await mkCreditedAlloc(v, 20);
    const viewer = await mkStaff(v, { view_earnings: true });
    const tok = staffToken(viewer, v);
    const w = await call('POST', '/api/vendors/withdraw', tok, { amount: 5 });
    assert.equal(w.status, 403, JSON.stringify(w.json));
    assert.match(w.json.message, /request_payouts/);
    assert.equal((await attemptsOf(v)).length, 0, 'nothing reserved');
    assert.equal((await call('GET', '/api/vendors/withdrawals', tok)).status, 200);
  });

  test('request_payouts allows a staff withdrawal (recorded with the staff id); the owner always can', async () => {
    const v = await mkVendor('rp');
    await mkCreditedAlloc(v, 20);
    const operator = await mkStaff(v, { request_payouts: true });
    const w = await call('POST', '/api/vendors/withdraw', staffToken(operator, v), { amount: 5 });
    assert.equal(w.status, 200, JSON.stringify(w.json));
    const [[row]] = await pool.execute(`SELECT requestedBy FROM vendor_withdrawals WHERE id = ?`, [w.json.withdrawalId]);
    assert.equal(Number(row.requestedBy), operator);
    assert.equal((await call('POST', '/api/vendors/withdraw', ownerToken(v), { amount: 5 })).status, 200);
  });

  test('only the owner can grant request_payouts; a staff manager cannot (not even to themselves)', async () => {
    const v = await mkVendor('grant');
    const manager = await mkStaff(v, { manage_staff: true, manage_orders: true, request_payouts: false });
    const mTok = staffToken(manager, v);
    const create = await call('POST', '/api/vendors/staff', mTok, {
      name: 'New Clerk', email: `pol-new-${TS}@test.local`, password: 'Str0ngPassw0rd!', permissions: { request_payouts: true },
    });
    assert.equal(create.status, 403, JSON.stringify(create.json));
    const self = await call('PUT', `/api/vendors/staff/${manager}`, mTok, { permissions: { manage_staff: true, manage_orders: true, request_payouts: true } });
    assert.equal(self.status, 403, JSON.stringify(self.json));
    const [[after]] = await pool.execute(`SELECT permissions FROM vendor_staff WHERE id = ?`, [manager]);
    const perms = typeof after.permissions === 'string' ? JSON.parse(after.permissions) : after.permissions;
    assert.ok(!perms.request_payouts, 'manager did not gain request_payouts');
    const byOwner = await call('PUT', `/api/vendors/staff/${manager}`, ownerToken(v), { permissions: { manage_staff: true, request_payouts: true } });
    assert.equal(byOwner.status, 200, JSON.stringify(byOwner.json));
  });

  test('a manager who HOLDS request_payouts still cannot hand it to anyone else (owner-only to add)', async () => {
    const v = await mkVendor('grant2');
    const manager = await mkStaff(v, { manage_staff: true, manage_orders: true, request_payouts: true });
    const clerk = await mkStaff(v, { manage_orders: true });
    const mTok = staffToken(manager, v);
    const create = await call('POST', '/api/vendors/staff', mTok, {
      name: 'Payout Clerk', email: `pol-new2-${TS}@test.local`, password: 'Str0ngPassw0rd!',
      permissions: { manage_orders: true, request_payouts: true },
    });
    assert.equal(create.status, 403, JSON.stringify(create.json));
    assert.match(create.json.message, /request_payouts can only be granted by the store owner/);
    const edit = await call('PUT', `/api/vendors/staff/${clerk}`, mTok, { permissions: { manage_orders: true, request_payouts: true } });
    assert.equal(edit.status, 403, JSON.stringify(edit.json));
    // Keeping it on their own row (an ordinary edit) is not a demotion.
    const keep = await call('PUT', `/api/vendors/staff/${manager}`, mTok, { permissions: { manage_staff: true, manage_orders: true, request_payouts: true } });
    assert.equal(keep.status, 200, JSON.stringify(keep.json));
  });
});

describe('reconciliation_required resolution policy', { skip: !dbAvailable }, () => {
  /** Park an attempt through the real settlement path with the given evidence. */
  const parkedAttempt = async (name, evidenceTweak) => {
    const v = await mkVendor(name);
    await mkCreditedAlloc(v, 30);
    await call('POST', '/api/vendors/withdraw', ownerToken(v), { amount: 30 });
    const [a] = await attemptsOf(v);
    assert.equal(await settleTransferSuccess(a.reference, { amountMinor: 3000, currency: 'GHS', ...evidenceTweak }), 'review');
    return { v, a: await reload(a.id) };
  };

  test('re-verify of a parked payout needs admin + acknowledge + justification; nothing happens otherwise', async () => {
    const admin = await mkUser('admin', 'polAdmin');
    const { v, a } = await parkedAttempt('needack', { currency: 'NGN' });
    const before = provider.verifyCalls;
    assert.equal((await call('POST', `/api/admin/payouts/${a.id}/reconcile`, ownerToken(v), { acknowledge: true, note: 'vendor tries it' })).status, 403, 'authenticated non-admin');
    assert.equal((await call('POST', `/api/admin/payouts/${a.id}/reconcile`, null, { acknowledge: true, note: 'anonymous tries it' })).status, 401);
    for (const body of [{}, { acknowledge: true }, { note: 'long enough note here' }, { acknowledge: 'true', note: 'long enough note here' }, { acknowledge: true, note: 'short' }, { acknowledge: true, note: 'bad\u0007control chars here' }]) {
      const r = await call('POST', `/api/admin/payouts/${a.id}/reconcile`, ownerToken(admin), body);
      assert.equal(r.status, 400, `${JSON.stringify(body)} → ${r.status}`);
    }
    assert.equal(provider.verifyCalls, before, 'no provider call on a refused request');
    assert.equal((await reload(a.id)).status, 'reconciliation_required');
  });

  test('contradictory evidence stays parked even after an acknowledged re-verify', async () => {
    const admin = await mkUser('admin', 'polAdmin2');
    const { v, a } = await parkedAttempt('mismatch', { amountMinor: 2990 });
    // Paystack still reports a different amount than we reserved.
    provider.transfers.get(a.reference).status = 'success';
    provider.transfers.get(a.reference).amount = 2990;
    const r = await call('POST', `/api/admin/payouts/${a.id}/reconcile`, ownerToken(admin),
      { acknowledge: true, note: 'Dashboard shows 29.90 sent, escalating' });
    assert.equal(r.status, 200);
    assert.equal(r.json.outcome, 'review');
    assert.equal(r.json.severity, 'warning');
    const row = await reload(a.id);
    assert.equal(row.status, 'reconciliation_required');
    assert.match(row.reviewReason, /amount_mismatch/);
    assert.equal(await walletOf(v), 30, 'nothing booked');
    const detail = await call('GET', `/api/admin/payouts/${a.id}`, ownerToken(admin));
    assert.ok(detail.json.history.some((h) => h.action === 'payout.review.reverify'), 'audited');
    assert.equal(detail.json.reverifyNeedsJustification, true);
  });

  test('a transient cause (ledger shortfall fixed) settles through the normal checks after re-verify', async () => {
    const admin = await mkUser('admin', 'polAdmin3');
    const v = await mkVendor('unbook');
    await mkCreditedAlloc(v, 30);
    await call('POST', '/api/vendors/withdraw', ownerToken(v), { amount: 30 });
    const [a] = await attemptsOf(v);
    await pool.execute(`UPDATE vendor_wallets SET available_balance = 10 WHERE vendorId = ?`, [v]);
    assert.equal(await settleTransferSuccess(a.reference, { amountMinor: 3000, currency: 'GHS' }), 'review');
    // An operator corrects the wallet (documented correction), then re-verifies.
    await pool.execute(`UPDATE vendor_wallets SET available_balance = 30 WHERE vendorId = ?`, [v]);
    provider.transfers.get(a.reference).status = 'success';
    const r = await call('POST', `/api/admin/payouts/${a.id}/reconcile`, ownerToken(admin),
      { acknowledge: true, note: 'Wallet shortfall traced to ticket 88 and corrected' });
    assert.equal(r.json.outcome, 'succeeded', JSON.stringify(r.json));
    assert.equal((await reload(a.id)).status, 'succeeded');
    assert.equal(await walletOf(v), 0);
    const [[n]] = await pool.execute(`SELECT resolutionNote FROM payout_attempts WHERE id = ?`, [a.id]);
    assert.match(n.resolutionNote, /ticket 88/);
    // Settled → no further action possible.
    assert.equal((await call('POST', `/api/admin/payouts/${a.id}/reconcile`, ownerToken(admin), {})).status, 409);
  });

  test('for a parked payout, a provider "not found" never releases the funds', async () => {
    const admin = await mkUser('admin', 'polAdmin4');
    const { v, a } = await parkedAttempt('nf', { currency: 'USD' });
    provider.transfers.delete(a.reference);
    const r = await call('POST', `/api/admin/payouts/${a.id}/reconcile`, ownerToken(admin),
      { acknowledge: true, note: 'Paystack support asked, awaiting reply' });
    assert.equal(r.json.outcome, 'review');
    assert.equal((await reload(a.id)).status, 'reconciliation_required');
    const [[al]] = await pool.execute(`SELECT payoutAmount FROM escrow_allocations WHERE id = ?`, [a.allocationId]);
    assert.equal(Number(al.payoutAmount), 0, 'reservation kept');
    assert.equal(await walletOf(v), 30);
  });

  test('list filter and note validation', async () => {
    const admin = await mkUser('admin', 'polAdmin5');
    const tok = ownerToken(admin);
    assert.equal((await call('GET', '/api/admin/payouts/unresolved?status=succeeded', tok)).status, 400);
    const parkedList = await call('GET', '/api/admin/payouts/unresolved?status=reconciliation_required', tok);
    assert.equal(parkedList.status, 200);
    assert.ok(parkedList.json.payouts.every((p) => p.status === 'reconciliation_required'));
    const { a } = await parkedAttempt('notes', { currency: 'EUR' });
    assert.equal((await call('POST', `/api/admin/payouts/${a.id}/note`, tok, { note: 'too short' })).status, 400);
    assert.equal((await call('POST', `/api/admin/payouts/${a.id}/note`, tok, { note: 42 })).status, 400);
    assert.equal((await call('POST', `/api/admin/payouts/${a.id}/note`, tok, { note: 'first finding recorded' })).status, 200);
    assert.equal((await call('POST', `/api/admin/payouts/${a.id}/note`, tok, { note: 'second finding recorded' })).status, 200);
    const detail = await call('GET', `/api/admin/payouts/${a.id}`, tok);
    const notes = detail.json.history.filter((h) => h.action === 'payout.note').map((h) => h.afterVal.resolutionNote);
    assert.deepEqual(notes, ['second finding recorded', 'first finding recorded'], 'history keeps every note');
  });
});
