// FILE LOCATION: backend/tests/authSessionRevocation.test.js
// DESCRIPTION: Integration tests for Phase 6 session revocation. Every JWT now
//              embeds the tokenVersion in force at issue time; changing the
//              password (resetPassword) or email (User.update) bumps
//              users.tokenVersion, so previously issued tokens are rejected by
//              the protect / optionalAuth middleware.
// NOTE: Uses the real (dev) database; inserts then cleans up after itself.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import User from '../models/usersModel.js';
import { protect, optionalAuth } from '../middleware/authMiddleware.js';

const RUN_ID = `revok-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds = [];

// DB gate: self-skip when no database is reachable (see promotions.test.js).
let dbAvailable = true;
try {
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

const makeUser = async () => {
  const email = `${RUN_ID}-${createdUserIds.length}@test.local`;
  const [res] = await pool.execute(
    `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
     VALUES ('RevokeTest', 'User', ?, ?, 'customer', 1, 1)`,
    [email, 'not-a-real-password']
  );
  createdUserIds.push(res.insertId);
  return res.insertId;
};

const signCookieToken = (userId, tv) =>
  jwt.sign({ id: userId, tv }, process.env.JWT_SECRET, { expiresIn: '1h' });

const buildReq = (token) => ({ cookies: { jwt: token } });

// Run a middleware and resolve when `next()` is actually invoked.
// asyncHandler does NOT return the inner promise (it fires fn(req,res,next).catch(next)
// and returns undefined), so awaiting the middleware does not wait for `next()`;
// we resolve only when next is called, with a 10s failsafe.
const runMiddleware = (mw, req) =>
  new Promise((resolve) => {
    let chosenStatus = 200;
    const res = {
      status(code) { chosenStatus = code; return this; },
      json() { return this; },
      cookie() { return this; },
    };
    const finish = (err) => (err ? resolve({ status: chosenStatus, error: err.message }) : resolve({ status: chosenStatus, error: null }));
    const timeout = setTimeout(() => finish(new Error('next() never called (timeout)')), 10000);
    mw(req, res, (err) => {
      clearTimeout(timeout);
      finish(err || null);
    });
  });

describe('Session revocation via users.tokenVersion', { skip: !dbAvailable }, () => {
  after(async () => {
    if (!dbAvailable) {
      await pool.end();
      return;
    }
    for (const uid of createdUserIds) {
      await pool.execute(`DELETE FROM users WHERE id = ?`, [uid]);
    }
    createdUserIds.length = 0;
    await pool.end();
  });

  test('a token issued at the current tokenVersion is accepted by protect', async () => {
    const userId = await makeUser();
    await pool.execute(`UPDATE users SET tokenVersion = 0 WHERE id = ?`, [userId]);
    const token = signCookieToken(userId, 0);

    const { status, error } = await runMiddleware(protect, buildReq(token));
    assert.equal(status, 200, `protect should pass: ${error}`);
    assert.equal(error, null);
  });

  test('after resetPassword the old token is rejected and a new-version token is accepted', async () => {
    const userId = await makeUser();
    await pool.execute(`UPDATE users SET tokenVersion = 0 WHERE id = ?`, [userId]);
    await User.resetPassword(userId, 'brand-new-pass-123');

    const { status } = await runMiddleware(protect, buildReq(signCookieToken(userId, 0)));
    assert.equal(status, 401, 'stale-version token must be rejected');

    const currentTv = await User.getTokenVersion(userId);
    const { status: okStatus, error } = await runMiddleware(protect, buildReq(signCookieToken(userId, currentTv)));
    assert.equal(okStatus, 200, `fresh-version token should pass: ${error}`);
  });

  test('changing the email bumps the version and revokes the old session', async () => {
    const userId = await makeUser();
    await pool.execute(`UPDATE users SET tokenVersion = 0 WHERE id = ?`, [userId]);
    const token = signCookieToken(userId, 0);
    const { status: before } = await runMiddleware(protect, buildReq(token));
    assert.equal(before, 200);

    await User.update(userId, { email: `${RUN_ID}-bump@test.local` });

    const { status: after } = await runMiddleware(protect, buildReq(token));
    assert.equal(after, 401);
  });

  test('optionalAuth treats a revoked token as anonymous instead of blocking', async () => {
    const userId = await makeUser();
    await pool.execute(`UPDATE users SET tokenVersion = 0 WHERE id = ?`, [userId]);
    await User.resetPassword(userId, 'another-new-pass-123');

    const req = buildReq(signCookieToken(userId, 0));
    let nextCalled = false;
    let errOut = null;
    const res = { status() { return this; }, json() { return this; }, cookie() { return this; } };
    await new Promise((resolve) => {
      setTimeout(() => resolve(new Error('next() never called (timeout)')), 10000);
      optionalAuth(req, res, (err) => { if (err) errOut = err; nextCalled = true; resolve(null); });
    });
    assert.equal(errOut, null, `optionalAuth must not reject: ${errOut?.message || ''}`);
    assert.equal(nextCalled, true, 'optionalAuth must always call next()');
    assert.equal(req.user, undefined, 'revoked token must not attach a user');
  });
});