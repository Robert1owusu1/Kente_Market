// FILE LOCATION: backend/tests/couponBounds.test.js
// DESCRIPTION: C2 — admin coupons had no ≤100% cap, and the PUT path wrote an
//              unclamped `totalAmount`.
//
// The chain that mattered: `calcCouponDiscount` capped `fixed` at the subtotal
// but left `percentage` uncapped, and `PUT /api/orders/:id` computed
// `totalAmount = subtotal + shipping + tax - discount` with no floor. An admin
// coupon at 150% therefore produced a NEGATIVE order total, which flowed into
// escrow allocation (`netFactor` floors at 0, so vendors were silently paid
// nothing) and into Paystack's `expectedKobo` comparison.
//
// Three independent places now refuse it, and each one is tested separately so
// removing any single layer still fails here:
//   1. the shared maths      (calcCouponDiscount caps percentage at subtotal)
//   2. the create endpoint   (rejects >100% before touching the DB)
//   3. the update endpoint   (evaluates EFFECTIVE values, so sending only
//                             discountValue cannot sneak past the cap)
// plus a source guard on the fourth: the apply-coupon path floors its total.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { calcCouponDiscount, calcOrderTotals, round2 } from '../../shared/pricing.js';

// Top-level await: the controller must be resolved before any test body runs.
// Doing this inside the `describe` callback would race the async import against
// synchronous test registration.
const { createCoupon, updateCoupon } = await import('../controllers/couponController.js');
const Coupon = (await import('../models/couponModel.js')).default;

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const couponControllerSrc = read('../controllers/couponController.js');
const orderControllerSrc = read('../controllers/orderController.js');

const createdCodes = [];

after(async () => {
  if (!dbAvailable) return;
  for (const code of createdCodes) {
    await pool.execute('DELETE FROM coupons WHERE code = ?', [code]).catch(() => {});
  }
  await pool?.end?.().catch?.(() => {});
});

/** Minimal express-shaped response recorder. */
const makeRes = () => {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
};

// ---------------------------------------------------------------------------
// 1. The maths
// ---------------------------------------------------------------------------
describe('C2: calcCouponDiscount can never exceed the subtotal', () => {
  test('normal percentages are untouched', () => {
    assert.equal(calcCouponDiscount(100, 'percentage', 10), 10);
    assert.equal(calcCouponDiscount(200, 'percentage', 50), 100);
    assert.equal(calcCouponDiscount(100, 'percentage', 100), 100, 'a full 100% coupon must still be allowed');
  });

  test('a percentage above 100 caps at the subtotal', () => {
    for (const pct of [101, 150, 500, 10000]) {
      assert.equal(
        calcCouponDiscount(100, 'percentage', pct),
        100,
        `${pct}% must not discount more than the goods it applies to`,
      );
    }
  });

  test('the cap holds at every subtotal, not just 100', () => {
    for (const subtotal of [1, 9.99, 50, 1234.56]) {
      assert.equal(calcCouponDiscount(subtotal, 'percentage', 250), round2(subtotal));
      assert.ok(calcCouponDiscount(subtotal, 'percentage', 250) <= subtotal);
    }
  });

  test('fixed coupons keep their existing subtotal cap', () => {
    assert.equal(calcCouponDiscount(50, 'fixed', 20), 20);
    assert.equal(calcCouponDiscount(50, 'fixed', 500), 50, 'fixed was already capped; it must stay capped');
  });

  test('negative and garbage inputs still resolve to 0', () => {
    assert.equal(calcCouponDiscount(100, 'percentage', -50), 0);
    assert.equal(calcCouponDiscount(100, 'fixed', -50), 0);
    assert.equal(calcCouponDiscount(100, 'percentage', 'nonsense'), 0);
  });
});

describe('C2: order totals stay non-negative under any discount', () => {
  test('a discount larger than the cart floors the total at 0', () => {
    const items = [{ price: 10, quantity: 2 }]; // subtotal 20
    const totals = calcOrderTotals(items, { discount: 9999 });
    assert.equal(totals.discount, 20, 'applied discount is clamped to the subtotal');
    assert.ok(totals.total >= 0, `total went negative: ${totals.total}`);
    assert.equal(totals.total, round2(totals.tax + totals.shipping), 'tax+shipping survives, goods are free');
  });

  test('zero-discount totals are unchanged by the cap', () => {
    const items = [{ price: 25, quantity: 4 }];
    const baseline = calcOrderTotals(items, { discount: 0 });
    assert.equal(baseline.total, 100 + baseline.tax + baseline.shipping);
  });
});

// ---------------------------------------------------------------------------
// 2. Create refuses >100% before it ever reaches the database
// ---------------------------------------------------------------------------
describe('C2: POST rejects an out-of-range percentage', () => {
  const attempt = async (body) => {
    const res = makeRes();
    await createCoupon({ body, user: { id: 1 } }, res);
    return res;
  };

  test('150% is rejected with 400', async () => {
    const res = await attempt({ code: 'C2TEST1', discountType: 'percentage', discountValue: 150 });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /exceed 100/i);
  });

  test('a fractional 100.5% is rejected too', async () => {
    const res = await attempt({ code: 'C2TEST2', discountType: 'percentage', discountValue: 100.5 });
    assert.equal(res.statusCode, 400);
  });

  test('100% is accepted (the cap is a ceiling, not a limit below it)', async (t) => {
    if (!dbAvailable) return t.skip('needs a database to actually create the coupon');
    const code = `C2EXACT${Date.now()}`;
    const res = await attempt({ code, discountType: 'percentage', discountValue: 100 });
    assert.equal(res.statusCode, 201, `100% should be allowed, got ${JSON.stringify(res.body)}`);
    createdCodes.push(code);
  });

  test('negative and zero discount values are still rejected', async () => {
    for (const value of [0, -1, -0.01]) {
      const res = await attempt({ code: 'C2NEG', discountType: 'percentage', discountValue: value });
      assert.equal(res.statusCode, 400, `${value} must be rejected`);
      assert.match(res.body.message, /greater than 0/i);
    }
  });

  test('the rejection happens before Coupon.create is reached', () => {
    // If someone moves the cap below the DB call, a rejected request would
    // write the coupon and then fail — so assert the guard's position.
    const createAt = couponControllerSrc.indexOf('await Coupon.create(');
    const capAt = couponControllerSrc.indexOf('Percentage discounts cannot exceed 100%');
    assert.ok(capAt !== -1, 'the percentage cap disappeared from createCoupon');
    assert.ok(capAt < createAt, 'the cap must run before the insert');
  });
});

// ---------------------------------------------------------------------------
// 3. Update evaluates effective values
// ---------------------------------------------------------------------------
describe('C2: PUT cannot smuggle a >100% coupon past the cap', { skip: !dbAvailable }, () => {
  let couponId;
  const code = `C2UPD${Date.now()}`;

  const setup = async () => {
    const coupon = await Coupon.create({
      code,
      discountType: 'percentage',
      discountValue: 10,
      minPurchase: 0,
      maxUses: 100,
      expiresAt: null,
      isActive: true,
    });
    couponId = coupon.id;
    createdCodes.push(code);
  };

  const attempt = async (body) => {
    const res = makeRes();
    await updateCoupon({ params: { id: String(couponId) }, body, user: { id: 1, role: 'admin' } }, res);
    return res;
  };

  test('a bare discountValue of 500 is rejected', async () => {
    if (couponId === undefined) await setup();
    const res = await attempt({ discountValue: 500 }); // type omitted → effective type stays percentage
    assert.equal(res.statusCode, 400, `PUT accepted 500%: ${JSON.stringify(res.body)}`);
    assert.match(res.body.message, /exceed 100/i);
  });

  test('switching to fixed while raising the value is allowed', async () => {
    if (couponId === undefined) await setup();
    // discountType changes to `fixed`, so the "value" is now currency, not a
    // percentage — the cap must not fire on a legitimately large fixed amount.
    const res = await attempt({ discountType: 'fixed', discountValue: 500 });
    assert.equal(res.statusCode, 200, `unexpected: ${JSON.stringify(res.body)}`);
  });

  test('a non-positive effective value is rejected', async () => {
    if (couponId === undefined) await setup();
    const res = await attempt({ discountValue: 0 });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /greater than 0/i);
  });

  test('an invalid discount type is rejected', async () => {
    if (couponId === undefined) await setup();
    const res = await attempt({ discountType: 'bogus' });
    assert.equal(res.statusCode, 400);
  });
});

// ---------------------------------------------------------------------------
// 4. The apply-coupon order path floors its total
// ---------------------------------------------------------------------------
describe('C2: the apply-coupon path cannot write a negative total', () => {
  test('the total is floored and the discount bounded', () => {
    const discounted = orderControllerSrc.match(/body\.totalAmount\s*=\s*([^;]+);/);
    assert.ok(discounted, 'apply-coupon no longer computes body.totalAmount');
    assert.match(discounted[1], /Math\.max\(0,/, 'totalAmount is written without a >= 0 floor');
    assert.match(orderControllerSrc, /body\.discount\s*=\s*Math\.min\(/, 'body.discount is not bounded by the subtotal');
  });

  test('admin percentage coupons are capped at BOTH entry points', () => {
    const occurrences = (couponControllerSrc.match(/Percentage discounts cannot exceed 100%/g) || []).length;
    assert.ok(occurrences >= 2, `expected the cap on create AND update, found ${occurrences}`);
  });

  test('the shared pricing module keeps its subtotal cap on both branches', () => {
    const pricingSrc = read('../../shared/pricing.js');
    const percentage = pricingSrc.match(/if \(discountType === 'percentage'\) \{[^}]*\}/);
    assert.ok(percentage, 'percentage branch not found');
    assert.match(percentage[0], /Math\.min\(/, 'the percentage branch lost its subtotal cap');
  });
});
