// @ts-check
// Purpose-bound tokens share JWT_SECRET with session tokens. The OAuth
// exchange token carries { id, tv, purpose: 'oauth_exchange', jti }, so
// `protect`, `optionalAuth` and `vendorOrStaff` (which only checked id + tv)
// accepted it as a session cookie: a leaked exchange token became a
// 10-minute session and skipped the single-use jti consumption in
// POST /api/auth/oauth/exchange. Each control below proves the same user and
// tokenVersion DO authenticate with a real session token, so the rejection is
// caused by the purpose claim alone.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
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

process.env.JWT_SECRET = process.env.JWT_SECRET || `purpose-${Date.now()}`;
const SECRET = String(process.env.JWT_SECRET);

const { protect, optionalAuth, vendorOrStaff } = await import('../middleware/authMiddleware.js');

after(async () => {
  const db = (await import('../config/db.js')).default;
  await db.end().catch(() => {});
});

const RUN_ID = `purpose-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
/** @type {{ userId: number, vendorId: number }} */
const state = { userId: 0, vendorId: 0 };

const makeRes = () => ({
  statusCode: 200,
  /** @param {number} code */
  status(code) { this.statusCode = code; return this; },
  json() { return this; },
});

/**
 * @param {Function} mw
 * @param {string} token
 * @returns {Promise<{ status: number, authed: boolean, error: string | null }>}
 */
const run = async (mw, token) => {
  const req = /** @type {any} */ ({ cookies: { jwt: token }, headers: {}, body: {}, query: {} });
  const res = makeRes();
  /** @type {string | null} */
  let error = null;
  // asyncHandler-wrapped middlewares do not return their promise; all three
  // always end in next() (with or without an error), so wait for that.
  await new Promise((resolve) => {
    mw(req, res, (/** @type {any} */ err) => { if (err) error = err.message; resolve(undefined); });
  });
  return { status: res.statusCode, authed: Boolean(req.user) && !error, error };
};

/** @param {number} id @param {number} tv @param {string} [role] */
const sessionToken = (id, tv, role) => jwt.sign({ id, role, tv }, SECRET, { expiresIn: '5m' });
/** @param {number} id @param {number} tv @param {string} purpose */
const purposeToken = (id, tv, purpose) =>
  jwt.sign({ id, tv, purpose, jti: crypto.randomUUID() }, SECRET, { expiresIn: '5m' });

describe('purpose-bound tokens are not sessions', { skip: !dbAvailable && 'no database' }, () => {
  before(async () => {
    const [u] = await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified, tokenVersion)
       VALUES ('Purpose', 'Test', ?, 'x', 'customer', 1, 1, 0)`,
      [`${RUN_ID}-c@example.test`]
    );
    state.userId = u.insertId;
    const [v] = await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified, tokenVersion)
       VALUES ('Purpose', 'Vendor', ?, 'x', 'vendor', 1, 1, 0)`,
      [`${RUN_ID}-v@example.test`]
    );
    state.vendorId = v.insertId;
    await pool.execute(
      `INSERT INTO vendors (userId, businessName, status) VALUES (?, ?, 'approved')`,
      [state.vendorId, `${RUN_ID} store`]
    );
  });

  after(async () => {
    if (!pool) return;
    await pool.execute(`DELETE FROM vendors WHERE userId = ?`, [state.vendorId]).catch(() => {});
    await pool.execute(`DELETE FROM users WHERE id IN (?, ?)`, [state.userId, state.vendorId]).catch(() => {});
  });

  test('protect: session token authenticates, oauth_exchange token for the same user does not', async () => {
    const ok = await run(protect, sessionToken(state.userId, 0, 'customer'));
    assert.equal(ok.authed, true, `control failed: ${ok.error}`);
    for (const purpose of ['oauth_exchange', 'oauth_state', 'register_pending', 'legal_consent', 'referral_visit']) {
      const r = await run(protect, purposeToken(state.userId, 0, purpose));
      assert.equal(r.authed, false, `${purpose} token was accepted as a session`);
      assert.equal(r.status, 401);
    }
  });

  test('optionalAuth: oauth_exchange token leaves the request anonymous', async () => {
    const ok = await run(optionalAuth, sessionToken(state.userId, 0, 'customer'));
    assert.equal(ok.authed, true, `control failed: ${ok.error}`);
    const r = await run(optionalAuth, purposeToken(state.userId, 0, 'oauth_exchange'));
    assert.equal(r.authed, false);
    assert.equal(r.error, null, 'optionalAuth must never block');
  });

  test('vendorOrStaff: oauth_exchange token for a vendor is refused', async () => {
    const ok = await run(vendorOrStaff, sessionToken(state.vendorId, 0, 'vendor'));
    assert.equal(ok.authed, true, `control failed: ${ok.error}`);
    const r = await run(vendorOrStaff, purposeToken(state.vendorId, 0, 'oauth_exchange'));
    assert.equal(r.authed, false);
    assert.equal(r.status, 401);
  });
});
