// FILE LOCATION: backend/tests/paystackReferenceGuard.test.js
// DESCRIPTION: V-09 (functional) — a crafted payment reference must never
//              produce an outbound HTTP call to Paystack.
//
// Why this exists: V-09 was closed with a source assertion
// (redteam-final.test.js:530) that reads the character class out of three
// files and checks the payload samples fail the regex. That is a statement
// about a pattern in a file, not about the handler. This suite drives
// POST /api/payments/verify-paystack over a real socket with the guard
// sitting where it sits in production (behind `protect`), spies on axios,
// and makes one assertion that no source grep can make: the provider was
// not contacted AT ALL.
//
// The discriminator is the call log, not the status code. Every rejection
// is a 400, and so are several ordinary outcomes (no order found, amount
// mismatch, Paystack says no), so a 400 proves the request was refused and
// nothing else. An attacker who gets a 400 *after* the outbound call has
// still forced the server to spend a secret-bearing request on a URL they
// chose — which is the finding. Hence: status AND `calls.length === 0`.
//
// The control matters for the same reason: a blanket `return 400` would
// pass every malicious case here while breaking payments. It asserts a
// legitimate reference does reach Paystack, once, at the exact expected URL.
//
// What the original fix did NOT cover, found by writing `..` below: the
// character class permits dots, `..` is a legal reference by that rule, and
// WHATWG URL normalization rewrites
//   https://api.paystack.co/transaction/verify/..
// to
//   https://api.paystack.co/transaction/
// — so a one-segment reference still moved the path off the verify prefix.
// Same host, no query string reachable (the class forbids `?` and `/`), so
// it could not read another merchant's data or leak the key elsewhere; but
// it meant the claim "path injection is prevented" was not actually true.
// Both wide-class sites now assert the URL they build is the URL they meant.
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.EMAIL_DISABLED = '1';
// Importing the router imports the rate limiters, and with a REDIS_URL set
// `getRedisClient()` CONNECTS during module evaluation. An open node-redis
// socket keeps the event loop alive, so `node --test` prints every result and
// then hangs — no `# tests` summary, exit 124, and the run looks like a crash
// rather than a leak. backend/.env sets a real Upstash URL, so this is the
// normal case, not a hypothetical one. An empty string rather than `delete`:
// rateLimitMiddleware re-runs dotenv.config() at import, and only a key that
// still EXISTS is left alone. Same guard as otpResend and redteam-final.
process.env.REDIS_URL = '';
// `protect` verifies against whatever this is set to; minting the cookie
// with the same value is the whole point of setting it here first.
process.env.JWT_SECRET ||= 'v09-functional-secret-for-tests-only-not-a-key';

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
const REFERENCE = `V09REF-${ts}`;
const state = { userId: null, token: null };
let server = null;
let calls = [];
let stubResponse = { data: { status: false, data: null } };

// The attack catalogue. Each entry is a reference that must not reach the
// wire, with the reason it is dangerous. The first two are the interesting
// ones: `../../balance` is the payload the original report used (a slash the
// class now blocks), and `..` is the residue that same class still accepted.
const ATTACKS = [
  ['../../balance', 'the payload from the original V-09 report'],
  ['..', 'bare traversal segment — dots are inside the character class'],
  ['.', 'bare current-segment reference'],
  ['../transaction', 'traversal followed by a second segment'],
  ['foo/bar', 'a literal slash, which would become a path segment'],
  ['x%2Fy', 'a pre-encoded slash that must not be decoded into one'],
  ['a?b=1', 'query string, which would rewrite the request'],
  ['a#frag', 'fragment, which would truncate the path'],
  ['a b', 'whitespace, which encodes to %20'],
  ['ref;rm -rf', 'shell metacharacter'],
  ['a'.repeat(101), 'one character over the allowed length'],
];

describe('V-09: a crafted reference never leaves the building', { skip: !dbAvailable }, () => {
  before(async () => {
    if (!dbAvailable || !pool) return;

    const User = (await import('../models/usersModel.js')).default;
    const user = await User.create({
      firstName: 'V09', lastName: 'buyer', email: `v09-buyer-${ts}@example.com`,
      password: 'Test1234x', role: 'customer', legalConsentAccepted: true,
    });
    state.userId = user.id;

    // `protect` reads ONLY `req.cookies.jwt` — no Authorization header path —
    // so the cookie is what the browser-shaped request must carry.
    const { signUserToken } = await import('../utils/generateToken.js');
    state.token = signUserToken(user);

    const express = (await import('express')).default;
    const cookieParser = (await import('cookie-parser')).default;
    const paymentRoutes = (await import('../routes/paymentRoutes.js')).default;
    const { startServer } = await import('./helpers/httpHarness.js');

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/payments', paymentRoutes);
    // `asyncHandler` forwards middleware failures here; without it Express
    // answers in HTML and the JSON assertions below would fail for the wrong
    // reason. `protect` sets res.status(401) before throwing.
    // Express recognises an error handler by its 4-arg arity, so `next` stays
    // in the signature even though this response is terminal.
    app.use((err, req, res, next) => {
      const status = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
      res.status(status).json({ message: err.message });
    });
    server = await startServer(app);

    // The spy is the assertion surface: `calls` is the entire evidence of
    // whether an outbound request happened. Stubbing also guarantees no real
    // Paystack traffic ever leaves the machine, even for the control.
    const { default: axios } = await import('axios');
    calls = [];
    mock.method(axios, 'get', async (url) => {
      calls.push(String(url));
      return stubResponse;
    });
  });

  after(async () => {
    mock.restoreAll();
    if (server) await server.close();
    // The user is deliberately NOT deleted here: the suite below creates
    // orders that reference it, and it runs after this one. Fixture lifetime
    // spans the file, so teardown spans the file too.
  });

  const post = async (body) => {
    const res = await fetch(`${server.baseUrl}/api/payments/verify-paystack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `jwt=${state.token}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* a non-JSON failure must not mask the status */ }
    return { status: res.status, text, json };
  };

  for (const [payload, why] of ATTACKS) {
    test(`refuses ${JSON.stringify(payload)} — ${why}`, async () => {
      calls = [];
      const r = await post({ reference: payload });
      assert.equal(r.status, 400, `expected a refusal, got ${r.status}: ${r.text.slice(0, 200)}`);
      assert.equal(calls.length, 0,
        `the provider was contacted at ${JSON.stringify(calls)} for ${why} — this is the finding`);
      // A refusal must not echo anything secret-shaped back at the caller.
      assert.ok(!/sk_(live|test)_/i.test(r.text), 'response body leaked a secret key');
    });
  }

  test('refuses a missing reference without calling out', async () => {
    calls = [];
    const r = await post({});
    assert.equal(r.status, 400, `expected 400, got ${r.status}`);
    assert.equal(calls.length, 0, 'a missing reference still produced an outbound call');
  });

  test('refuses a reference that is not a string', async () => {
    calls = [];
    const r = await post({ reference: { $ne: null } });
    assert.equal(r.status, 400, `expected 400, got ${r.status}: ${r.text.slice(0, 200)}`);
    assert.equal(calls.length, 0, 'an object reference still produced an outbound call');
  });

  test('control: a legitimate reference reaches Paystack exactly once, at the exact URL', async () => {
    calls = [];
    // No order carries this reference, so the handler looks it up, finds
    // nothing, and answers success without touching money — a full round trip
    // with no side effects beyond the outbound call being asserted.
    stubResponse = {
      data: {
        status: true,
        data: {
          status: 'success', reference: REFERENCE,
          amount: 10000, currency: 'GHS', channel: 'card',
          paid_at: new Date().toISOString(), customer: { email: 'buyer@example.com' },
        },
      },
    };
    try {
      const r = await post({ reference: REFERENCE });
      assert.equal(r.status, 200, `expected the normal flow to complete, got ${r.status}: ${r.text.slice(0, 300)}`);
      assert.deepEqual(calls, [`https://api.paystack.co/transaction/verify/${REFERENCE}`],
        'the guard must pass a legitimate reference through untouched');
      assert.equal(r.json?.data?.orderMarkedPaid, false, 'no order carries this reference');
    } finally {
      stubResponse = { data: { status: false, data: null } };
    }
  });
});

// ---------------------------------------------------------------------------
// V-09b: the same guard, on the path nobody watches.
//
// `recoverStuckPendingOrders` runs every 30 minutes with no operator present
// and asks Paystack about any order still `pending` an hour after checkout.
// It carried the same wide character class as the route, so it carried the
// same `..` residue — and here the stakes differ: not a request an attacker
// watches return 400, but a response an unattended job TRUSTS. The stub
// answers in NGN on purpose. The currency check then fails for every order
// in the database, so the control can prove the outbound call happened at
// the right URL without flipping anybody's order to paid as a side effect of
// a test — including another suite's fixture, since this SELECT has no
// WHERE clause narrowing it to the rows this file created.
// ---------------------------------------------------------------------------
describe('V-09b: the unattended recovery job applies the same guard', { skip: !dbAvailable }, () => {
  const fixture = { evil: null, slash: null, legit: null };
  const LEGIT_REF = `V09STUCK-${ts}`;
  let recoveryCalls = [];
  let recoveryStub = { data: { data: { status: 'success', currency: 'NGN', amount: 1 } } };

  before(async () => {
    if (!dbAvailable || !pool) return;
    // `items: []` keeps every post-recovery side effect (escrow hold, stock
    // decrement) structurally impossible even if a stub is ever changed to
    // answer in GHS — the flip-guard is one assertion away from a real order
    // being mutated, and this fixture belongs to nobody else.
    const mk = async (tag, reference) => {
      const [r] = await pool.execute(
        `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
          paymentMethod, paymentStatus, orderStatus, paymentReference, created_at)
         VALUES (?, ?, '[]', 300, '{}', '{}', 'paystack', 'pending', 'pending', ?,
                 DATE_SUB(NOW(), INTERVAL 2 HOUR))`,
        [state.userId, `V09FIX-${ts}-${tag}`, reference]
      );
      return r.insertId;
    };
    fixture.evil = await mk('EVIL', '..');
    // The slash payload is here so the character-class layer gets exercised
    // too, not just canonicalization: with the regex removed,
    // `../../balance` becomes `..%2F..%2Fbalance`, whose encoded slashes do
    // NOT normalize — so the URL shape check passes and only the regex is
    // left to refuse it. That layer is load-bearing, and a test feeding this
    // job only `..` would never notice if it disappeared.
    fixture.slash = await mk('SLASH', '../../balance');
    fixture.legit = await mk('LEGIT', LEGIT_REF);

    const { default: axios } = await import('axios');
    recoveryCalls = [];
    mock.method(axios, 'get', async (url) => {
      recoveryCalls.push(String(url));
      return recoveryStub;
    });
  });

  after(async () => {
    mock.restoreAll();
    if (!dbAvailable || !pool) return;
    for (const id of [fixture.evil, fixture.slash, fixture.legit].filter(Boolean)) {
      try {
        await pool.execute('DELETE FROM financial_events WHERE orderId = ?', [id]);
        await pool.execute('DELETE FROM escrow_allocations WHERE orderId = ?', [id]);
        await pool.execute('DELETE FROM orders WHERE id = ?', [id]);
      } catch (err) {
        console.error(`paystackReferenceGuard recovery cleanup FAILED: ${err.message}`);
      }
    }
  });

  test('skips a `..` reference without contacting the provider', async () => {
    recoveryCalls = [];
    const { recoverStuckPendingOrders } = await import('../Services/escrowService.js');
    await recoverStuckPendingOrders();

    // Three fingerprints, because they appear depending on WHERE the guard was
    // removed: the raw template yields `.../verify/..` or
    // `.../verify/..%2F..%2Fbalance`, while a build that canonicalizes but no
    // longer rejects yields the normalized `.../transaction/`. Either layer
    // gone, some fingerprint shows up.
    const evil = recoveryCalls.filter((u) =>
      u.endsWith('/verify/..') || u.includes('..%2F') || u.endsWith('/transaction/') || u.endsWith('/transaction'));
    assert.deepEqual(evil, [],
      `the recovery job queried Paystack for a traversal reference: ${JSON.stringify(evil)}`);

    const [[row]] = await pool.execute(`SELECT paymentStatus FROM orders WHERE id = ?`, [fixture.evil]);
    assert.equal(row.paymentStatus, 'pending', 'the order must not have been touched');
  });

  test('control: a legitimate stuck reference IS queried, at the exact URL', async () => {
    recoveryCalls = [];
    const { recoverStuckPendingOrders } = await import('../Services/escrowService.js');
    await recoverStuckPendingOrders();

    const mine = recoveryCalls.filter((u) => u.endsWith(`/verify/${LEGIT_REF}`));
    assert.equal(mine.length, 1,
      `expected exactly one query for this fixture, got ${mine.length}: ${JSON.stringify(mine)}`);
    const [[row]] = await pool.execute(`SELECT paymentStatus FROM orders WHERE id = ?`, [fixture.legit]);
    assert.equal(row.paymentStatus, 'pending',
      'the NGN stub must not flip an order — this control asserts the outbound call, not a recovery');
  });
});

// Release everything this file acquired so the runner's process can exit.
// The pool must outlive BOTH describes above (each has its own fixtures), so
// it is closed once, here, rather than inside the first suite's after().
after(async () => {
  if (pool && state.userId) {
    try {
      await pool.execute('DELETE FROM users WHERE id = ?', [state.userId]);
    } catch (err) {
      console.error(`paystackReferenceGuard user cleanup FAILED: ${err.message}`);
    }
  }
  if (pool) {
    try { await pool.end(); } catch { /* already closed */ }
  }
  // Belt and braces for the REDIS_URL guard at the top: if any import in this
  // file's chain ever starts the client before that line takes effect, closing
  // it here is the difference between a green run and a run that hangs after
  // printing every result — no `# tests` summary, exit 124, and a failure that
  // reads like a crash instead of a leak.
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

// ---------------------------------------------------------------------------
// The pure guard shapes, checked without a database so this file still
// contributes coverage on the CI no-DB path (where the suite above skips).
// `..` passing the wide class is why the handler now canonicalizes the URL it
// builds instead of trusting the pattern to have covered it.
// ---------------------------------------------------------------------------
test('V-09: the wide reference class admits `..`, which normalizes off the verify prefix', () => {
  const wide = /^[A-Za-z0-9._-]{1,100}$/;
  assert.ok(wide.test('..'), 'precondition: the character class does allow `..`');

  const built = new URL('https://api.paystack.co/transaction/verify/' + encodeURIComponent('..'));
  assert.notEqual(built.pathname, '/transaction/verify/..',
    'URL normalization moved the path — a pattern over the input cannot see this, only the URL can');
  assert.ok(built.pathname === '/transaction/' || !built.pathname.startsWith('/transaction/verify/'),
    `traversal escaped the prefix: ${built.pathname}`);

  // What the handler now asserts, and why a legitimate reference survives it.
  const canonical = (reference) => {
    const url = new URL('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference));
    return url.origin === 'https://api.paystack.co'
      && url.pathname === '/transaction/verify/' + encodeURIComponent(reference);
  };
  assert.equal(canonical('..'), false, 'a traversal reference must fail canonicalization');
  assert.equal(canonical('.'), false, 'a dot reference must fail canonicalization');
  for (const legit of ['ORDER_1712345678_ab12cd', 'ref_abc-ABC.123', 'V09REF-1234']) {
    assert.equal(canonical(legit), true, `canonicalization rejected a legitimate reference: ${legit}`);
  }
});
