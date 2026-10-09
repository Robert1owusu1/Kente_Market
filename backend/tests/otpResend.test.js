// FILE LOCATION: backend/tests/otpResend.test.js
// DESCRIPTION: M-1 — the limiter on POST /resend-otp counted nothing.
//
// `authLimiter` carries `skipSuccessfulRequests: true`, which is right for
// login: a user typing their real password must not spend the bucket on the
// attempts that work. Mounted on /resend-otp it was backwards, because there a
// successful response IS the harm — express-rate-limit decrements the counter
// once the response finishes under 400, so every successful resend cancelled
// itself out and the limiter never counted the one case worth bounding.
//
// Reachable, not theoretical: registration does not require a verified
// address, so an attacker who registers with somebody else's address holds a
// regToken that legitimately reaches /resend-otp (it demands a session OR
// that token, and `!isEmailVerified`) and can flood that inbox at the pace of
// the general 600/15min apiLimiter. That is why the route mounts
// optionalAuth + attachVerificationAuth BEFORE otpResendLimiter: the limiter
// keys on `req.user?.email`, and the recipient half of the key only exists
// once the regToken has been resolved — mounting the limiter first would
// fall back to source IP, which a rotating attacker walks away from.
//
// The second half of the finding is a number that disagreed with itself:
// `getVerificationStatus` reported `5 - attempts` as a literal while the WHERE
// clause that enforces the cap read `MAX_OTP_ATTEMPTS`. EmailVerification.tsx
// renders that figure directly, so configuring the setting made the API tell
// users something the backend would not do.
//
// The behavioural tests drive the real express-rate-limit instance as a plain
// function rather than asserting configuration, because "does not count
// successful requests" is a behaviour and a grep can only show that the flag
// is absent. The fake response below therefore behaves like a live one —
// including emitting 'finish' on allowed requests — so a reintroduced flag
// would show up here instead of only in production.
//
// NOTE: pure — no database, runs in the no-DB CI job.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.REDIS_URL = '';

// `authLimiter` is deliberately NOT imported: it is only asserted against in
// source below, and lint (rightly) refuses an unused binding.
const { otpResendLimiter } = await import('../middleware/rateLimitMiddleware.js');
const User = (await import('../models/usersModel.js')).default;

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/**
 * Drive one request through a limiter and resolve with the status the client
 * would see.
 *
 * Rate-limited requests never call `next` — express-rate-limit invokes the
 * configured `handler`, which sends the 429 itself — so the promise resolves
 * from both `json()` and `next()`.
 *
 * A timeout resolves rather than rejects, so a limiter that swallowed the
 * request fails an assertion instead of hanging the file.
 */
const call = (limiter, { email = 'victim@example.com', ip = '203.0.113.9' } = {}) =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };
    const timer = setTimeout(() => finish('TIMEOUT'), 5000);

    const listeners = { finish: [] };

    // A live response emits 'finish' after the handler sends, and that event is
    // what `skipSuccessfulRequests`/`skipFailedRequests` hook to decrement.
    // It fires from BOTH paths here: from `json()` when the limiter itself
    // sends the 429, and from `next()` for an allowed request — standing in
    // for the route handler replying downstream. Emitting it only from
    // `json()` would leave allowed requests without a 'finish', which is
    // precisely the shape in which those flags do nothing, so reintroducing
    // one would keep this suite green while production went back to counting
    // nothing. Resolution is deferred a tick so the async decrement
    // express-rate-limit schedules has landed before the next call.
    const settle = (status) => {
      if (settled) return;
      for (const cb of listeners.finish) cb();
      setTimeout(() => finish(status), 5);
    };

    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      getHeader(k) { return this.headers[k]; },
      status(c) { this.statusCode = c; return this; },
      once(event, cb) {
        if (listeners[event]) listeners[event].push(cb);
        return this;
      },
      on(event, cb) { return this.once(event, cb); },
      removeListener() { return this; },
      json() { settle(this.statusCode); return this; },
    };

    const req = {
      ip,
      headers: {},
      body: {},
      user: { id: 1, email },
      method: 'POST',
      originalUrl: '/api/users/resend-otp',
      get(h) { return this.headers[h.toLowerCase()]; },
    };

    limiter(req, res, () => settle(res.statusCode));
  });

describe('M-1: successful resends are what get counted', () => {
  test('five allowed, then 429 — the successes did not cancel themselves out', async () => {
    const results = [];
    for (let i = 1; i <= 7; i += 1) results.push(await call(otpResendLimiter));
    assert.deepEqual(
      results,
      [200, 200, 200, 200, 200, 429, 429],
      `expected 5 through then refused, got ${results.join(', ')}`,
    );
  });

  test('the bucket is the recipient, not the source address', async () => {
    // Exhaust the victim's bucket first.
    for (let i = 0; i < 6; i += 1) await call(otpResendLimiter);

    // The SAME inbox from six different IPs stays refused: rotating
    // X-Forwarded-For buys nothing, which is the whole reason the sibling
    // accountAuthLimiter dropped the IP component too.
    const rotated = [];
    for (let i = 1; i <= 6; i += 1) {
      rotated.push(await call(otpResendLimiter, { ip: `198.51.100.${i}` }));
    }
    assert.deepEqual(rotated, [429, 429, 429, 429, 429, 429]);

    // A DIFFERENT inbox from that very same address is unaffected: proof the
    // key carries no IP, so one hostile recipient cannot spend everyone else's
    // allowance.
    const other = [];
    for (let i = 0; i < 3; i += 1) {
      other.push(await call(otpResendLimiter, { email: 'other@example.com' }));
    }
    assert.deepEqual(other, [200, 200, 200]);
  });

  test('each recipient gets a full budget of their own', async () => {
    const a = [];
    const b = [];
    for (let i = 0; i < 6; i += 1) a.push(await call(otpResendLimiter, { email: 'a@example.com' }));
    for (let i = 0; i < 6; i += 1) b.push(await call(otpResendLimiter, { email: 'b@example.com' }));
    assert.deepEqual(a, [200, 200, 200, 200, 200, 429]);
    assert.deepEqual(b, [200, 200, 200, 200, 200, 429]);
  });
});

// ---------------------------------------------------------------------------
// Configuration, and proof that nothing else was loosened
// ---------------------------------------------------------------------------
/** Slice a limiter to the end of ITS OWN `});`, which sits at column 0 — the
 *  indented `});` closing `res.status(429).json({...})` must not end the cut.
 *  Comments are stripped from the result: these blocks document why a flag is
 *  deliberately ABSENT by naming it, and an assertion that greps the prose
 *  would fail for the opposite of the reason it was written. */
const limiterBlock = (src, name) => {
  const start = src.indexOf(`export const ${name}`);
  assert.ok(start > -1, `${name} must exist`);
  const end = src.indexOf('\n});', start);
  assert.ok(end > start, `could not close the ${name} block`);
  return src.slice(start, end).replace(/\/\/[^\r\n]*/g, '');
};

describe('M-1: the resend limiter is configured to count', () => {
  const middlewareSrc = read('../middleware/rateLimitMiddleware.js');
  const routesSrc = read('../routes/userRoutes.js');
  const resendBlock = limiterBlock(middlewareSrc, 'otpResendLimiter');

  test('no skip flag — that is the entire point of this file', () => {
    assert.ok(
      !/skipSuccessfulRequests/.test(resendBlock),
      'otpResendLimiter skips successful requests, which on this route is every request that matters',
    );
    assert.ok(!/skipFailedRequests/.test(resendBlock), 'failed requests are skipped too');
  });

  test('bounded, 15-minute window, keyed on the recipient', () => {
    assert.match(resendBlock, /windowMs: 15 \* 60 \* 1000/, 'window must be 15 minutes');
    assert.match(resendBlock, /max: 5/, 'max must be 5 per recipient per window');
    assert.match(resendBlock, /otp-resend:/, 'key must be namespaced to this limiter');
    assert.match(resendBlock, /req\.user\?\.email/, 'key must be the recipient, not the source IP');
    assert.match(resendBlock, /\.\.\.redisStore\('rl:otpresend'\)/, 'shares a Redis prefix with another limiter');
  });

  test('the route mounts it instead of authLimiter', () => {
    const line = routesSrc.split('\n').find((l) => l.includes("'/resend-otp'"));
    assert.ok(line, '/resend-otp route not found');
    assert.match(line, /otpResendLimiter/, 'the resend route is not behind otpResendLimiter');
    assert.ok(!/authLimiter/.test(line), 'authLimiter is still on /resend-otp and still skipping successes');
    // Auth moved from the route's `protect` into the session-or-regToken
    // chain — it must precede the limiter or the per-recipient key has no
    // email to bind to (see the header note). `attachVerificationAuth`
    // 401s exactly where `protect` did when neither credential exists;
    // registrationOracle.test.js pins that behaviour end to end.
    assert.match(line, /attachVerificationAuth/, 'the route lost its auth requirement');
    assert.match(line, /otpResendLimiter/, 'limiter must follow the auth that supplies its recipient key');
    assert.ok(
      routesSrc.includes('otpResendLimiter'),
      'otpResendLimiter is not imported into userRoutes',
    );
  });

  test('authLimiter itself is untouched — login must still skip real passwords', () => {
    // M-1 was fixed by giving the resend route its own limiter, NOT by
    // reworking authLimiter: `skipSuccessfulRequests` is correct on /auth and
    // changing it would charge every successful login against the bucket,
    // locking users out after 5 good sign-ins in 15 minutes.
    const authBlock = limiterBlock(middlewareSrc, 'authLimiter');
    assert.match(authBlock, /skipSuccessfulRequests: true/);
    const authLine = routesSrc.split('\n').find((l) => l.includes("'/auth'"));
    assert.match(authLine, /authLimiter/, 'login lost its IP limiter');
    const verifyLine = routesSrc.split('\n').find((l) => l.includes("'/verify-email'"));
    assert.match(verifyLine, /authLimiter/, 'verify-email was changed too — out of scope for M-1');
  });
});

// ---------------------------------------------------------------------------
// The attempt budget existed in two places that could not see each other
// ---------------------------------------------------------------------------
describe('M-1: the OTP attempt budget has one definition', () => {
  const saved = process.env.MAX_OTP_ATTEMPTS;

  beforeEach(() => { delete process.env.MAX_OTP_ATTEMPTS; });
  afterEach(() => {
    if (saved === undefined) delete process.env.MAX_OTP_ATTEMPTS;
    else process.env.MAX_OTP_ATTEMPTS = saved;
  });

  test('defaults to 5 when unset', () => {
    assert.equal(User.maxOtpAttempts(), 5);
  });

  test('honours a configured value', () => {
    process.env.MAX_OTP_ATTEMPTS = '7';
    assert.equal(User.maxOtpAttempts(), 7);
  });

  test('junk falls back to the default rather than throwing or passing through', () => {
    for (const bad of ['abc', '', '  ', '3.7.1']) {
      process.env.MAX_OTP_ATTEMPTS = bad;
      assert.equal(User.maxOtpAttempts(), 5, `"${bad}" did not fall back`);
    }
  });

  test('zero and negatives fail safe — the old `|| 5` let a negative through', () => {
    // With -3 the enforced clause becomes `verification_attempts < -3`, which
    // is never true, so NO otp would ever verify while the status endpoint
    // still told the user they had 5 attempts left.
    for (const bad of ['0', '-3', '-1']) {
      process.env.MAX_OTP_ATTEMPTS = bad;
      assert.equal(User.maxOtpAttempts(), 5, `"${bad}" must not be accepted as a budget`);
    }
  });

  test('no second copy of the budget survives anywhere', () => {
    // Comments are stripped before matching: maxOtpAttempts()'s own docblock
    // QUOTES the expression it replaced, and `.` never matches \r — so the
    // pattern has to stop at the line end rather than at `$`. Asserting on
    // commented-out text is how a source guard starts passing for the wrong
    // reason.
    const strip = (src) => src.replace(/\/\/[^\r\n]*/g, '');
    const modelSrc = strip(read('../models/usersModel.js'));
    const controllerSrc = strip(read('../controllers/userController.js'));

    // Exactly one place READS the setting: inside maxOtpAttempts() itself.
    // Matched on the env var rather than on parseInt(), so the guard keeps
    // holding if the parser is ever swapped the way it just was.
    const reads = modelSrc.match(/process\.env\.MAX_OTP_ATTEMPTS/g) || [];
    assert.equal(reads.length, 1, `MAX_OTP_ATTEMPTS is read ${reads.length} times in usersModel`);

    assert.equal(
      (modelSrc.match(/User\.maxOtpAttempts\(\)/g) || []).length,
      1,
      'verifyEmail must go through maxOtpAttempts()',
    );
    assert.match(controllerSrc, /User\.maxOtpAttempts\(\) - attempts\.verification_attempts/);
    assert.ok(
      !/5 - attempts\.verification_attempts/.test(controllerSrc),
      'the literal 5 is back in getVerificationStatus',
    );
  });

  test('the enforced cap and the reported cap are literally the same expression', () => {
    const modelSrc = read('../models/usersModel.js');
    assert.match(
      modelSrc,
      /\[userId, otp, User\.maxOtpAttempts\(\)\]/,
      'the WHERE clause no longer enforces the shared budget',
    );
  });
});
