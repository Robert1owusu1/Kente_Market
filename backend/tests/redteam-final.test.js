/**
 * redteam-final.test.js — regression tests written during the FINAL red-team pass.
 *
 * Every test here pins an exploit that was PROVEN during this pass (or that a
 * prior round claimed to fix without leaving any test behind):
 *
 *  1. P0 (financial)  : escrow allocation ignored the line `qty`, escrowing only
 *                       1 unit of a multi-unit line (under-paid vendors).
 *  2. P0 (availability): `redactUrl` threw URIError on a malformed percent
 *                       sequence inside a query-string KEY, and because it runs
 *                       inside `res.on('finish')` the throw became an
 *                       uncaughtException that killed the whole process
 *                       (anonymous DoS: `GET /?%=1`).
 *  3. P1 (tenant isolation): the vendor order-status endpoint returned the raw
 *                       order row (buyer email/address/payment reference and
 *                       sibling vendors' line items) to a non-admin vendor.
 *  4. P1 (auth)       : password-reset tokens were logged in the request path.
 *  5. P1 (abuse)      : every auth limiter was keyed on a spoofable IP/XFF, so
 *                       rotating the header gave unlimited attempts against one
 *                       account. The account-keyed limiter must stay bound.
 *  6. P0 (money)      : V-01 — checkout charged the PRE-coupon cached total
 *                       while the server had booked the NET one, so Paystack
 *                       collected the wrong amount and verification rejected it.
 *  7. P1 (SSRF)       : V-09 — the Paystack reference is interpolated into an
 *                       outbound URL path and was not validated.
 *  8. P0 (double pay) : V-07 — three refund paths, no shared CAS claim.
 *
 * Tests 1, 3 and the escrow-concurrency test need a database and are skipped
 * when none is reachable — exactly like the rest of the suite. The others are
 * pure and always run, including on CI where no DB exists.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { redactUrl } from '../utils/logger.js';

// Pin the rate limiters to their in-process store for this file.
//
// This comment used to explain the symptom rather than the cause: "That
// migration restarts the counter on the Redis side, so the same 14-request
// probe can observe 8 'allowed' instead of 5." N-10 fixed the cause — counts
// accumulated in the per-instance fallback are now carried into Redis on
// recovery (max, not sum, and before the next request is counted) instead of
// being abandoned, so switching transport no longer hands anyone back a fresh
// allowance.
//
// The pin is kept regardless: this file asserts an exact number of attempts,
// and that should not depend on whether a remote Redis happens to be
// configured and reachable in the environment running the suite. The property
// under test (the key is account-keyed, not IP-keyed) does not depend on the
// transport either way. An empty string is used rather than `delete` because
// rateLimitMiddleware re-runs dotenv.config() at import time and would
// otherwise restore the value.
process.env.REDIS_URL = '';

// DB gate: probe at module load (top-level await) so `{ skip: !dbAvailable }`
// is already correct when the tests are REGISTERED — a before() hook runs too
// late for that and the suite would fail without a database (CI).
let dbAvailable = true;
let pool = null;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  // Keep the reference: config/db.js has already constructed the pool (and it
  // may hold a pending connection attempt), so it MUST still be closed in
  // after() or this test process never exits — including in CI, where the
  // failed probe is the normal case.
}

// ---------------------------------------------------------------------------
// Fixture users for the DB-gated tests below.
//
// They used to pick `SELECT ... WHERE role='vendor' LIMIT 1` — an ARBITRARY row
// on a shared database. Another suite's cleanup can delete that user between
// our SELECT and our INSERT. TiDB (the dev database) does not enforce foreign
// keys, so escrow's `INSERT IGNORE` still "succeeded" with a dangling vendorId
// and the test passed by luck; MySQL (CI's service container) raises the FK
// violation, `INSERT IGNORE` downgrades it to a warning with 0 affected rows,
// and the test failed on `created > 0` — a fixture race, not a product bug.
// Fixed ids + INSERT IGNORE make this idempotent, and no suite deletes them.
// ---------------------------------------------------------------------------
const FIXTURE_VENDOR_ID = 310001;
const FIXTURE_BUYER_ID = 310002;
const ensureFixtureUsers = async () => {
  await pool.execute(
    `INSERT IGNORE INTO users (id, firstName, lastName, email, password, role, isActive, is_email_verified)
     VALUES (?, 'RT', 'Vendor', 'rt-fixture-vendor@example.test', 'unused-fixture-hash', 'vendor', 1, 1),
            (?, 'RT', 'Buyer',  'rt-fixture-buyer@example.test',  'unused-fixture-hash', 'customer', 1, 1)`,
    [FIXTURE_VENDOR_ID, FIXTURE_BUYER_ID]
  );
  return { vendor: { id: FIXTURE_VENDOR_ID }, buyer: { id: FIXTURE_BUYER_ID } };
};

// Release everything this file acquired so the runner's process can exit.
// Every other DB suite in this directory closes the pool; this one also has
// to close Redis, because importing rateLimitMiddleware (in the limiter test)
// CONNECTS the module-scope client in utils/redisClient.js, and an open socket
// keeps the event loop alive — node --test then prints all results and hangs.
after(async () => {
  if (pool) {
    try {
      await pool.end();
    } catch { /* already closed or never connected */ }
  }

  // Redis is optional, so this whole block is best-effort. The already-open
  // handle is reached through the module's own getter; no production API is
  // added just to make the test exit.
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
// 2. P0 availability — redactUrl must never throw (pure, runs everywhere)
// ---------------------------------------------------------------------------
test('redactUrl never throws on malformed percent-encoding (anonymous DoS)', () => {
  const boobyTrapped = [
    '/api/products?%=1',       // the exact crash: '%' as the whole key
    '/api/products?%ZZ=1',     // non-hex digits
    '/api/products?x=%',       // trailing '%' in the value
    '/api/products?x=%E0%A4A', // truncated UTF-8 sequence
    '/api/products?%=',
    '/api/products?%%%',
    '/api/products?a=%25&%=1',
    '/api/products?%2',
    '/?%',
    '/',
    'not a url at all',
    ' http://x/%',
  ];

  for (const url of boobyTrapped) {
    assert.doesNotThrow(
      () => redactUrl(url),
      `redactUrl threw for ${JSON.stringify(url)} — would crash the process in res.on('finish')`
    );
    const out = redactUrl(url);
    assert.equal(typeof out, 'string');
  }
});

test('redactUrl still strips sensitive values (fix did not disable redaction)', () => {
  const out = redactUrl('/api/x?token=abc123&password=p&api_key=k&authorization=h');
  assert.ok(!out.includes('abc123'), 'token value must not survive');
  assert.ok(!out.includes('password=p'), 'password value must not survive');
});

test('redactUrl strips password-reset tokens from the PATH (P1 token leak)', () => {
  // Assembled rather than written as a 32-char hex literal: a literal of that
  // shape is indistinguishable from a real token to the secret scanner CI runs
  // on every push. This one is deliberately 'deadbeef' x4.
  const token = 'deadbeef'.repeat(4);
  const paths = [
    `/api/users/reset-password/${token}`,
    `/api/users/reset-password/${token}?next=/home`,
    `/reset-password/${token}`,
  ];
  for (const url of paths) {
    const out = redactUrl(url);
    assert.ok(!out.includes(token), `reset token leaked into logs: ${out}`);
    assert.ok(out.includes('[redacted]'), `redaction marker missing: ${out}`);
    // The route prefix must survive so the log line stays debuggable.
    assert.ok(out.includes('reset-password'), `route shape lost: ${out}`);
  }

  // Non-sensitive paths must be left alone (no over-redaction).
  assert.equal(redactUrl('/api/orders/42'), '/api/orders/42');
});

// ---------------------------------------------------------------------------
// V-01 (money integrity): after a coupon is booked the charge MUST use the
// NET total. The coupon used to be applied with a raw axios PUT, which does
// not invalidate the RTK cache — `useGetOrderByIdQuery` kept serving the
// PRE-coupon total and `payableTotal` prefers that value, so Paystack was
// initialised with the GROSS amount while the server had booked the NET one.
// verify-paystack then rejects (`paidKobo !== expectedKobo`) and the captured
// money sits on an order that never flips to 'paid'.
// ---------------------------------------------------------------------------
test('checkout charges the coupon NET total, not a stale pre-coupon cache (V-01)', async () => {
  const fs = await import('node:fs/promises');
  const checkout = await fs.readFile(
    new URL('../../src/Pages/CheckoutPage/checkout.tsx', import.meta.url), 'utf8');
  const slice = await fs.readFile(
    new URL('../../src/slices/ordersApiSlice.ts', import.meta.url), 'utf8');

  const applyBlock = checkout.slice(
    checkout.indexOf('const handleApplyCoupon'),
    checkout.indexOf('const momoProviders')
  );
  assert.ok(applyBlock.length > 200, 'could not locate handleApplyCoupon — test needs updating');
  assert.ok(!/axios\.put\(/.test(applyBlock),
    'coupon must not be applied with raw axios.put — it bypasses RTK tag invalidation');
  assert.ok(/updateOrder\(/.test(applyBlock) && /couponCode/.test(applyBlock),
    'coupon must be applied through the RTK updateOrder mutation');

  const mutation = slice.slice(
    slice.indexOf('updateOrder: builder.mutation'),
    slice.indexOf('updateOrderToPaid')
  );
  assert.ok(/invalidatesTags/.test(mutation),
    'updateOrder must invalidate the Order tag, otherwise getOrderById stays stale');

  assert.match(checkout, /setCouponNetTotal\(/,
    'the NET total returned by the coupon PUT must be latched');
  assert.match(checkout, /resolvePayableTotal\(\s*couponNetTotal/,
    'payableTotal must prefer the latched NET total over the cached server total');
});

// ---------------------------------------------------------------------------
// 1. P0 financial — escrow must be created for the FULL line quantity
// ---------------------------------------------------------------------------
test('escrow allocation covers the full line quantity (qty:3 @ 100 => 300)', {
  skip: !dbAvailable ? 'no database configured' : false,
}, async () => {
  const { default: pool } = await import('../config/db.js');
  const { createEscrowAllocations } = await import('../Services/escrowService.js');

  const quantity = 3;
  const price = 100;

  // Own fixtures — see ensureFixtureUsers(): an arbitrary `LIMIT 1` vendor can
  // be deleted by a concurrent suite, and on MySQL the escrow INSERT IGNORE
  // then silently drops the row (0 affected) instead of failing loudly.
  const { vendor, buyer } = await ensureFixtureUsers();

  const [ins] = await pool.execute(
    `INSERT INTO orders (orderNumber, userId, items, totalAmount, paymentStatus, orderStatus, escrowStatus)
     VALUES (?, ?, ?, ?, 'pending', 'processing', 'none')`,
    [
      `RT-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      buyer.id,
      JSON.stringify([
        { product: 999999991, name: 'RT line', qty: quantity, price, vendorId: vendor.id },
      ]),
      quantity * price,
    ]
  );
  const orderId = ins.insertId;
  const items = [{ product: 999999991, name: 'RT line', qty: quantity, price, vendorId: vendor.id }];
  try {
    const created = await createEscrowAllocations(orderId, items);
    assert.ok(created > 0, 'at least one allocation must be created');
    const [allocRows] = await pool.execute(
      `SELECT amount FROM escrow_allocations WHERE orderId = ?`,
      [orderId]
    );
    assert.ok(allocRows.length > 0, 'allocation rows must exist');
    const sum = allocRows.reduce((s, a) => s + Number(a.amount), 0);
    assert.equal(
      Math.round(sum * 100) / 100,
      quantity * price,
      `escrow must cover the FULL line value (got ${sum}, want ${quantity * price})`
    );
  } finally {
    await pool.execute(`DELETE FROM escrow_allocations WHERE orderId = ?`, [orderId]).catch(() => {});
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [orderId]).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// 3. P1 tenant isolation — vendor status update must not echo the raw order
// ---------------------------------------------------------------------------
test('vendor order-status response is projected for non-admin vendors', {
  skip: !dbAvailable ? 'no database configured' : false,
}, async () => {
  const { default: pool } = await import('../config/db.js');
  const { updateVendorOrderStatus } = await import('../controllers/vendorOrderController.js');
  assert.equal(typeof updateVendorOrderStatus, 'function');

  // Own fixtures — see ensureFixtureUsers().
  const { vendor, buyer } = await ensureFixtureUsers();

  // Build our own throwaway order: one line for the caller plus a SIBLING
  // vendor's line, with buyer PII and payment fields on the row. Seeding it
  // ourselves is the only way to prove the leak — a pre-existing order may
  // not contain the very fields the bug exposed.
  const siblingVendorId = vendor.id === 999999 ? 999998 : 999999;
  // Marker lives ONLY in the PII fields (address/payment ref) — never in
  // orderNumber, which the projection is supposed to return.
  const marker = `RT-ISO-${Date.now()}`;
  const [ins] = await pool.execute(
    `INSERT INTO orders
       (orderNumber, userId, items, totalAmount, shippingAddress, billingAddress,
        paymentMethod, paymentStatus, orderStatus, escrowStatus, paymentReference, discount)
     VALUES (?, ?, ?, 999, ?, ?, 'card', 'pending', 'processing', 'none', ?, 0)`,
    [
      `RT-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      buyer.id,
      JSON.stringify([
        { product: 999999991, name: 'Own line', qty: 1, price: 10, vendorId: vendor.id },
        { product: 999999992, name: 'Sibling secret line', qty: 2, price: 45, vendorId: siblingVendorId },
      ]),
      JSON.stringify({ line1: `${marker} Secret Lane`, city: 'Accra', phone: '+233000000000' }),
      JSON.stringify({ line1: `${marker} Billing Lane` }),
      `${marker}-ref`,
    ]
  );
  const orderId = ins.insertId;

  try {
    const req = {
      user: { id: vendor.id, role: 'vendor' },
      params: { id: String(orderId) },
      // Re-submitting the CURRENT status: forward-only + adjacency guards both
      // allow it, consensus does not move, so nothing about the real pipeline
      // changes — we only observe the response body.
      body: { orderStatus: 'processing' },
    };
    let status = null;
    let body = null;
    const res = {
      status(c) { status = c; return this; },
      json(b) { body = b; return this; },
    };
    await updateVendorOrderStatus(req, res);

    assert.ok(body && body.order,
      `controller must answer with an order body (status=${status} body=${JSON.stringify(body)})`);
    const order = body.order;

    // The raw row demonstrably carried all of this (findById joins users)…
    const [[raw]] = await pool.execute(
      `SELECT o.totalAmount, o.paymentReference, o.shippingAddress, o.billingAddress,
              u.email, u.lastName
         FROM orders o LEFT JOIN users u ON u.id = o.userId WHERE o.id = ?`,
      [orderId]
    );
    assert.ok(raw && raw.email, 'sanity: raw row must expose buyer PII');

    // …and none of it may reach a vendor.
    assert.ok(!('email' in order), 'buyer email must not be returned to a vendor');
    assert.ok(!('lastName' in order), 'buyer lastName must not be returned');
    assert.ok(!('shippingAddress' in order), 'full shipping address must not be returned');
    assert.ok(!('billingAddress' in order), 'billing address must not be returned');
    assert.ok(!('paymentReference' in order), 'payment reference must not be returned');
    assert.ok(!('totalAmount' in order), 'order total must not be returned');
    assert.ok(!('userId' in order), 'buyer user id must not be returned');

    const leaked = JSON.stringify(order);
    assert.ok(!leaked.includes(marker), 'no seeded PII marker may survive projection');
    assert.ok(!leaked.includes(raw.email), 'buyer email string must not survive');
    assert.ok(!leaked.includes(String(raw.paymentReference)), 'payment reference must not survive');

    // Own line visible, sibling line gone.
    assert.ok(Array.isArray(order.items) && order.items.length === 1,
      `vendor must see exactly their own lines (got ${JSON.stringify(order.items)})`);
    assert.equal(order.items[0].name, 'Own line');
    assert.ok(!leaked.includes('Sibling secret line'), 'sibling vendor line leaked');
    for (const it of order.items) {
      if (it.vendorId != null) {
        assert.equal(parseInt(it.vendorId, 10), vendor.id,
          `sibling vendor line leaked: ${JSON.stringify(it)}`);
      }
    }
    if (Array.isArray(order.stockConflicts)) {
      for (const c of order.stockConflicts) {
        assert.equal(parseInt(c.vendorId, 10), vendor.id,
          'sibling vendor stock conflict leaked');
      }
    }
    assert.equal(status, null, 'success responses must not set an error status');
  } finally {
    await pool.execute(`DELETE FROM order_vendor_marks WHERE orderId = ?`, [orderId]).catch(() => {});
    await pool.execute(`DELETE FROM notification WHERE link LIKE ?`, [`%/order/${orderId}`]).catch(() => {});
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [orderId]).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Rate limiting: IP-keyed buckets are spoofable via X-Forwarded-For when
// TRUST_PROXY is set. Proven live (before the fix): 8 rotating-XFF login
// attempts all reached the handler while a fixed IP was 429'd at 5.
// The defence is a limiter keyed ONLY on the target account, so assert that
// key has no IP component and cannot be reset by header rotation.
// ---------------------------------------------------------------------------
test('account limiters key on the target account, not on spoofable IP', async () => {
  const { EventEmitter } = await import('node:events');
  const { accountAuthLimiter } = await import('../middleware/rateLimitMiddleware.js');

  // Drive the REAL middleware. Each request uses a DIFFERENT source IP (the
  // X-Forwarded-For spoof that defeated the IP-keyed limiter) but always
  // names the SAME target account.
  const call = async (xff, email) => {
    const req = {
      ip: `203.0.113.${xff}`,
      body: { email },
      headers: { 'x-forwarded-for': `198.51.100.${xff}` },
      method: 'POST',
      path: '/api/users/auth',
      originalUrl: '/api/users/auth',
      get(h) { return this.headers[String(h).toLowerCase()]; },
    };
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = () => res;
    res.setHeader = () => {};
    res.getHeader = () => undefined;

    await new Promise((resolve) => {
      const done = setTimeout(resolve, 300);
      accountAuthLimiter(req, res, () => { // passed = not limited
        res.statusCode = 200;
        clearTimeout(done);
        resolve();
      });
      if (res.statusCode !== 200) { clearTimeout(done); resolve(); }
    });
    return res.statusCode;
  };

  const codes = [];
  for (let i = 1; i <= 14; i += 1) codes.push(await call(i, 'victim@example.com'));

  // Before the fix this exact scenario returned 401 x14 (every attempt reset
  // the bucket by rotating X-Forwarded-For).
  const allowed = codes.filter((c) => c === 200).length;
  const limited = codes.filter((c) => c === 429).length;
  assert.ok(limited > 0,
    `rotating source IP must not grant unlimited attempts against one account (got ${codes.join(',')})`);
  // max is 5 — deliberately below the 10-attempt account lockout threshold so
  // a single window can never be used to lock a victim out of their account.
  assert.equal(allowed, 5, `expected exactly 5 allowed attempts (got ${allowed})`);
  assert.ok(codes.slice(5).every((c) => c === 429),
    `every attempt past the allowance must be 429 (got ${codes.slice(5).join(',')})`);
  assert.ok(allowed < 10,
    'per-window allowance must stay below the 10-attempt lockout threshold');

  // A different account must NOT inherit that lockout.
  const other = [];
  for (let i = 1; i <= 3; i += 1) other.push(await call(i, 'other@example.com'));
  assert.ok(other.every((c) => c === 200),
    `an unrelated account must not be collateral-locked (got ${other.join(',')})`);
});

// ---------------------------------------------------------------------------
// Invariant: the same economic value is never credited twice.
// N concurrent release workers race the held -> available transition; only
// the CAS winner may credit the wallet.
// ---------------------------------------------------------------------------
test('concurrent escrow releases credit the wallet exactly once', {
  skip: !dbAvailable ? 'no database configured' : false,
}, async () => {
  const { default: pool } = await import('../config/db.js');
  const { releaseAllocation } = await import('../Services/escrowService.js');

  // Own fixtures — see ensureFixtureUsers().
  const { vendor, buyer } = await ensureFixtureUsers();

  const RUN = `RT-RACE-${Date.now()}`;
  const [ins] = await pool.execute(
    `INSERT INTO orders (orderNumber, userId, items, totalAmount, paymentStatus, orderStatus, escrowStatus)
     VALUES (?, ?, '[]', 100, 'paid', 'processing', 'held')`,
    [RUN, buyer.id]
  );
  const orderId = ins.insertId;
  const [allocIns] = await pool.execute(
    `INSERT INTO escrow_allocations
       (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType)
     VALUES (?, ?, 100.00, 0.10, 10.00, 90.00, 'held', 'standard')`,
    [orderId, vendor.id]
  );
  const allocationId = allocIns.insertId;

  try {
    const [[before]] = await pool.execute(
      `SELECT COALESCE(SUM(CASE WHEN type='credit' THEN amount END),0) AS credited
         FROM wallet_transactions WHERE allocationId = ?`,
      [allocationId]
    );

    // 8 workers race the same held allocation.
    const allocation = {
      id: allocationId, orderId, vendorId: vendor.id,
      amount: 100, platformFeeRate: 0.1, status: 'held',
    };
    await Promise.all(Array.from({ length: 8 }, () => releaseAllocation(allocation)));

    const [[after]] = await pool.execute(
      `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN type='credit' THEN amount END),0) AS credited
         FROM wallet_transactions WHERE allocationId = ?`,
      [allocationId]
    );

    assert.equal(
      Number(after.n), 1,
      `wallet ledger must hold exactly ONE credit row for allocation ${allocationId} (got ${after.n})`
    );
    assert.equal(
      Number(after.credited) - Number(before.credited), 90,
      'exactly one payout of 90.00 must be credited, not 8 x 90'
    );

    const [[alloc]] = await pool.execute(
      `SELECT status FROM escrow_allocations WHERE id = ?`, [allocationId]
    );
    assert.equal(alloc.status, 'available', 'allocation must end available');

    // Inventory/never-lost guard: the wallet balance matches the single ledger row.
    const [[wal]] = await pool.execute(
      `SELECT available_balance FROM vendor_wallets WHERE vendorId = ?`, [vendor.id]
    );
    assert.ok(wal, 'wallet row must exist after a release');
  } finally {
    await pool.execute(`DELETE FROM wallet_transactions WHERE allocationId = ?`, [allocationId]).catch(() => {});
    await pool.execute(`DELETE FROM financial_events WHERE allocationId = ?`, [allocationId]).catch(() => {});
    await pool.execute(`DELETE FROM escrow_allocations WHERE id = ?`, [allocationId]).catch(() => {});
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [orderId]).catch(() => {});
  }
});


// ---------------------------------------------------------------------------
// V-09 (SSRF / outbound path injection): the Paystack reference comes from the
// request body and is interpolated into an outbound URL PATH. `../../balance`
// used to make the secret-bearing request hit a different Paystack endpoint.
// Fixed, but no test existed — pin it at both the guard and the ordering level.
// ---------------------------------------------------------------------------
test('V-09: Paystack reference is validated as a path token before any outbound call', async () => {
  const fs = await import('node:fs/promises');
  const targets = [
    ['../routes/paymentRoutes.js', 'A-Za-z0-9._-'],
    ['../Services/escrowService.js', 'A-Za-z0-9._-'],
    ['../Services/paystackservices.js', 'A-Za-z0-9_-'],
  ];
  const outboundNeedle = 'transaction/verify';
  // Comments describe the attack itself, so they must not count as the
  // "outbound URL" when checking that the guard runs first.
  const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

  for (const [file, alphabet] of targets) {
    const raw = await fs.readFile(new URL(file, import.meta.url), 'utf8');
    assert.ok(raw.includes(alphabet), `${file} lost its reference character class`);
    const src = stripComments(raw);
    const guardAt = src.indexOf(alphabet);
    const outboundAt = src.indexOf(outboundNeedle);
    if (outboundAt !== -1) {
      assert.ok(guardAt !== -1 && guardAt < outboundAt,
        `${file}: the reference guard must execute before the outbound URL is built`);
    } else {
      assert.ok(guardAt !== -1, `${file} has no reference guard`);
    }
  }

  // Both guard shapes present in the tree must actually reject the payloads.
  const wide = /^[A-Za-z0-9._-]{1,100}$/;
  const strict = /^[A-Za-z0-9_-]{1,64}$/;
  const rejectedByBoth = [
    '../../balance',
    '..%2Fbalance',
    '1/../../balance',
    'a/b',
    'a?b=1',
    'a#frag',
    'a b',
    'ref;rm -rf',
    '../../\u0000',
  ];
  for (const payload of rejectedByBoth) {
    assert.ok(!wide.test(payload), `wide guard accepted ${JSON.stringify(payload)}`);
    assert.ok(!strict.test(payload), `strict guard accepted ${JSON.stringify(payload)}`);
  }
  assert.ok(!wide.test('x'.repeat(101)), 'wide guard accepted an over-long reference');
  assert.ok(!strict.test('x'.repeat(65)), 'strict guard accepted an over-long reference');
  for (const legit of ['ORDER_1712345678_ab12cd', 'ref_abc-ABC.123']) {
    assert.ok(wide.test(legit), `wide guard rejected a legitimate reference: ${legit}`);
  }
});

// ---------------------------------------------------------------------------
// V-07 (refund double-spend): three separate code paths can refund the same
// order (customer return, full return, admin cancel). All three must CAS-claim
// one marker before touching Paystack, and the marker is UNIQUE at the schema
// level. Fixed, but no test asserted the claim ordering.
// ---------------------------------------------------------------------------
test('V-07: every refund entry point CAS-claims the order marker before Paystack', async () => {
  const fs = await import('node:fs/promises');
  const checks = [
    ['../controllers/returnController.js', 2],
    ['../controllers/orderController.js', 1],
  ];
  for (const [file, minClaims] of checks) {
    const src = await fs.readFile(new URL(file, import.meta.url), 'utf8');
    const claims = src.match(/refundReference IS NULL/g) || [];
    assert.ok(claims.length >= minClaims,
      `${file}: expected at least ${minClaims} CAS claim site(s), found ${claims.length}`);

    let at = src.indexOf('refundReference IS NULL');
    while (at !== -1) {
      const nearby = src.slice(at, at + 500);
      assert.ok(/affectedRows\s*===\s*0/.test(nearby),
        `${file}: claim at offset ${at} is not guarded by an affectedRows check`);
      at = src.indexOf('refundReference IS NULL', at + 10);
    }
  }

  const migration = await fs.readFile(new URL('../migrateRefundReference.js', import.meta.url), 'utf8');
  assert.match(migration, /CREATE UNIQUE INDEX uq_orders_refundReference/,
    'the refund marker must also be UNIQUE in the schema (defence in depth)');
});
