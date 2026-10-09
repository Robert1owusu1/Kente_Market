// FILE LOCATION: backend/tests/oauthStateGate.test.js
// DESCRIPTION: V-05 (functional) — the OAuth `state` gate must refuse a
//              Google callback whose state did not come from this browser's
//              own initiation.
//
// Why this exists: V-05 (login CSRF / session fixation at the Google
// callback) was reported as fixed, but the gate is inline in
// routes/authRoutes.js and only reachable over HTTP — it cannot be called as
// an exported function, so nothing exercised it. This drives the real router
// with browser-shaped requests: cookies attached, redirects read back.
//
// The signal is the redirect TARGET, which makes the two outcomes cleanly
// separable without any network access:
//   * gate refused -> our own frontend, `login?error=invalid_oauth_state`
//   * gate passed  -> `https://accounts.google.com/o/oauth2/v2/auth?...`,
//     because with no `code` in the query passport starts the flow by
//     redirecting to the provider. It never leaves the machine.
// A test that only asserted "not a 500" would pass for a gate that does
// nothing; the accounts.google.com destination is what proves the request
// reached passport, and it is exactly what a refused request must NOT reach.
//
// These cases need no database — no fixture user, no session, no order —
// so the whole file runs on the CI no-DB path too. The pool is still opened
// by the import chain and MUST be closed, or the process hangs after
// printing its results (see the teardown note at the bottom).
//
// Env must be set before config/passPort.js is imported: the strategy is
// constructed inside configurePassport() and simply is not registered
// without credentials, in which case a passing request would fail for the
// wrong reason and the control would be meaningless.

process.env.EMAIL_DISABLED = '1';
// Importing the routes imports the rate limiters; with REDIS_URL set,
// getRedisClient() connects during module evaluation and the open socket
// keeps the event loop alive forever. backend/.env sets a real Upstash URL.
// Empty string rather than `delete`: rateLimitMiddleware re-runs
// dotenv.config() at import and only leaves alone a key that still exists.
process.env.REDIS_URL = '';
process.env.JWT_SECRET ||= 'v05-functional-secret-for-tests-only-not-a-key';
process.env.FRONTEND_URL ||= 'http://localhost:5173';
// A fixed fake origin: it must be an ORIGIN, because configurePassport()
// appends `/api/auth/google/callback` to it. Nothing ever talks to it — the
// control stops at the provider redirect.
process.env.GOOGLE_CLIENT_ID ||= 'dummy-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET ||= 'dummy-client-secret';
process.env.OAUTH_CALLBACK_URL ||= 'http://localhost:9999';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const jwt = (await import('jsonwebtoken')).default;

const { configurePassport } = await import('../config/passPort.js');
configurePassport();

// Referenced only so it can be closed in after(); no test issues a query.
const pool = (await import('../config/db.js')).default;

const express = (await import('express')).default;
const cookieParser = (await import('cookie-parser')).default;
const authRoutes = (await import('../routes/authRoutes.js')).default;
const { startServer } = await import('./helpers/httpHarness.js');

const FRONTEND = process.env.FRONTEND_URL;
const REFUSED = `${FRONTEND}/login?error=invalid_oauth_state`;
const PROVIDER_PREFIX = 'https://accounts.google.com/o/oauth2/v2/auth?';

let server = null;

// A genuine state token: same purpose claim, same secret, same shape the
// route signs. `wrongSecret` is the forgery case — an attacker who can mint
// a token the server accepts has defeated the gate outright.
const signState = (secret = process.env.JWT_SECRET, purpose = 'oauth_state') =>
  jwt.sign({ purpose, nonce: `n-${Date.now()}-${Math.random()}` }, secret, { expiresIn: '10m' });

const callback = async ({ query = '', cookie = '' } = {}) => {
  const res = await fetch(`${server.baseUrl}/api/auth/google/callback${query}`, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: 'manual',
  });
  return { status: res.status, location: res.headers.get('location'), setCookies: res.headers.getSetCookie() };
};

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use((err, req, res, next) => {
    const status = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
    res.status(status).json({ message: err.message });
  });
  server = await startServer(app);
});

after(async () => {
  if (server) await server.close();
  // Closing the pool is not optional: config/db.js constructs it during the
  // import chain above, and a held connection keeps the runner alive after
  // every result is printed — the run then looks like a hang, not a leak.
  try { await pool.end(); } catch { /* never connected, or already closed */ }
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

describe('V-05: the Google callback verifies state before it does anything else', () => {
  test('refuses a callback with no state at all', async () => {
    const r = await callback();
    assert.equal(r.status, 302, `expected a redirect, got ${r.status}`);
    assert.equal(r.location, REFUSED, `expected the state refusal, got ${r.location}`);
  });

  test('refuses state in the query but not in the cookie', async () => {
    const r = await callback({ query: `?state=${encodeURIComponent(signState())}` });
    assert.equal(r.location, REFUSED, `expected the state refusal, got ${r.location}`);
  });

  test('refuses state in the cookie but not in the query', async () => {
    const r = await callback({ cookie: `oauth_state=${signState()}` });
    assert.equal(r.location, REFUSED, `expected the state refusal, got ${r.location}`);
  });

  test('refuses a mismatched pair — this is login CSRF', async () => {
    // The attacker's browser completes Google's flow, then gets handed a
    // callback carrying THEIR state while the victim's browser holds its
    // own cookie. Without the comparison the victim would be signed into
    // the attacker's account and their subsequent actions land there.
    const r = await callback({
      query: `?state=${encodeURIComponent(signState())}`,
      cookie: `oauth_state=${signState()}`,
    });
    assert.equal(r.location, REFUSED, `expected the state refusal, got ${r.location}`);
  });

  test('refuses a forged token presented identically in both slots', async () => {
    // Identical in both slots, so the equality check alone passes — only
    // signature verification stands between this and a completed login.
    const forged = signState('attacker-controlled-secret');
    const r = await callback({
      query: `?state=${encodeURIComponent(forged)}`,
      cookie: `oauth_state=${forged}`,
    });
    assert.equal(r.location, REFUSED, `expected the state refusal, got ${r.location}`);
  });

  test('refuses a correctly-signed token carrying the wrong purpose', async () => {
    // Signed with the real secret, so verification succeeds — the purpose
    // claim is what keeps a token minted for another flow (consent,
    // exchange) from being replayed here.
    const wrongPurpose = signState(process.env.JWT_SECRET, 'legal_consent');
    const r = await callback({
      query: `?state=${encodeURIComponent(wrongPurpose)}`,
      cookie: `oauth_state=${wrongPurpose}`,
    });
    assert.equal(r.location, REFUSED, `expected the state refusal, got ${r.location}`);
  });

  test('refuses every rejected form without ever reaching the provider', async () => {
    // A gate that reached passport would redirect to Google regardless of
    // why it refused, so this is the assertion that separates "refused
    // early" from "refused late" — and refused late is not refused at all.
    const forms = [
      {},
      { query: `?state=${encodeURIComponent(signState())}` },
      { cookie: `oauth_state=${signState()}` },
      { query: `?state=${encodeURIComponent(signState())}`, cookie: `oauth_state=${signState()}` },
      { query: `?state=${encodeURIComponent(signState('forged'))}`, cookie: `oauth_state=${signState('forged')}` },
    ];
    for (const form of forms) {
      const r = await callback(form);
      assert.ok(!String(r.location).startsWith(PROVIDER_PREFIX),
        `a refused callback reached the provider: ${r.location}`);
    }
  });

  test('control: a genuine matching pair passes the gate and reaches passport', async () => {
    const state = signState();
    const r = await callback({ query: `?state=${encodeURIComponent(state)}`, cookie: `oauth_state=${state}` });
    assert.equal(r.status, 302, `expected a redirect, got ${r.status}`);
    assert.ok(String(r.location).startsWith(PROVIDER_PREFIX),
      `expected to be handed to the provider, got ${r.location}`);
    assert.ok(!r.location.includes('invalid_oauth_state'),
      'a legitimate callback was refused — this is the false positive that would break every Google login');
  });

  test('refuses a replay of a state the server has already consumed', async () => {
    // V-05 residual closed: the signed JWT alone stays valid for its full
    // 10 minutes, and an attacker who captured the callback URL holds BOTH
    // halves of the pair (query + cookie), so every client-side defence is
    // theirs to ignore. Only server-side single-use stops the second
    // delivery — the nonce is consumed at the first passing gate.
    const state = signState();
    const pair = { query: `?state=${encodeURIComponent(state)}`, cookie: `oauth_state=${state}` };
    const first = await callback(pair);
    assert.ok(String(first.location).startsWith(PROVIDER_PREFIX),
      `the first delivery must pass the gate, got ${first.location}`);
    const replay = await callback(pair);
    assert.equal(replay.status, 302, `expected a redirect, got ${replay.status}`);
    assert.equal(replay.location, REFUSED,
      `a replayed state reached passport: ${replay.location}`);
  });

  test('clears the state cookie once the gate passes', async () => {
    // The browser half of single-use: epoch expiry on both state cookies,
    // so the same device cannot replay without the cookie. The SERVER half
    // — the nonce consume, which is what stops an attacker holding a
    // captured pair — is pinned by the replay test above. Both are needed.
    const state = signState();
    const r = await callback({ query: `?state=${encodeURIComponent(state)}`, cookie: `oauth_state=${state}` });
    const cleared = r.setCookies.filter((c) => /^oauth_(state|mode)=/i.test(c));
    assert.equal(cleared.length, 2,
      `expected both oauth_state and oauth_mode to be cleared, got ${JSON.stringify(cleared)}`);
    for (const c of cleared) {
      assert.ok(/expires=thu,\s*01 jan 1970/i.test(c) || /max-age=0(?!\d)/i.test(c),
        `cleared cookie must carry an epoch expiry: ${c}`);
    }
  });

  test('initiation mints the state cookie as httpOnly', async () => {
    // The other half of the gate: the cookie must exist, be minted fresh,
    // and be unreadable from script — otherwise the comparison it feeds is
    // worthless (JS readable means XSS can forge the pair trivially).
    const res = await fetch(`${server.baseUrl}/api/auth/google`, { redirect: 'manual' });
    assert.equal(res.status, 302, `expected the provider redirect, got ${res.status}`);
    const stateCookie = res.headers.getSetCookie().find((c) => /^oauth_state=/i.test(c));
    assert.ok(stateCookie, `no oauth_state cookie was issued: ${JSON.stringify(res.headers.getSetCookie())}`);
    assert.ok(/httponly/i.test(stateCookie), `state cookie must be httpOnly: ${stateCookie}`);
    const value = stateCookie.split(';')[0].slice('oauth_state='.length);
    const decoded = jwt.decode(value);
    assert.equal(decoded?.purpose, 'oauth_state', 'the minted token must carry the oauth_state purpose');
    // ...and the token just minted must satisfy the same gate that accepts
    // it at the callback, otherwise no round trip could ever succeed.
    const r = await callback({ query: `?state=${encodeURIComponent(value)}`, cookie: `oauth_state=${value}` });
    assert.ok(String(r.location).startsWith(PROVIDER_PREFIX),
      `a token issued by initiation was rejected at the callback: ${r.location}`);
  });
});
