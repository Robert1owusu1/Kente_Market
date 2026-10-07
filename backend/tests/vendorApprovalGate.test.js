// FILE LOCATION: backend/tests/vendorApprovalGate.test.js
// DESCRIPTION: C5 — an unapproved vendor store could act as a vendor.
//
// `vendor` and `vendorOrStaff` checked only `users.role`, and `applyVendor`
// writes role='vendor' in the SAME request that creates the store with
// status='pending'. So one second after submitting an application — before any
// administrator has seen it — the applicant already held every vendor
// capability: publish products, POST /api/vendors/staff to mint staff accounts,
// create coupons, advance order fulfilment, POST /api/vendors/withdraw.
//
// The staff branch of `vendorOrStaff` had the check all along
// (`staff.vendorStatus !== 'approved'` -> 403). The owner branch did not: the
// middleware enforced the invariant for the employee and not for their
// employer.
//
// The one exemption is deliberate and tested from both sides —
// `GET /api/vendors/me` is the vendor dashboard's entry point (VendorDashboard
// renders off it) and it is how a pending applicant reads their own state. Its
// method and path are asserted exactly, because a wider exemption (any /me
// route, or the path without the method) would reopen the hole.
//
// Also covers the second half of the finding: `applyVendor` used to write
// status='pending' on EVERY application, including a re-application from an
// already-approved store. Once approval is enforced, that one line would have
// taken a live store offline (N-6 hides everything not 'approved') and locked
// its owner out of the dashboard — and for a suspended store it silently erased
// the sanction, letting the vendor lift their own suspension by filing a form.
//
// NOTE: DB-backed; inserts then cleans up. Skips without MySQL.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

// The middleware reads process.env.JWT_SECRET at call time. Keep a real one if
// the environment already has it (CI/dev), otherwise sign against a throwaway
// so the suite still runs in a DB-only container with no .env.
process.env.JWT_SECRET = process.env.JWT_SECRET || `c5-gate-${Date.now()}`;

const authMiddleware = await import('../middleware/authMiddleware.js');
const { vendor, vendorOrStaff } = authMiddleware;

const RUN_ID = `c5-${Date.now()}`;
const state = { userIds: [], vendorUserIds: [] };

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const makeUser = async (role) => {
  const [res] = await pool.execute(
    `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified, tokenVersion)
     VALUES ('C5', 'Gate', ?, 'not-a-real-password', ?, 1, 1, 0)`,
    [`${RUN_ID}-${state.userIds.length}@test.local`, role],
  );
  state.userIds.push(res.insertId);
  return res.insertId;
};

const makeStore = async (userId, status) => {
  await pool.execute(
    `INSERT INTO vendors (userId, businessName, status, recipientCode)
     VALUES (?, ?, ?, 'RCP_c5')`,
    [userId, `C5 Store ${userId}`, status],
  );
  state.vendorUserIds.push(userId);
};

const token = (userId) =>
  jwt.sign({ id: userId, tv: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });

/**
 * Run a middleware to completion, resolving on whichever happens first:
 * `next()`, an error passed to `next(err)`, a rejection, or a timeout.
 *
 * `vendorOrStaff` is a plain async function while `vendor` is wrapped by
 * asyncHandler (which does NOT return the inner promise), so both shapes have
 * to be tolerated — otherwise a rejected run hangs for 10s and then reports a
 * timeout instead of the assertion that actually failed.
 */
const runMiddleware = (mw, req) =>
  new Promise((resolve) => {
    let settled = false;
    let chosenStatus = 200;
    const res = {
      status(code) { chosenStatus = code; return this; },
      json() { return this; },
      cookie() { return this; },
      clearCookie() { return this; },
    };
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status: chosenStatus, ...outcome });
    };
    const timer = setTimeout(
      () => finish({ passed: false, error: 'TIMEOUT: neither next() nor next(err) ran' }),
      10000,
    );
    // `next(err)` and `next()` both come through this one callback, so they
    // have to be told apart: a middleware that REJECTS the request still calls
    // next — just with an error — and counting that as "reached the handler"
    // would make every gate test pass while proving nothing.
    const returned = mw(req, res, (err) =>
      finish({ passed: !err, error: err ? err.message : null }),
    );
    if (returned && typeof returned.catch === 'function') {
      returned.catch((err) =>
        finish({ passed: false, error: err.message, rejected: true }),
      );
    }
  });

const vendorReq = (userId, { path = '/api/vendors/inventory', method = 'GET' } = {}) => ({
  cookies: { jwt: token(userId) },
  method,
  originalUrl: path,
});

describe('C5: the store, not the token, decides', { skip: !dbAvailable }, () => {
  const ids = {};

  before(async () => {
    ids.pending = await makeUser('vendor');
    ids.approved = await makeUser('vendor');
    ids.suspended = await makeUser('vendor');
    ids.ghost = await makeUser('vendor'); // role='vendor', no vendors row
    ids.admin = await makeUser('admin');
    ids.customer = await makeUser('customer');
    await makeStore(ids.pending, 'pending');
    await makeStore(ids.approved, 'approved');
    await makeStore(ids.suspended, 'suspended');
  });

  after(async () => {
    if (!dbAvailable || !pool) return;
    try {
      if (state.vendorUserIds.length) {
        await pool.execute(
          `DELETE FROM vendors WHERE userId IN (${state.vendorUserIds.map(() => '?').join(',')})`,
          state.vendorUserIds,
        );
      }
      if (state.userIds.length) {
        await pool.execute(
          `DELETE FROM users WHERE id IN (${state.userIds.map(() => '?').join(',')})`,
          state.userIds,
        );
      }
    } finally {
      await pool.end();
    }
  });

  // -------------------------------------------------------------------------
  // vendorOrStaff — the self-contained vendor-panel guard
  // -------------------------------------------------------------------------

  test('an approved store passes', async () => {
    const r = await runMiddleware(vendorOrStaff, vendorReq(ids.approved));
    assert.equal(r.error, null, `approved vendor rejected: ${r.error}`);
    assert.equal(r.passed, true);
  });

  test('a PENDING store is refused before it can call anything', async () => {
    const r = await runMiddleware(vendorOrStaff, vendorReq(ids.pending));
    assert.equal(r.passed, false, 'pending vendor reached the handler');
    assert.equal(r.status, 403, `expected 403, got ${r.status}`);
    assert.match(r.error, /pending/, `message must name the state: ${r.error}`);
  });

  test('a SUSPENDED store is refused', async () => {
    const r = await runMiddleware(vendorOrStaff, vendorReq(ids.suspended));
    assert.equal(r.passed, false, 'suspended vendor reached the handler');
    assert.equal(r.status, 403);
    assert.match(r.error, /suspended/);
  });

  test('role=vendor with no store row fails closed', async () => {
    const r = await runMiddleware(vendorOrStaff, vendorReq(ids.ghost));
    assert.equal(r.passed, false, 'a store-less vendor reached the handler');
    assert.equal(r.status, 403);
    assert.match(r.error, /No vendor store/);
  });

  test('an admin reaches the handler with no store of their own', async () => {
    const r = await runMiddleware(vendorOrStaff, vendorReq(ids.admin));
    assert.equal(r.error, null, `admin rejected: ${r.error}`);
    assert.equal(r.passed, true);
  });

  test('a customer is refused as before', async () => {
    const r = await runMiddleware(vendorOrStaff, vendorReq(ids.customer));
    assert.equal(r.passed, false);
    assert.equal(r.status, 403);
  });

  // -------------------------------------------------------------------------
  // The single exemption
  // -------------------------------------------------------------------------

  test('GET /api/vendors/me stays open to a pending applicant', async () => {
    const r = await runMiddleware(
      vendorOrStaff,
      vendorReq(ids.pending, { path: '/api/vendors/me' }),
    );
    assert.equal(r.error, null, `the application-status endpoint closed: ${r.error}`);
    assert.equal(r.passed, true);
  });

  test('the exemption survives a query string', async () => {
    const r = await runMiddleware(
      vendorOrStaff,
      vendorReq(ids.pending, { path: '/api/vendors/me?include=payouts' }),
    );
    assert.equal(r.passed, true, 'the status read broke on a query string');
  });

  test('the exemption is exact: a sibling path is still refused', async () => {
    const r = await runMiddleware(
      vendorOrStaff,
      vendorReq(ids.pending, { path: '/api/vendors/me/../../inventory' }),
    );
    assert.equal(r.passed, false, `${r.status} — a crafted path escaped the gate`);
    assert.equal(r.status, 403);
  });

  test('the exemption is method-scoped, not path-only', async () => {
    // No such route exists, but the guard must not be `originalUrl === '/me'`
    // alone — otherwise a future write route under /me would inherit it.
    const r = await runMiddleware(
      vendorOrStaff,
      vendorReq(ids.pending, { path: '/api/vendors/me', method: 'POST' }),
    );
    assert.equal(r.passed, false, 'the exemption ignored the HTTP method');
    assert.equal(r.status, 403);
  });

  // -------------------------------------------------------------------------
  // vendor — the plain middleware guarding staff management and messaging
  // -------------------------------------------------------------------------

  test('vendor refuses a pending store', async () => {
    const r = await runMiddleware(vendor, { user: { id: ids.pending, role: 'vendor' } });
    assert.equal(r.passed, false, 'pending vendor reached POST /api/vendors/staff');
    assert.equal(r.status, 403);
  });

  test('vendor refuses a suspended store', async () => {
    const r = await runMiddleware(vendor, { user: { id: ids.suspended, role: 'vendor' } });
    assert.equal(r.passed, false);
    assert.equal(r.status, 403);
  });

  test('vendor admits an approved store and an admin', async () => {
    const okVendor = await runMiddleware(vendor, { user: { id: ids.approved, role: 'vendor' } });
    assert.equal(okVendor.error, null, `approved vendor rejected by vendor: ${okVendor.error}`);
    const okAdmin = await runMiddleware(vendor, { user: { id: ids.admin, role: 'admin' } });
    assert.equal(okAdmin.error, null, `admin rejected by vendor: ${okAdmin.error}`);
  });

  test('vendor still refuses a non-vendor outright', async () => {
    const r = await runMiddleware(vendor, { user: { id: ids.customer, role: 'customer' } });
    assert.equal(r.passed, false);
    assert.equal(r.status, 403);
    assert.match(r.error, /Not authorized as a vendor/);
  });

  // -------------------------------------------------------------------------
  // Status is authoritative independently of the role column
  // -------------------------------------------------------------------------

  test('status, not role, is what is checked', async () => {
    // `updateVendorStatus` normally syncs role='customer' when it suspends, so
    // the role check alone looks sufficient — until the two columns drift (a
    // direct UPDATE, a partial failure between the two writes, or any future
    // path that forgets to sync). The gate must hold on its own.
    const drift = await makeUser('vendor');
    await makeStore(drift, 'suspended');
    const r = await runMiddleware(vendorOrStaff, vendorReq(drift));
    assert.equal(r.passed, false, 'a suspended store passed on the strength of role alone');
    assert.equal(r.status, 403);
  });
});

// ---------------------------------------------------------------------------
// Source guards — the half that cannot be reached without a Paystack round trip
// ---------------------------------------------------------------------------
describe('C5: applyVendor no longer resets a live store to pending', () => {
  const vendorControllerSrc = read('../controllers/vendorController.js');
  const authSrc = read('../middleware/authMiddleware.js');

  const applyVendorSrc = vendorControllerSrc.slice(
    vendorControllerSrc.indexOf('export const applyVendor'),
    vendorControllerSrc.indexOf('export const', vendorControllerSrc.indexOf('export const applyVendor') + 10),
  );

  // Split applyVendor at its own `if (existing) { ... } else { ... }` so both
  // halves can be asserted. The search for `} else {` has to start AT
  // `if (existing) {`: applyVendor contains an earlier one (the bank/momo
  // branch), and `slice(start, end)` with end < start yields '' silently
  // rather than throwing — which is how this assertion first failed.
  const updateFrom = applyVendorSrc.indexOf('if (existing) {');
  const updateTo = applyVendorSrc.indexOf('} else {', updateFrom);
  assert.ok(updateFrom > -1 && updateTo > updateFrom, 'could not split applyVendor');
  const updateBranch = applyVendorSrc.slice(updateFrom, updateTo);
  const createBranch = applyVendorSrc.slice(updateTo);

  test('the update branch carries no status field', () => {
    assert.ok(updateBranch.length > 0, 'could not locate the existing-store branch');
    assert.ok(
      !/status\s*:/.test(updateBranch),
      'a re-application still writes status — an approved store would go dark and a suspended one would be pardoned',
    );
  });

  test('a FIRST application still lands in pending', () => {
    assert.match(createBranch, /status: 'pending'/, 'new stores must not be born approved');
  });

  test('vendorOrStaff and vendor both go through the same gate', () => {
    const gateCalls = (authSrc.match(/await requireApprovedStore\(req\)/g) || []).length;
    assert.equal(gateCalls, 2, `expected the gate in both middlewares, found ${gateCalls}`);
    assert.match(authSrc, /const vendorOrStaff = async/, 'vendorOrStaff is no longer async');
    assert.match(authSrc, /const vendor = asyncHandler\(/, 'vendor is no longer async');
  });

  test('the exemption is one method + one exact path', () => {
    assert.match(authSrc, /APPLICATION_STATUS_PATH = '\/api\/vendors\/me'/);
    assert.match(authSrc, /req\.method === 'GET' && req\.originalUrl\.split\('\?'\)\[0\]/);
  });

  test('the gate reads vendors.status, not the product approval column', () => {
    // `approvalStatus` is the PRODUCT moderation column; reading it here would
    // be the same misreading that shipped the sibling productModel finding.
    const gateBody = authSrc.slice(
      authSrc.indexOf('const requireApprovedStore'),
      authSrc.indexOf('const vendor = asyncHandler'),
    );
    assert.match(gateBody, /SELECT status FROM vendors WHERE userId = \?/);
    assert.ok(!/approvalStatus/.test(gateBody), 'the gate queries the product column');
    assert.match(gateBody, /status !== 'approved'/);
  });
});
