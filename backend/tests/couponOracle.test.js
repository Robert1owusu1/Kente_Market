// FILE LOCATION: backend/tests/couponOracle.test.js
// DESCRIPTION: X1 — the coupon-existence oracle on the PUBLIC
//   POST /api/coupons/validate. Every reason Coupon.validate can refuse a
//   code has to reach the caller as one indistinguishable 400: no reason in
//   the text, no coupon row beside it.
//
//   The fix is deliberately SPLIT, and this file pins both halves of the
//   split. The model keeps its detail because the order path needs it —
//   couponMaxUses reads /usage limit/ and /issuing store/ off placeOrder
//   bodies (lines 271, 307, 521) and couponScope reads the model directly
//   (line 80) — so unifying inside Coupon.validate would have traded a
//   P3 enumeration channel for three red suites. The controller is the
//   boundary: it is the only caller that speaks to an unauthenticated
//   wordlist.
//
//   DB-backed; cleans up after itself. The source test runs with or without
//   a database, so the no-DB CI configuration still gets one assertion.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

// The words a refusal is not allowed to carry — each of these was its own
// sentence, and "Coupon not found" against "Coupon has expired" is a binary
// search over every code an admin ever minted.
const REASON_TEXT = /not found|no longer active|expired|usage limit|minimum purchase|issuing store|\$\d/i;

test('the refusal is keyed on validity, not on the reason', () => {
  // Structural on purpose. The controller branches on `!result.valid`, so a
  // reason added to Coupon.validate tomorrow is bucketed before it can be
  // written into a response — the uniformity does not depend on someone
  // remembering to add a new case to a list of cases. That property is what
  // makes this fix survive the next feature, so it is asserted directly
  // rather than inferred from today's six cases.
  const src = readFileSync(new URL('../controllers/couponController.js', import.meta.url), 'utf8');
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const gate = stripped.indexOf('if (!result.valid)');
  assert.ok(gate > -1, 'the invalid branch must exist');
  const success = stripped.indexOf('res.json({ message: result.message', gate);
  assert.ok(success > gate, 'the invalid branch must return before the success body');

  const block = stripped.slice(gate, success);
  assert.ok(block.includes('coupon: null'), 'the coupon row must not accompany a refusal');
  assert.ok(!block.includes('result.message'), 'the reason must not be passed through');
});

describe('X1: every refused coupon looks exactly like an unknown one', { skip: !dbAvailable }, () => {
  const ts = Date.now();
  const state = { couponIds: [] };
  const codes = {};

  // Each cleanup statement gets its own try/catch. A shared one is how a
  // stranded fixture is born: partialRefunds' after() put seven DELETEs in a
  // single try, one 12s execute timeout aborted the rest, and the orphan it
  // left behind failed a different suite's idempotency assertion days later.
  const cleanup = async (label, sql, params) => {
    try {
      await pool.execute(sql, params);
    } catch (err) {
      console.error(`couponOracle cleanup [${label}] FAILED: ${err.message}`);
    }
  };

  before(async () => {
    if (!dbAvailable || !pool) return;
    const User = (await import('../models/usersModel.js')).default;
    const mk = (tag) => User.create({
      firstName: 'X1', lastName: tag, email: `couponoracle-${tag}-${ts}@example.com`,
      password: 'Test1234x', role: 'vendor', legalConsentAccepted: true,
    });
    const a = await mk('a');
    const b = await mk('b');
    state.vendorA = a.id;
    state.vendorB = b.id;

    const mkProd = async (vendorId, tag) => {
      const [r] = await pool.execute(
        `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'approved')`,
        [`COUPORACLE ${ts} ${tag}`, '/uploads/test.png', 100.0, 'test', 10, vendorId]
      );
      return r.insertId;
    };
    state.prodB = await mkProd(state.vendorB, 'B');

    // Six coupons, one per reason Coupon.validate can give. Raw insert
    // mirrors the shape couponScope builds its fixtures from. Only `expiresAt`
    // is interpolated — it is an expression (`DATE_SUB(...)`) that cannot be
    // bound; every actual VALUE is a parameter, because binding the string
    // 'NULL' into an int column is exactly how the first version of this
    // fixture failed.
    const mkCoupon = async (tag, opts = {}) => {
      const {
        isActive = 1, expiresAt = 'NULL', maxUses = null,
        usesUsed = 0, minPurchase = 0, vendorId = null,
      } = opts;
      const code = `X1${tag}${String(ts).slice(-6)}`;
      const [r] = await pool.execute(
        `INSERT INTO coupons (code, discountType, discountValue, minPurchase, maxUses, usesUsed, expiresAt, isActive, vendorId)
         VALUES (?, 'percentage', 10, ?, ?, ?, ${expiresAt}, ?, ?)`,
        [code, minPurchase, maxUses, usesUsed, isActive, vendorId]
      );
      state.couponIds.push(r.insertId);
      codes[tag] = code;
    };

    await mkCoupon('INACT', { isActive: 0 });
    await mkCoupon('EXPIRED', { expiresAt: 'DATE_SUB(NOW(), INTERVAL 1 DAY)' });
    await mkCoupon('EXHAUST', { maxUses: 1, usesUsed: 1 });
    await mkCoupon('SMALL', { minPurchase: 100000 });
    await mkCoupon('STORE', { vendorId: Number(state.vendorA) });
    await mkCoupon('USABLE');
  });

  after(async () => {
    if (!dbAvailable || !pool) return;
    if (state.couponIds.length) {
      const holes = state.couponIds.map(() => '?').join(', ');
      await cleanup('coupons', `DELETE FROM coupons WHERE id IN (${holes})`, state.couponIds);
    }
    if (state.prodB) await cleanup('products', 'DELETE FROM product WHERE id = ?', [state.prodB]);
    if (state.vendorA) {
      await cleanup('users', 'DELETE FROM users WHERE id IN (?, ?)', [state.vendorA, state.vendorB]);
    }
    try {
      await pool.end();
    } catch {
      /* suite owns the pool */
    }
  });

  const probe = async (body) => {
    const { validateCoupon } = await import('../controllers/couponController.js');
    let status = 200;
    let payload = null;
    await validateCoupon(
      { body },
      {
        status(c) { status = c; return this; },
        json(p) { payload = p; return this; },
      },
    );
    return { status, body: payload };
  };

  const refusals = () => [
    ['a code that never existed', `X1NOPE${String(ts).slice(-6)}`, {}],
    ['exists but is inactive', codes.INACT, {}],
    ['exists but has expired', codes.EXPIRED, {}],
    ['exists but is exhausted', codes.EXHAUST, {}],
    ['exists but the cart is too small', codes.SMALL, {}],
    ['exists but belongs to another store', codes.STORE, { items: [{ product: state.prodB }] }],
  ];

  test('all six refusals are byte-identical', { skip: !dbAvailable }, async () => {
    const list = refusals();
    const first = await probe({ code: list[0][1], cartTotal: 100 });
    assert.equal(first.status, 400, 'an unknown code must be refused');

    for (const [label, code, extra] of list) {
      const r = await probe({ code, cartTotal: 100, ...extra });
      assert.equal(r.status, 400, `${label}: expected 400, got ${r.status} ${JSON.stringify(r.body)}`);
      assert.deepStrictEqual(
        r.body,
        first.body,
        `${label}: body differs from the unknown-code body\n`
        + `  this: ${JSON.stringify(r.body)}\n`
        + `  ref:  ${JSON.stringify(first.body)}`,
      );
    }
  });

  test('no refusal says why, and none carries the row', { skip: !dbAvailable }, async () => {
    for (const [label, code, extra] of refusals()) {
      const r = await probe({ code, cartTotal: 100, ...extra });
      assert.equal(r.body.coupon, null, `${label}: the coupon row leaks existence`);
      assert.ok(
        !REASON_TEXT.test(r.body.message),
        `${label}: reason text leaked: ${JSON.stringify(r.body.message)}`,
      );
      assert.deepStrictEqual(
        Object.keys(r.body).sort(),
        ['coupon', 'message'],
        `${label}: response shape changed`,
      );
    }
  });

  test('a usable code still comes back valid, with its discount', { skip: !dbAvailable }, async () => {
    const ok = await probe({ code: codes.USABLE, cartTotal: 100 });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.body.coupon, 'the discount preview is the point of the endpoint');
    assert.equal(Number(ok.body.coupon.discountValue), 10);

    const unknown = await probe({ code: `X1NOPE2${String(ts).slice(-6)}`, cartTotal: 100 });
    assert.notDeepStrictEqual(
      ok.body, unknown.body,
      'success must remain distinguishable — that residual is the product working',
    );
  });

  test('the model keeps its reasons: the order path reads them', { skip: !dbAvailable }, async () => {
    // The other half of the split, asserted so nobody "tidies up" by unifying
    // here too and turns three green suites red for a channel that only this
    // endpoint exposes.
    const Coupon = (await import('../models/couponModel.js')).default;

    const unknown = await Coupon.validate(`X1NOPE3${String(ts).slice(-6)}`, 100);
    assert.equal(unknown.valid, false);
    assert.match(unknown.message, /not found/i);

    assert.match((await Coupon.validate(codes.EXPIRED, 100)).message, /expired/i);
    assert.match(
      (await Coupon.validate(codes.EXHAUST, 100)).message,
      /usage limit/i,
      'couponMaxUses:271,307 read this through placeOrder',
    );
    assert.match(
      (await Coupon.validate(codes.STORE, 100, { vendorIds: [state.vendorB] })).message,
      /issuing store/i,
      'couponScope:80 reads this directly',
    );
  });
});
