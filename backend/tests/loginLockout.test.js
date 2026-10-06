// FILE LOCATION: backend/tests/loginLockout.test.js
// DESCRIPTION: P2 coverage for V-10 (windowed failed-login lockout + the
//              forgot/reset-password existence oracles) and for the N-8/N-9
//              boot-time guards.
//
// Design rule: every assertion here must FAIL if its fix is reverted — the
// static guards read the real source, and the DB tests drive the real model
// against a real database (they skip only when no database is reachable, and
// the CI DB job always has one).
//
//   V-10(a)  failed_login_attempts decays inside LOGIN_FAILURE_WINDOW_MINUTES,
//            so a request-per-hour attacker can no longer hold an account
//            locked forever: after a quiet period ONE attempt must reset the
//            counter to 1 and must NOT re-arm the lock.
//   V-10(b)  forgot-password and reset-token validation answer every request
//            with one byte-identical 200 body, whatever the account/token
//            state (the old 5xx-on-SMTP-failure and `valid: true|false` were
//            precise existence oracles).
//   register the 400-vs-201 registration oracle cannot be closed without
//            redesigning OTP verification, so it is bounded instead: a
//            per-email limiter that counts BOTH answers (residual P3 in the
//            report).
//   N-8      cookie Secure flag is derived per request (cookieSecure), and the
//            server refuses to boot SameSite=None outside production.
//   N-9      TRUST_PROXY > 0 must be called out loudly at boot.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cookieSecure as cookieSecureFor } from '../config/cookieConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(backendRoot, rel), 'utf8');

// Pull the function body of a top-level `const name = ... => { ... });`
// declaration. The closing line is unindented, so the first `\n});` ends it.
const fnBody = (src, declaration) => {
  const start = src.indexOf(declaration);
  assert.ok(start !== -1, `declaration not found: ${declaration}`);
  const rest = src.slice(start);
  const end = rest.indexOf('\n});');
  assert.ok(end !== -1, `could not find end of ${declaration}`);
  return rest.slice(0, end);
};

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

// ===========================================================================
// V-10(a) — static guards on the lockout implementation
// ===========================================================================
describe('V-10(a): windowed lockout source guards', () => {
  const src = readSrc('models/usersModel.js');

  test('failure window is an explicit, bounded constant', () => {
    const windowMatch = src.match(/const LOGIN_FAILURE_WINDOW_MINUTES = (\d+);/);
    assert.ok(windowMatch, 'LOGIN_FAILURE_WINDOW_MINUTES must be declared');
    const minutes = Number(windowMatch[1]);
    assert.ok(minutes > 0 && minutes <= 60, `window must be a bounded value, got ${minutes}m`);
    assert.match(src, /const LOGIN_LOCK_THRESHOLD = \d+;/, 'lock threshold must be a constant');
    assert.match(src, /const LOGIN_LOCK_MINUTES = \d+;/, 'lock duration must be a constant');
  });

  test('increment is ONE conditional statement carrying the window clause', () => {
    // The mutation this blocks: `SET failed_login_attempts = failed_login_attempts + 1`
    // with no time test — a counter that never decays lets one request per hour
    // hold an account locked permanently.
    assert.match(
      src,
      /failed_login_attempts\s*=\s*IF\(/,
      'the increment must be a single IF() statement (atomic decide-and-bump)'
    );
    assert.match(
      src,
      /last_failed_at\s*<\s*DATE_SUB\(NOW\(\), INTERVAL (?:\d+|\$\{[A-Z_]+\}) MINUTE\)/,
      'the IF() must compare last_failed_at against the decay window'
    );
    assert.ok(
      !/failed_login_attempts\s*=\s*failed_login_attempts\s*\+\s*1\s*,\s*\n?\s*last_failed_at\s*=\s*NOW\(\)/.test(src) ||
        /failed_login_attempts\s*=\s*IF\(/.test(src),
      'a bare unconditional +1 increment would re-enable permanent lockout'
    );
  });

  test('lock is conditional on reaching the threshold, never on attempt count alone', () => {
    assert.match(
      src,
      /SET locked_until = DATE_ADD\(NOW\(\), INTERVAL (?:\d+|\$\{[A-Z_]+\}) MINUTE\)\s+WHERE id = \? AND failed_login_attempts >= \?/,
      'the lock UPDATE must be a conditional CAS on the threshold'
    );
  });

  test('success, password reset and OAuth adoption all clear the window marker', () => {
    // last_failed_at = NULL is the part that is easy to forget: without it the
    // first failure after a clean login inherits an old timestamp and either
    // decays wrongly or accumulates wrongly.
    const clears = src.match(/last_failed_at = NULL/g) || [];
    assert.ok(clears.length >= 2, `expected the marker to be cleared in >=2 paths, found ${clears.length}`);
    assert.match(
      src,
      /failed_login_attempts = 0, locked_until = NULL, last_failed_at = NULL/,
      'a successful login must reset counter, lock and window marker together'
    );
  });
});

// ===========================================================================
// V-10(b) — forgot-password / reset-token existence oracles
// ===========================================================================
describe('V-10(b): forgot/reset reply is byte-identical', () => {
  const src = readSrc('controllers/userController.js');

  test('forgot-password has exactly one 200 body and no error path', () => {
    const body = fnBody(src, 'const forgotPassword = asyncHandler');

    assert.match(body, /FORGOT_PASSWORD_REPLY/, 'the reply must come from the shared constant');
    // The whole body must be that constant — not a template that could vary
    // with the lookup result. This is the byte-identical requirement itself.
    assert.match(
      body,
      /res\.status\(200\)\.json\(\{\s*message:\s*FORGOT_PASSWORD_REPLY\s*\}\)/,
      'the 200 body must be exactly { message: FORGOT_PASSWORD_REPLY }'
    );

    const statuses = body.match(/res\.status\(\d+\)/g) || [];
    const unique = [...new Set(statuses)].sort();
    // 400 = missing email (a validation failure, identical for everyone);
    // 200 = the single always-taken reply. Anything else — especially 500 on
    // SMTP failure — tells the caller whether the account exists, because only
    // an existing account can produce a delivery error.
    assert.deepEqual(
      unique.sort(),
      ['res.status(200)', 'res.status(400)'],
      `forgot-password may only answer 200/400, found: ${unique.join(', ')}`
    );
    assert.equal(
      statuses.filter((s) => s === 'res.status(200)').length,
      1,
      'there must be exactly one 200 reply, reached whatever the lookup returns'
    );
    assert.equal(
      statuses.filter((s) => s === 'res.status(400)').length,
      1,
      'only the missing-email validation may 400'
    );
    assert.ok(
      body.indexOf('res.status(400)') < body.indexOf('User.findByEmail'),
      'the 400 must be a validation failure raised before the lookup, never a consequence of it'
    );

    // A delivery failure is swallowed: logged, token dropped, same reply.
    assert.ok(!/res\.status\(5\d\d\)/.test(body), 'a 5xx here is an existence oracle');
    assert.match(body, /could not be delivered/, 'SMTP failures must still be logged server-side');
    assert.match(body, /clearResetToken/, 'an undeliverable token must be dropped, not left usable');
  });

  test('validateResetToken returns one body with no valid flag', () => {
    const body = fnBody(src, 'const validateResetToken = asyncHandler');

    const statuses = body.match(/res\.status\(\d+\)/g) || [];
    assert.equal(statuses.length, 1, 'one reply only, emitted before any lookup branch');
    assert.equal(statuses[0], 'res.status(200)', 'validation must always answer 200');
    assert.match(
      body,
      /res\.status\(200\)\.json\(\{\s*message:\s*'[^']+'\s*\}\)/,
      'the reply must be one fixed literal string — no template, no lookup-dependent value'
    );
    // Comments describe the OLD behaviour (`valid: true|false`) — strip them so
    // documentation cannot masquerade as a live field, or hide a real one.
    const live = body.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(
      !/valid:\s*(true|false)/.test(live),
      'a valid:true|false field turns this endpoint into a token oracle'
    );
    assert.ok(!/res\.status\(4\d\d\)/.test(live), 'unknown/expired tokens must not get a 4xx');
  });

  test('the shared reply is a module constant, not a per-branch string', () => {
    const declared = src.match(/const FORGOT_PASSWORD_REPLY\s*=\s*\n?\s*'([^']+)'/);
    assert.ok(declared, 'FORGOT_PASSWORD_REPLY must be declared once');
    assert.equal(
      (src.match(/FORGOT_PASSWORD_REPLY/g) || []).length,
      2,
      'the constant must be declared once and referenced once (one reply, no variants)'
    );
  });
});

// ===========================================================================
// V-10(b, c) — registration enumeration is bounded per target email
// ===========================================================================
describe('V-10(c): per-email registration limiter', () => {
  test('limiter exists, is small, and counts both outcomes', () => {
    const src = readSrc('middleware/rateLimitMiddleware.js');
    const start = src.indexOf('export const accountRegisterLimiter');
    assert.ok(start !== -1, 'accountRegisterLimiter must exist');
    const block = src.slice(start, src.indexOf('});', start));

    assert.match(block, /windowMs: 15 \* 60 \* 1000/, 'window must be 15 minutes');
    assert.match(block, /max: 5/, 'max must be 5 attempts per window');
    assert.match(block, /acct-register:/, 'key must be namespaced to this limiter');
    assert.match(block, /req\.body\?\.email/, 'key must be the probed email, not the source IP');
    assert.ok(
      !/skipSuccessfulRequests/.test(block),
      'both outcomes must count: a 400 and a 201 are both answers to the prober'
    );
  });

  test('register route mounts the per-email limiter after the IP limiter', () => {
    const routes = readSrc('routes/userRoutes.js');
    assert.match(
      routes,
      /router\.post\('\/', registerLimiter, accountRegisterLimiter, registerUser\)/,
      'registration must be bound per target email as well as per IP'
    );
    assert.match(routes, /accountRegisterLimiter/, 'accountRegisterLimiter must be imported');
  });
});

// ===========================================================================
// N-8 — Secure cookie derivation + boot refusal
// ===========================================================================
describe('N-8: cookie Secure flag', () => {
  const saved = {};
  const withEnv = (vars, fn) => {
    const keys = ['COOKIE_SAME_SITE', 'NODE_ENV'];
    for (const k of keys) saved[k] = process.env[k];
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      return fn();
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  };

  test('SameSite=None forces Secure even with NODE_ENV empty', () => {
    // The shipped failure: COOKIE_SAME_SITE=none + empty NODE_ENV produced
    // Set-Cookie: …; SameSite=None with no Secure (browsers reject it; if they
    // had not, the cookie would have been cleartext-eligible).
    const secure = withEnv({ COOKIE_SAME_SITE: 'none', NODE_ENV: undefined }, () =>
      cookieSecureFor({})
    );
    assert.equal(secure, true, 'SameSite=None must always be paired with Secure');
  });

  test('production forces Secure regardless of request scheme', () => {
    const secure = withEnv({ COOKIE_SAME_SITE: 'lax', NODE_ENV: 'production' }, () =>
      cookieSecureFor({ secure: false })
    );
    assert.equal(secure, true, 'production must never issue a non-Secure auth cookie');
  });

  test('otherwise the request scheme decides', () => {
    withEnv({ COOKIE_SAME_SITE: 'lax', NODE_ENV: undefined }, () => {
      assert.equal(cookieSecureFor({ secure: true }), true, 'HTTPS request -> Secure cookie');
      assert.equal(cookieSecureFor({ secure: false }), false, 'plain HTTP dev stays usable');
      assert.equal(cookieSecureFor(undefined), false, 'missing req must not throw');
    });
  });

  test('every cookie call site derives Secure from cookieSecure', async () => {
    const { cookieSecure } = await import('../config/cookieConfig.js');
    assert.equal(typeof cookieSecure, 'function', 'cookieSecure must be exported');

    const files = [
      'middleware/csrfMiddleware.js',
      'utils/generateToken.js',
      'controllers/staffController.js',
      'controllers/userController.js',
      'routes/cartRoutes.js',
      'routes/authRoutes.js',
      'server.js',
    ];
    let callSites = 0;
    for (const f of files) {
      const code = readSrc(f);
      // Strip line comments so documentation mentioning the old pattern does
      // not count as a live call site.
      const live = code.replace(/^\s*\/\/.*$/gm, '');
      assert.ok(
        !/secure:\s*(process\.env\.)?NODE_ENV\s*===\s*'production'/.test(live),
        `${f} still hardcodes secure: NODE_ENV === 'production' (N-8)`
      );
      callSites += (live.match(/cookieSecure\(/g) || []).length;
    }
    assert.ok(callSites >= 12, `expected >=12 cookieSecure() call sites, found ${callSites}`);

    // express-session cannot take our helper directly (it has no req yet), so
    // it gets the equivalent derived rule with an 'auto' fallback instead of a
    // bare NODE_ENV test.
    assert.match(
      readSrc('server.js'),
      /secure: cookieSameSite\(\) === 'none' \|\| process\.env\.NODE_ENV === 'production' \? true : 'auto'/,
      'session cookie must use the same rule with an auto fallback'
    );
  });

  test('server refuses to boot SameSite=None outside production', () => {
    const server = readSrc('server.js');
    const guard = server.indexOf(
      "if (cookieSameSite() === 'none' && process.env.NODE_ENV !== 'production')"
    );
    assert.ok(guard !== -1, 'the SameSite=None boot guard must exist');
    const after = server.slice(guard, guard + 900);
    assert.match(after, /Refusing to boot: COOKIE_SAME_SITE=none requires NODE_ENV=production/);
    assert.match(
      after,
      /process\.exit\(1\)/,
      'the guard must stop the process — logging alone still issues unsafe cookies'
    );
    // The guard must run before the app starts serving: it sits above the
    // /api/ csrf mount, which is installed during startup.
    const csrfMount = server.indexOf("app.use('/api/', csrfProtection)");
    assert.ok(csrfMount > guard, 'guard must execute before the app is wired up');
  });

  test('backend/.env no longer ships the unsafe combination', () => {
    const envPath = path.join(backendRoot, '.env');
    if (!fs.existsSync(envPath)) return; // CI has no .env at all — nothing to be unsafe
    const env = fs.readFileSync(envPath, 'utf8');
    const sameSite = env.match(/^COOKIE_SAME_SITE=(.*)$/m);
    if (!sameSite) return;
    const nodeEnv = env.match(/^NODE_ENV=(.*)$/m);
    const isNone = (sameSite[1] || '').trim().toLowerCase() === 'none';
    const isProduction = (nodeEnv?.[1] || '').trim() === 'production';
    assert.ok(
      !isNone || isProduction,
      'backend/.env pairs COOKIE_SAME_SITE=none with a non-production NODE_ENV (server would refuse to boot)'
    );
  });
});

// ===========================================================================
// N-9 — TRUST_PROXY must be stated, never silently assumed
// ===========================================================================
describe('N-9: TRUST_PROXY is called out at boot', () => {
  const server = readSrc('server.js');

  test('a warning block runs only when a proxy is trusted', () => {
    const guard = server.indexOf('if (trustProxySetting > 0) {');
    assert.ok(guard !== -1, 'the TRUST_PROXY>0 branch must exist');
    const block = server.slice(guard, guard + 1400);
    assert.match(block, /console\.warn/, 'trusting a hop must produce a warning');
    assert.match(block, /X-Forwarded-For/, 'the warning must name the header being trusted');
    assert.match(block, /rate limit/i, 'the warning must state that IP-keyed limits inherit it');
    assert.match(block, /production/, 'the warning must escalate its wording in production');
    assert.match(block, /app\.set\('trust proxy', trustProxySetting\)/, 'the parsed value must still be applied');
  });

  test('default stays 0 (do not trust XFF unless told to)', () => {
    assert.match(
      server,
      /const trustProxySetting = process\.env\.TRUST_PROXY !== undefined/,
      'TRUST_PROXY must be parsed explicitly, never defaulted on'
    );
    assert.match(server, /Math\.max\(0, Math\.min\(parseInt\(process\.env\.TRUST_PROXY, 10\) \|\| 0, 3\)\)/,
      'trust level must be clamped to 0..3');
  });
});

// ===========================================================================
// V-10(a) — behavioural proof against a real database
// ===========================================================================
describe('V-10(a): windowed lockout behaves as specified (live DB)', () => {
  const ts = Date.now();
  // Lowercase on purpose: `findByEmail` lowercases its lookup, and the CI
  // database (utf8mb4_0900_ai_ci) would mask an uppercase fixture with
  // case-insensitive matching while the dev database (TiDB, utf8mb4_bin) would
  // not find it at all.
  const email = `v10-${ts}@example.test`;
  const PW = 'CorrectHorse9Battery';
  const state = { userId: null };

  before(async () => {
    if (!dbAvailable || !pool) return;
    const bcrypt = (await import('bcryptjs')).default;
    const hash = await bcrypt.hash(PW, 4); // cheap: this fixture is never a real login
    const [res] = await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
       VALUES ('V10', 'Lockout', ?, ?, 'customer', 1, 1)`,
      [email, hash]
    );
    state.userId = res.insertId;
  });

  after(async () => {
    if (!dbAvailable || !pool || !state.userId) return;
    try {
      await pool.execute('DELETE FROM users WHERE id = ?', [state.userId]);
    } finally {
      await pool.end();
    }
  });

  const readState = async () => {
    const [[row]] = await pool.execute(
      'SELECT failed_login_attempts AS attempts, locked_until AS lockedUntil, last_failed_at AS lastFailedAt FROM users WHERE id = ?',
      [state.userId]
    );
    return {
      attempts: Number(row.attempts || 0),
      lockedUntil: row.lockedUntil ? new Date(row.lockedUntil) : null,
      lastFailedAt: row.lastFailedAt ? new Date(row.lastFailedAt) : null,
    };
  };

  const seed = async ({ attempts, lastFailedAtSql, lockedUntilSql }) => {
    await pool.execute(
      `UPDATE users SET failed_login_attempts = ?, last_failed_at = ${lastFailedAtSql}, locked_until = ${lockedUntilSql} WHERE id = ?`,
      [attempts, state.userId]
    );
  };

  test('10 failures inside one window lock the account, and the lock is enforced', { skip: !dbAvailable }, async () => {
    const { default: User } = await import('../models/usersModel.js');

    for (let i = 1; i <= 9; i++) {
      assert.equal(await User.authenticate(email, `wrong-${i}`), null, `attempt ${i} must fail`);
      const s = await readState();
      assert.equal(s.attempts, i, `counter must read ${i} after attempt ${i} (no decay inside the window)`);
      assert.equal(s.lockedUntil, null, 'the lock must not fire before the threshold');
    }

    assert.equal(await User.authenticate(email, 'wrong-10'), null, 'attempt 10 must fail');
    const s = await readState();
    assert.equal(s.attempts, 10, 'counter must reach the threshold');
    assert.ok(s.lockedUntil, 'reaching the threshold inside one window must set locked_until');

    // While locked the model must not even compare passwords — and must answer
    // identically for the right password (RB-07: no lockout oracle).
    assert.equal(
      await User.authenticate(email, PW),
      null,
      'a locked account must refuse even the correct password'
    );
  });

  test('a quiet period decays the counter to 1 and does NOT re-lock', { skip: !dbAvailable }, async () => {
    const { default: User } = await import('../models/usersModel.js');

    // 10 failures that stopped 20 minutes ago (window = 15m): the run is over.
    await seed({
      attempts: 10,
      lastFailedAtSql: 'DATE_SUB(NOW(), INTERVAL 20 MINUTE)',
      lockedUntilSql: 'NULL',
    });

    assert.equal(await User.authenticate(email, 'wrong-after-quiet'), null);

    const s = await readState();
    assert.equal(s.attempts, 1, 'a stale failure must START a new run at 1, not continue at 11');
    assert.equal(s.lockedUntil, null, 'one request after the window must never re-arm the lock');
  });

  test('after the lock expires, ONE attempt does not re-lock the account', { skip: !dbAvailable }, async () => {
    const { default: User } = await import('../models/usersModel.js');

    // Locked 59 minutes ago (lock = 60m, so it has just expired) with the old
    // 10-attempt run still on the row. This is the V-10 proof: before the fix
    // the stale counter was already >= threshold, so the very first attempt
    // after expiry re-locked the account — permanently, for an attacker who
    // sent nothing but one request per hour.
    await seed({
      attempts: 10,
      lastFailedAtSql: 'DATE_SUB(NOW(), INTERVAL 59 MINUTE)',
      lockedUntilSql: 'DATE_SUB(NOW(), INTERVAL 1 MINUTE)',
    });

    assert.equal(await User.authenticate(email, 'wrong-after-expiry'), null);

    let s = await readState();
    assert.equal(s.attempts, 1, 'the expired run must not be continued');
    // The expired `locked_until` row may still carry its old (past) value —
    // nothing clears it until the next successful login. What matters is that
    // the single request did not push it INTO the future: a lock in the future
    // means the stale counter re-armed the account, which is exactly the V-10
    // bug (one request per hour would hold the account locked permanently).
    assert.ok(
      !s.lockedUntil || s.lockedUntil.getTime() <= Date.now(),
      `one request after expiry must not re-arm the lock, got locked_until=${s.lockedUntil?.toISOString()}`
    );

    // ...and the owner can now get back in with the correct password.
    const user = await User.authenticate(email, PW);
    assert.ok(user, 'the correct password must work once the old lock has expired');
    s = await readState();
    assert.equal(s.attempts, 0, 'success must clear the counter');
    assert.equal(s.lockedUntil, null, 'success must clear the lock');
    assert.equal(s.lastFailedAt, null, 'success must clear the window marker');
  });

  test('a successful login clears counter, lock and window marker', { skip: !dbAvailable }, async () => {
    const { default: User } = await import('../models/usersModel.js');

    await seed({
      attempts: 5,
      lastFailedAtSql: 'NOW()',
      lockedUntilSql: 'NULL',
    });

    const user = await User.authenticate(email, PW);
    assert.ok(user, 'a non-locked account with a stale counter must still accept the right password');

    const s = await readState();
    assert.equal(s.attempts, 0);
    assert.equal(s.lockedUntil, null);
    assert.equal(s.lastFailedAt, null, 'the window marker must go too, or the next failure inherits an old timestamp');
  });
});
