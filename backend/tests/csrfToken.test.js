// FILE LOCATION: backend/tests/csrfToken.test.js
// DESCRIPTION: N-19 coverage for the signed double-submit layer — both halves
//              of the production incident:
//
//   (a) the guard itself: a state-changing request that carries our csrf
//       cookie but no X-CSRF-Token header is 403'd ("CSRF token missing"),
//       and a matching-but-unverifiable pair is 403'd ("CSRF token mismatch")
//       — this is what broke Google login, because the SPA's raw exchange
//       fetch never echoed the header;
//   (b) the recovery path: GET /api/auth/csrf-token must never hand back a
//       dead token. A cookie signed under a rotated JWT_SECRET (or a mangled
//       value) used to be echoed verbatim, which locked the client out of
//       EVERY state-changing request for the rest of the cookie's 30-day
//       life — csrfProtection would keep answering 403 no matter what the
//       client echoed. getOrIssueCsrfToken now re-issues, and the fresh pair
//       (Set-Cookie + response body) clears the guard.
//
// Every assertion fails if either fix is reverted. No database required.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

// signCsrf HMACs with JWT_SECRET; the suite must not depend on a developer
// .env, so pin one only if the environment did not provide it.
process.env.JWT_SECRET ||= 'csrf-suite-secret';
// Production topology: Vercel SPA -> Render API, cross-site.
process.env.FRONTEND_URL = 'https://kente-market.vercel.app';

const {
  csrfProtection,
  getOrIssueCsrfToken,
  setCsrfCookie,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} = await import('../middleware/csrfMiddleware.js');

const ORIGIN = process.env.FRONTEND_URL;
const sign = (raw) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET).update(raw).digest('hex');
const validToken = () => {
  const raw = crypto.randomBytes(32).toString('base64url');
  return `${raw}.${sign(raw)}`;
};

const fakeRes = () => ({
  setCookies: [],
  cookie(name, value, opts) {
    this.setCookies.push({ name, value, opts });
    return this;
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
  req: {},
});

/** Run csrfProtection synchronously and report what happened. */
const runGuard = ({ method = 'POST', headers = {}, cookie }) => {
  const req = { method, headers: { origin: ORIGIN, ...headers }, cookies: {} };
  if (cookie !== undefined) req.cookies[CSRF_COOKIE_NAME] = cookie;
  const res = fakeRes();
  let passed = false;
  csrfProtection(req, res, () => {
    passed = true;
  });
  return { passed, status: res.statusCode, message: res.body?.message };
};

describe('csrfProtection (the guard that answered 403 in production)', () => {
  test('state-changing request WITH our cookie but no header is rejected', () => {
    const out = runGuard({ cookie: validToken() });
    assert.equal(out.passed, false);
    assert.equal(out.status, 403);
    assert.equal(out.message, 'CSRF token missing');
  });

  test('a matching pair that does not verify under JWT_SECRET is rejected', () => {
    const forged = 'deadbeef.deadbeef';
    const out = runGuard({ cookie: forged, headers: { [CSRF_HEADER_NAME]: forged } });
    assert.equal(out.passed, false);
    assert.equal(out.status, 403);
    assert.equal(out.message, 'CSRF token mismatch');
  });

  test('a valid echoing pair passes', () => {
    const token = validToken();
    const out = runGuard({ cookie: token, headers: { [CSRF_HEADER_NAME]: token } });
    assert.equal(out.passed, true, JSON.stringify(out));
  });

  test('no cookie at all still passes (public endpoints, webhooks, first login)', () => {
    assert.equal(runGuard({}).passed, true);
  });

  test('safe methods bypass the guard entirely', () => {
    assert.equal(runGuard({ method: 'GET', cookie: validToken() }).passed, true);
  });

  test('a foreign origin is rejected before the token layer', () => {
    const out = runGuard({ headers: { origin: 'https://evil.example' }, cookie: validToken() });
    assert.equal(out.passed, false);
    assert.equal(out.status, 403);
    assert.equal(out.message, 'Cross-site request rejected');
  });
});

describe('getOrIssueCsrfToken (the self-healing read channel)', () => {
  test('issues a token when the visitor has none', () => {
    const res = fakeRes();
    const token = getOrIssueCsrfToken({ cookies: {} }, res);

    assert.match(token, /^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
    assert.equal(res.setCookies.length, 1);
    assert.equal(res.setCookies[0].name, CSRF_COOKIE_NAME);
    assert.equal(res.setCookies[0].value, token);
    // It must be the same signed shape csrfProtection verifies.
    const [raw, sig] = token.split('.');
    assert.equal(sig, sign(raw));
  });

  test('echoes an existing VALID cookie without re-issuing (no gratuitous rotation)', () => {
    const existing = validToken();
    const res = fakeRes();
    const token = getOrIssueCsrfToken({ cookies: { [CSRF_COOKIE_NAME]: existing } }, res);

    assert.equal(token, existing);
    assert.equal(res.setCookies.length, 0, 'a healthy cookie must not be replaced');
  });

  test('RE-ISSUES a cookie that no longer verifies (rotated secret / mangled value)', () => {
    for (const stale of ['deadbeef.deadbeef', 'stale-signed-under-old-secret']) {
      const res = fakeRes();
      const token = getOrIssueCsrfToken({ cookies: { [CSRF_COOKIE_NAME]: stale } }, res);

      assert.notEqual(token, stale, 'a dead cookie must never be echoed back');
      assert.equal(res.setCookies.length, 1, 'the fresh value must reach the browser');
      assert.equal(res.setCookies[0].value, token, 'Set-Cookie and body must agree');
      const [raw, sig] = token.split('.');
      assert.equal(sig, sign(raw), 'the re-issued token must verify today');
    }
  });

  test('end to end: a stale-cookie client is 403-blocked, heals via the read channel, then passes', () => {
    const stale = 'deadbeef.deadbeef';

    // 1. The client is stuck: cookie present, no way to echo a valid pair.
    const before = runGuard({ cookie: stale });
    assert.equal(before.passed, false);
    assert.equal(before.status, 403);
    assert.equal(before.message, 'CSRF token missing');
    // ...and echoing the stale value does not help either.
    const echoed = runGuard({ cookie: stale, headers: { [CSRF_HEADER_NAME]: stale } });
    assert.equal(echoed.passed, false);
    assert.equal(echoed.message, 'CSRF token mismatch');

    // 2. The SPA's GET /api/auth/csrf-token heals it: new cookie + new value.
    const res = fakeRes();
    const fresh = getOrIssueCsrfToken({ cookies: { [CSRF_COOKIE_NAME]: stale }, headers: {} }, res);
    assert.notEqual(fresh, stale);

    // 3. Echoing the healed pair clears the guard.
    const after = runGuard({ cookie: fresh, headers: { [CSRF_HEADER_NAME]: fresh } });
    assert.equal(after.passed, true, JSON.stringify(after));
  });

  test('setCsrfCookie issues a fresh signed value at session issue', () => {
    const res = fakeRes();
    setCsrfCookie(res);
    assert.equal(res.setCookies.length, 1);
    const [raw, sig] = String(res.setCookies[0].value).split('.');
    assert.equal(sig, sign(raw));
  });
});
