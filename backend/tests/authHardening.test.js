// FILE LOCATION: backend/tests/authHardening.test.js
// DESCRIPTION: P0-7 (email change resets verification) + P0-8 (verified
//              email required to place orders). DB-backed for P0-7 (real user
//              row, cleaned up); P0-8 is a pure middleware unit test.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

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
const state = { userId: null };
const emailA = `authchange-a-${ts}@example.com`;
const emailB = `authchange-b-${ts}@example.com`;

before(async () => {
  if (!dbAvailable || !pool) return;
  const User = (await import('../models/usersModel.js')).default;
  const u = await User.create({
    firstName: 'Auth',
    lastName: 'Change',
    email: emailA,
    password: 'Test1234',
    legalConsentAccepted: true,
  });
  state.userId = u.id;
  await pool.execute(`UPDATE users SET is_email_verified = TRUE WHERE id = ?`, [u.id]);
});

after(async () => {
  if (!dbAvailable || !pool) return;
  try {
    await pool.execute(`DELETE FROM users WHERE id = ?`, [state.userId]);
  } finally {
    await pool.end();
  }
});

describe('P0-7 email change resets verification', () => {
  test('changing email clears is_email_verified and bumps tokenVersion', { skip: !dbAvailable }, async () => {
    const User = (await import('../models/usersModel.js')).default;
    const beforeRow = await User.findById(state.userId);
    assert.ok(beforeRow.isEmailVerified, 'fixture starts verified');
    const tvBefore = beforeRow.tokenVersion ?? 0;

    const updated = await User.update(state.userId, { email: emailB });
    assert.equal(updated.email, emailB);
    assert.ok(!updated.isEmailVerified, 'verification reset on email change');
    assert.ok((updated.tokenVersion ?? 0) > tvBefore, 'sessions revoked via tv bump');

    const [[row]] = await pool.execute(
      `SELECT is_email_verified, email_verification_token FROM users WHERE id = ?`,
      [state.userId]
    );
    assert.equal(Number(row.is_email_verified), 0);
  });

  test('non-email profile edit keeps verification', { skip: !dbAvailable }, async () => {
    const User = (await import('../models/usersModel.js')).default;
    await pool.execute(`UPDATE users SET is_email_verified = TRUE WHERE id = ?`, [state.userId]);
    const updated = await User.update(state.userId, { firstName: 'Auth2' });
    assert.ok(updated.isEmailVerified, 'firstName-only edit preserves verified');
  });
});

describe('P0-8 requireVerifiedEmail middleware', () => {
  test('unverified customer blocked, verified passes, admin bypasses', async () => {
    const { requireVerifiedEmail } = await import('../middleware/authMiddleware.js');
    const run = (user) => new Promise((resolve) => {
      const req = { user };
      const res = { status(code) { this.code = code; return this; } };
      try {
        requireVerifiedEmail(req, res, () => resolve({ next: true }));
      } catch (err) {
        resolve({ next: false, code: res.code, message: err.message });
      }
    });
    const blocked = await run({ id: 1, role: 'customer', isEmailVerified: 0 });
    assert.equal(blocked.next, false);
    assert.equal(blocked.code, 403);

    for (const v of [1, true, '1']) {
      const ok = await run({ id: 1, role: 'customer', isEmailVerified: v });
      assert.equal(ok.next, true, `verified form ${String(v)} passes`);
    }
    const admin = await run({ id: 2, role: 'admin', isEmailVerified: 0 });
    assert.equal(admin.next, true, 'admin bypasses verification gate');
  });

  test('order route wires the gate on POST /', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(new URL('../routes/orderRoutes.js', import.meta.url), 'utf8');
    assert.match(src, /requireVerifiedEmail/, 'middleware imported');
    assert.match(src, /\.post\(protect, requireVerifiedEmail, orderLimiter, addOrderItems\)/, 'gate before limiter+handler');
  });
});
