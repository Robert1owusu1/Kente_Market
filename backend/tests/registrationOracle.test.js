// FILE LOCATION: backend/tests/registrationOracle.test.js
// DESCRIPTION: V-10 residual CLOSED — registration no longer answers
//              400 ("address taken") vs 201 ("here is a session"). The
//              reply is uniform on EVERY observable, so enumeration of
//              which addresses hold accounts learns nothing.
//
// The old design could not be patched: the OTP was minted inside the same
// request that decided whether the address was free, and the 201 branch
// signed a session — so status, body AND Set-Cookie all separated the two
// branches. The redesign (backend/controllers/userController.js):
//
//   - POST /api/users answers 202 {message, email, regToken} on every
//     branch (new / taken-unverified / taken-verified), with no cookie;
//   - consent is checked BEFORE the existence branch, so even the consent
//     refusal cannot carry two wordings;
//   - the taken-address paths pay the same cost-12 bcrypt as User.create,
//     so response TIME does not separate them either (SMTP never did the
//     separating once sends were detached — N-20);
//   - differences happen in the MALLBOX: OTP email / OTP re-send /
//     "someone tried to register" notice (no code minted for an account
//     that is already verified);
//   - the regToken authenticates /verify-email, /resend-otp and
//     /verification-status until OTP possession proves mailbox control,
//     and the session is issued at verification — never at registration.
//
// What this suite pins (all driven over real HTTP against the real router):
//   1. uniform status/body/headers across all three address states;
//   2. consent refusal identical on both branches;
//   3. verification-status reports "pending" on every regToken branch;
//   4. resend replies identically everywhere and never writes a code into
//      a verified account;
//   5. a wrong code answers byte-identically on a free and a taken
//      address, and never sets a cookie;
//   6. the real flow still works: right code via regToken → 200 + session
//      cookie + profile;
//   7. no credential → 401 on all three endpoints;
//   8. source pins: no session/201 left in register, bcrypt parity present,
//      consent ordered before the lookup.
//
// NOTE: DB-backed; inserts then cleans up. Skips without MySQL.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// userRoutes pulls in the rate limiters; with REDIS_URL set they connect
// during module evaluation and the open socket pins the event loop (same
// pin as oauthStateGate). Empty string, not `delete` — rateLimitMiddleware
// re-runs dotenv.config() and only leaves alone a key that still exists.
process.env.REDIS_URL = '';
process.env.EMAIL_DISABLED = '1';
process.env.JWT_SECRET ||= 'registration-oracle-secret-for-tests-only-not-a-key';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

const express = (await import('express')).default;
const cookieParser = (await import('cookie-parser')).default;
const userRoutes = (await import('../routes/userRoutes.js')).default;
const { decodeRegisterPendingToken } = await import('../utils/registerPendingToken.js');
const { startServer } = await import('./helpers/httpHarness.js');

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const RUN_ID = `ro-${Date.now()}`;
const EMAILS = {
  fresh: `${RUN_ID}-fresh@test.local`,
  takenVerified: `${RUN_ID}-taken-verified@test.local`,
  takenUnverified: `${RUN_ID}-taken-unverified@test.local`,
};
let server = null;
const userIds = [];

const payload = (email, extra = {}) => ({
  firstName: 'Reg',
  lastName: 'Oracle',
  email,
  password: 'Passw0rd123',
  legalConsentAccepted: true,
  role: 'customer',
  ...extra,
});

const call = async (method, path, body) => {
  const res = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json, setCookies: res.headers.getSetCookie() };
};

const getUserRow = async (email) => {
  const [rows] = await pool.execute(
    'SELECT id, is_email_verified, email_verification_token FROM users WHERE email = ?',
    [email],
  );
  return rows[0] || null;
};

// Captured once and shared: every later test compares against these.
let freshReply, takenVerifiedReply, takenUnverifiedReply;

describe('V-10 residual closed: registration is uniform', { skip: !dbAvailable }, () => {
  before(async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/users', userRoutes);
    // Controllers signal failures by res.status(n) + throw — the real
    // server's error middleware formats them; mount the same here.
    app.use((err, req, res, next) => {
      const status = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
      res.status(status).json({ message: err.message });
    });
    server = await startServer(app);

    const [v] = await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified, tokenVersion)
       VALUES ('Taken', 'Verified', ?, 'not-a-real-password', 'customer', 1, 1, 0)`,
      [EMAILS.takenVerified],
    );
    userIds.push(v.insertId);
    const [u] = await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified, tokenVersion)
       VALUES ('Taken', 'Unverified', ?, 'not-a-real-password', 'customer', 1, 0, 0)`,
      [EMAILS.takenUnverified],
    );
    userIds.push(u.insertId);
  });

  after(async () => {
    if (server) await server.close();
    if (pool) {
      try {
        if (userIds.length) {
          await pool.execute(
            `DELETE FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`,
            userIds,
          );
        }
      } catch (e) {
        console.error('registrationOracle cleanup:', e.message);
      }
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

  test('a free address answers 202 {message, email, regToken} with no cookie', async () => {
    const r = await call('POST', '/api/users', payload(EMAILS.fresh));
    freshReply = r;
    assert.equal(r.status, 202, `expected uniform 202, got ${r.status}: ${JSON.stringify(r.json)}`);
    assert.deepEqual(Object.keys(r.json).sort(), ['email', 'message', 'regToken'],
      'the reply must carry exactly these fields — an id or role would only ever appear on one branch');
    assert.equal(r.json.email, EMAILS.fresh);
    assert.deepEqual(r.setCookies, [], 'registration must not set a session cookie on ANY branch');
    const claims = decodeRegisterPendingToken(r.json.regToken);
    assert.ok(claims, 'regToken does not decode as a register_pending token');
    assert.equal(claims.email, EMAILS.fresh);
  });

  test('a TAKEN (verified) address answers byte-identically', async () => {
    const r = await call('POST', '/api/users', payload(EMAILS.takenVerified));
    takenVerifiedReply = r;
    assert.equal(r.status, 202, `address-taken oracle returned ${r.status}: ${JSON.stringify(r.json)}`);
    assert.deepEqual(Object.keys(r.json).sort(), Object.keys(freshReply.json).sort(),
      'field sets differ between free and taken addresses');
    assert.equal(r.json.message, freshReply.json.message, 'the message differs — that IS the oracle');
    // The email field is an echo of what the caller submitted — it differs
    // here because a different address was submitted; what matters is that
    // it is the echo and nothing more (no account id, no role, no flag).
    assert.equal(r.json.email, EMAILS.takenVerified);
    assert.deepEqual(r.setCookies, [], 'a taken address must not receive a cookie the free one does not');
    const claims = decodeRegisterPendingToken(r.json.regToken);
    assert.ok(claims && claims.email === EMAILS.takenVerified);
  });

  test('a TAKEN (unverified) address answers byte-identically too, and its OTP is re-sent', async () => {
    const r = await call('POST', '/api/users', payload(EMAILS.takenUnverified));
    takenUnverifiedReply = r;
    assert.equal(r.status, 202, `got ${r.status}: ${JSON.stringify(r.json)}`);
    assert.deepEqual(Object.keys(r.json).sort(), Object.keys(freshReply.json).sort());
    assert.equal(r.json.message, freshReply.json.message);
    assert.deepEqual(r.setCookies, []);
    const row = await getUserRow(EMAILS.takenUnverified);
    assert.ok(row && row.email_verification_token,
      'the real owner of an unverified address must receive a usable code');
    assert.ok(!row.is_email_verified, 'registering again must not verify the account');
  });

  test('consent refusal is identical on BOTH branches (the wording oracle)', async () => {
    const fresh = await call('POST', '/api/users', payload(EMAILS.fresh, { legalConsentAccepted: false }));
    const taken = await call('POST', '/api/users', payload(EMAILS.takenVerified, { legalConsentAccepted: false }));
    assert.equal(fresh.status, 400);
    assert.equal(taken.status, 400);
    assert.deepEqual(taken.json, fresh.json,
      'consent is checked after the existence branch again — one branch now speaks first');
  });

  test('verification-status reports PENDING on every regToken branch', async () => {
    const fresh = await call('GET', `/api/users/verification-status?regToken=${encodeURIComponent(freshReply.json.regToken)}`);
    const taken = await call('GET', `/api/users/verification-status?regToken=${encodeURIComponent(takenVerifiedReply.json.regToken)}`);
    assert.equal(fresh.status, 200, JSON.stringify(fresh.json));
    assert.equal(taken.status, 200, JSON.stringify(taken.json));
    assert.equal(fresh.json.isEmailVerified, false);
    assert.deepEqual(taken.json, fresh.json,
      'status betrays the branch: a taken address answered differently from a free one');
    assert.equal(typeof fresh.json.attemptsRemaining, 'number');
  });

  test('resend replies identically everywhere and never writes a code into a verified account', async () => {
    const fresh = await call('POST', '/api/users/resend-otp', { regToken: freshReply.json.regToken });
    const takenUnverified = await call('POST', '/api/users/resend-otp', { regToken: takenUnverifiedReply.json.regToken });
    const takenVerified = await call('POST', '/api/users/resend-otp', { regToken: takenVerifiedReply.json.regToken });

    assert.equal(fresh.status, 200, JSON.stringify(fresh.json));
    assert.equal(takenUnverified.status, 200, JSON.stringify(takenUnverified.json));
    assert.equal(takenVerified.status, 200,
      `resend said ${takenVerified.status} for a taken address: ${JSON.stringify(takenVerified.json)}`);
    assert.deepEqual(takenUnverified.json, fresh.json);
    assert.deepEqual(takenVerified.json, fresh.json,
      'resend leaks the branch through its reply');

    const verifiedRow = await getUserRow(EMAILS.takenVerified);
    assert.equal(verifiedRow.email_verification_token, null,
      'a code was minted into an account that is already verified — a verification path into it');
    assert.equal(verifiedRow.is_email_verified, 1, 'the verified fixture must stay verified');
  });

  test('a wrong code answers byte-identically on a free and a taken address, with no cookie', async () => {
    const freshRow = await getUserRow(EMAILS.fresh);
    // A guaranteed-wrong code: the real one plus one, mod 10^6.
    const wrong = String((parseInt(freshRow.email_verification_token, 10) + 1) % 1000000).padStart(6, '0');

    const fresh = await call('POST', '/api/users/verify-email', { otp: wrong, regToken: freshReply.json.regToken });
    const taken = await call('POST', '/api/users/verify-email', { otp: wrong, regToken: takenVerifiedReply.json.regToken });

    assert.equal(fresh.status, 400);
    assert.equal(taken.status, 400, `taken address answered ${taken.status} to a wrong code`);
    assert.deepEqual(taken.json, fresh.json, 'wrong-code reply differs by branch');
    assert.deepEqual(fresh.setCookies, [], 'a failed verification must not establish a session');
    assert.deepEqual(taken.setCookies, [], 'a failed verification must not establish a session');
  });

  test('the real flow still works: right code via regToken → session + profile', async () => {
    const row = await getUserRow(EMAILS.fresh);
    const r = await call('POST', '/api/users/verify-email', {
      otp: row.email_verification_token,
      regToken: freshReply.json.regToken,
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.isEmailVerified, true);
    assert.ok(r.json.id && r.json.email === EMAILS.fresh && r.json.role,
      'the reply must carry the profile: a regToken caller has no other source for it');
    assert.ok(r.setCookies.some((c) => /^jwt=/i.test(c)),
      'OTP possession must establish the session — nothing else does now');
  });

  test('no credential at all → 401 on all three endpoints', async () => {
    for (const [method, path, body] of [
      ['POST', '/api/users/verify-email', { otp: '000000' }],
      ['POST', '/api/users/resend-otp', {}],
      ['GET', '/api/users/verification-status', undefined],
    ]) {
      const r = await call(method, path, body);
      assert.equal(r.status, 401, `${method} ${path} answered ${r.status} without any credential`);
    }
  });

  test('source: register issues no session, pays bcrypt parity, and checks consent first', () => {
    const src = read('../controllers/userController.js');
    const block = src.slice(src.indexOf('const registerUser'), src.indexOf('const logoutUser'));
    assert.ok(block.length > 0, 'registerUser not found in userController');

    assert.ok(!/generateToken\(/.test(block),
      'register signs a session again — the cookie becomes the oracle (only the verify path may issue)');
    assert.ok(!/status\(201\)/.test(block), 'register answers 201 again — status must be the uniform 202');
    assert.match(block, /status\(202\)/, 'the uniform 202 reply is gone');

    // Timing parity: taken-address paths must pay the same cost-12 bcrypt
    // that User.create charges the fresh path.
    assert.match(block, /bcrypt\.hash\(password, 12\)/,
      'the taken-address branch no longer matches User.create hashing cost — timing becomes the oracle');

    const consentAt = block.indexOf('if (!legalConsentAccepted)');
    const lookupAt = block.indexOf('User.findByEmail(email)');
    assert.ok(consentAt !== -1 && lookupAt !== -1 && consentAt < lookupAt,
      'consent must be settled before the existence lookup — otherwise the refusal wording branches');

    // The three-way out-of-band split: notice for verified, OTP for
    // unverified, OTP for fresh.
    assert.match(block, /sendRegistrationNoticeEmail/, 'the verified-address notice email is gone');
    assert.match(block, /continueExistingAccount/, 'the uniform taken-address handling is gone');
  });
});
