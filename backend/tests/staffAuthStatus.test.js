// @ts-check
// SEC-4: the staff branch of `vendorOrStaff` used to rewrite EVERY failure —
// a deactivated staff member, a store that is no longer approved — into
// 401 'Not authorized, staff token failed'. The SPA treats 401 as session
// expiry (apiSlice -> handleUnauthorized), so a deactivated staff member was
// silently logged out and told their token failed instead of being told why.
// The owner branch already kept its decided status; the staff branch now does
// the same, and only an undecided failure (driver error) becomes a generic 401.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

/** @type {any} */
let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

process.env.JWT_SECRET = process.env.JWT_SECRET || `sec4-${Date.now()}`;

const { vendorOrStaff } = await import('../middleware/authMiddleware.js');

after(async () => {
  // The middleware's own pool (config/db.js) stays open otherwise and the
  // runner never exits.
  const db = (await import('../config/db.js')).default;
  await db.end().catch(() => {});
});

const RUN_ID = `sec4-${Date.now()}`;
/** @type {{ userIds: number[] }} */
const state = { userIds: [] };

/**
 * Express-shaped response: `statusCode` starts at 200 like the real one,
 * because the middleware decides "was a status chosen?" from it.
 */
const makeRes = () => ({
  statusCode: 200,
  /** @param {number} code */
  status(code) { this.statusCode = code; return this; },
  json() { return this; },
});

/**
 * @param {any} req
 * @returns {Promise<{ status: number, error: string | null, nextCalls: number, req: any }>}
 */
const run = async (req) => {
  const res = makeRes();
  let nextCalls = 0;
  /** @type {string | null} */
  let error = null;
  await vendorOrStaff(req, /** @type {any} */ (res), /** @param {any} [err] */ (err) => {
    nextCalls += 1;
    if (err) error = err.message;
  });
  return { status: res.statusCode, error, nextCalls, req };
};

/** @param {{ id: number, vendorId: number, tv?: number }} p */
const staffReq = ({ id, vendorId, tv = 0 }) => ({
  cookies: {
    jwt: jwt.sign({ id, vendorId, role: 'vendor_staff', tv }, /** @type {string} */ (process.env.JWT_SECRET), { expiresIn: '1h' }),
  },
  method: 'GET',
  originalUrl: '/api/vendors/inventory',
});

describe('SEC-4: staff auth keeps the status it decided', { skip: !dbAvailable }, () => {
  /** @type {Record<string, number>} */
  const ids = {};

  /** @param {string} storeStatus */
  const makeVendor = async (storeStatus) => {
    const [u] = await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified, tokenVersion)
       VALUES ('Sec4', 'Vendor', ?, 'not-a-real-password', 'vendor', 1, 1, 0)`,
      [`${RUN_ID}-${state.userIds.length}@test.local`],
    );
    state.userIds.push(u.insertId);
    await pool.execute(
      `INSERT INTO vendors (userId, businessName, status, recipientCode) VALUES (?, ?, ?, 'RCP_sec4')`,
      [u.insertId, `Sec4 Store ${u.insertId}`, storeStatus],
    );
    return u.insertId;
  };

  let staffSeq = 0;
  /** @param {number} vendorId @param {string} status */
  const makeStaff = async (vendorId, status) => {
    staffSeq += 1;
    const [s] = await pool.execute(
      `INSERT INTO vendor_staff (vendorId, name, email, password, permissions, status, tokenVersion)
       VALUES (?, 'Sec4 Staff', ?, 'not-a-real-password', '{"orders":true}', ?, 0)`,
      [vendorId, `${RUN_ID}-staff-${staffSeq}@test.local`, status],
    );
    return s.insertId;
  };

  before(async () => {
    ids.approvedVendor = await makeVendor('approved');
    ids.suspendedVendor = await makeVendor('suspended');
    ids.activeStaff = await makeStaff(ids.approvedVendor, 'active');
    ids.inactiveStaff = await makeStaff(ids.approvedVendor, 'inactive');
    ids.orphanedStaff = await makeStaff(ids.suspendedVendor, 'active');
  });

  after(async () => {
    if (!pool) return;
    for (const userId of state.userIds) {
      await pool.execute('DELETE FROM vendor_staff WHERE vendorId = ?', [userId]);
      await pool.execute('DELETE FROM vendors WHERE userId = ?', [userId]);
      await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
    }
    state.userIds = [];
  });

  test('an active staff member of an approved store passes, once', async () => {
    const r = await run(staffReq({ id: ids.activeStaff, vendorId: ids.approvedVendor }));
    assert.equal(r.error, null);
    assert.equal(r.nextCalls, 1);
    assert.equal(r.req.user.id, ids.approvedVendor);
    assert.equal(r.req.staff.id, ids.activeStaff);
  });

  test('a deactivated staff member gets 403 and the real reason, not a fake session expiry', async () => {
    const r = await run(staffReq({ id: ids.inactiveStaff, vendorId: ids.approvedVendor }));
    assert.equal(r.status, 403);
    assert.equal(r.error, 'Staff account is deactivated');
    assert.equal(r.nextCalls, 1);
  });

  test('staff of a store that is no longer approved gets 403', async () => {
    const r = await run(staffReq({ id: ids.orphanedStaff, vendorId: ids.suspendedVendor }));
    assert.equal(r.status, 403);
    assert.equal(r.error, 'This vendor store is not active');
  });

  test('an unknown staff id is still 401', async () => {
    const r = await run(staffReq({ id: 2_000_000_000, vendorId: ids.approvedVendor }));
    assert.equal(r.status, 401);
    assert.equal(r.error, 'Staff account not found');
  });

  test('a revoked staff token (tokenVersion bumped) is still 401', async () => {
    const r = await run(staffReq({ id: ids.activeStaff, vendorId: ids.approvedVendor, tv: 7 }));
    assert.equal(r.status, 401);
    assert.equal(r.error, 'Session expired, please log in again');
  });

  test('a staff id presented under another vendor is refused (401, not found)', async () => {
    const r = await run(staffReq({ id: ids.activeStaff, vendorId: ids.suspendedVendor }));
    assert.equal(r.status, 401);
    assert.notEqual(r.error, null);
  });
});

describe('SEC-4: undecided failures stay generic', () => {
  test('a driver error becomes 401 without leaking its text', async (t) => {
    const db = (await import('../config/db.js')).default;
    t.mock.method(db, 'execute', async () => {
      throw new Error('ER_ACCESS_DENIED secret-host-detail');
    });
    t.mock.method(console, 'error', () => {});
    const r = await run(staffReq({ id: 1, vendorId: 1 }));
    assert.equal(r.status, 401);
    assert.equal(r.error, 'Not authorized, staff token failed');
    assert.equal(r.nextCalls, 1);
  });

  test('a downstream throw from next() is not caught and re-reported by the middleware', async (t) => {
    const db = (await import('../config/db.js')).default;
    t.mock.method(db, 'execute', async () => [[{
      id: 9, name: 'S', email: 's@test.local', permissions: '{}', status: 'active', tokenVersion: 0,
      vendorUserId: 9, vendorStatus: 'approved',
    }]]);
    const res = makeRes();
    let calls = 0;
    await assert.rejects(
      vendorOrStaff(staffReq({ id: 9, vendorId: 9 }), /** @type {any} */ (res), () => {
        calls += 1;
        throw new Error('handler blew up');
      }),
      /handler blew up/,
    );
    assert.equal(calls, 1, 'next() was invoked twice');
    assert.equal(res.statusCode, 200, 'a handler error was rewritten to an auth failure');
  });
});
