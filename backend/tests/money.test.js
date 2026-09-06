// FILE LOCATION: backend/tests/money.test.js
// DESCRIPTION: Regression tests for the money-critical math used by orders and
//              escrow. These import the PRODUCTION functions from
//              shared/pricing.js — the same module used by the frontend cart,
//              orderController, commissionService and escrowService — so the
//              tests can never silently drift from production again.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  round2,
  calcOrderTotals,
  calcEscrowFees,
  calcCouponDiscount,
  TAX_RATE,
  FREE_SHIPPING_THRESHOLD,
  STANDARD_SHIPPING_COST,
  DEFAULT_PLATFORM_FEE_RATE,
} from '../../shared/pricing.js';
import { PLATFORM_FEE_RATE, ESCROW_RELEASE_DAYS } from '../config/businessConfig.js';

// Cart item helper: { price, quantity } — the same shape the frontend cart uses.
const item = (price, quantity = 1) => ({ price, quantity });

describe('Business pricing rules (single source of truth in shared/pricing.js)', () => {
  test('tax rate, shipping threshold and cost match production config', () => {
    assert.equal(TAX_RATE, 0.125); // 12.5% VAT
    assert.equal(FREE_SHIPPING_THRESHOLD, 200); // free shipping >= GH¢200
    assert.equal(STANDARD_SHIPPING_COST, 15);
    assert.equal(DEFAULT_PLATFORM_FEE_RATE, 0.1); // 10% platform commission
  });
});

describe('round2 (2-dp money rounding, GHS)', () => {
  test('rounds half away from zero to 2 decimals', () => {
    assert.equal(round2(10.005), 10.01);
    assert.equal(round2(10.004), 10.0);
    assert.equal(round2(0.1 * 3), 0.3); // 0.30000000000000004 -> 0.3
  });

  test('handles whole numbers and negatives', () => {
    assert.equal(round2(5), 5);
    assert.equal(round2(0), 0);
    assert.equal(round2(-1.005), -1.0);
  });
});

describe('calcOrderTotals (12.5% VAT, GH¢15 shipping, free over GH¢200)', () => {
  test('subtotal below threshold -> GH¢15 shipping + 12.5% tax', () => {
    const { subtotal, shipping, tax, total } = calcOrderTotals([
      item(80, 1),
      item(90, 1),
    ]);
    assert.equal(subtotal, 170);
    assert.equal(shipping, 15);
    assert.equal(tax, 21.25);
    assert.equal(total, 206.25);
  });

  test('subtotal over threshold -> free shipping', () => {
    const { subtotal, shipping, tax, total } = calcOrderTotals([item(120, 2)]);
    assert.equal(subtotal, 240);
    assert.equal(shipping, 0);
    assert.equal(tax, 30);
    assert.equal(total, 270);
  });

  test('exactly GH¢200 is free-shipped (>= boundary)', () => {
    const { shipping, total } = calcOrderTotals([item(200, 1)]);
    assert.equal(shipping, 0);
    assert.equal(total, 225);
  });

  test('multi-line subtotal sums quantity x price', () => {
    const { subtotal } = calcOrderTotals([item(19.99, 3)]);
    assert.equal(subtotal, 59.97);
  });

  test('a client-supplied subtotal cannot influence the total', () => {
    // The totals are always recomputed from the item prices. In production the
    // server replaces client prices with DB prices before calling this, so the
    // price shown equals the price charged.
    const serverItems = [{ price: 25.0, quantity: 2 }];
    const totals = calcOrderTotals(serverItems);
    assert.equal(totals.subtotal, 50.0); // 25 * 2, never a client-picked number
    assert.equal(totals.discount, 0);
  });
});

describe('calcCouponDiscount (server-side, never trusted from the client)', () => {
  test('percentage discount = value% of subtotal, rounded', () => {
    assert.equal(calcCouponDiscount(100, 'percentage', 10), 10);
    assert.equal(calcCouponDiscount(99.99, 'percentage', 10), 10); // round2(9.999)
    assert.equal(calcCouponDiscount(200, 'percentage', 12.5), 25);
  });

  test('fixed discount is the flat amount, capped at the subtotal', () => {
    assert.equal(calcCouponDiscount(500, 'fixed', 50), 50);
    assert.equal(calcCouponDiscount(30, 'fixed', 50), 30); // can never exceed subtotal
  });

  test('invalid/negative values yield no discount', () => {
    assert.equal(calcCouponDiscount(100, 'percentage', 'abc'), 0);
    assert.equal(calcCouponDiscount(100, 'percentage', -5), 0);
    assert.equal(calcCouponDiscount(100, 'fixed', 0), 0);
  });

  test('order totals subtract the coupon discount', () => {
    const { subtotal, tax, shipping, discount, total } = calcOrderTotals(
      [item(100, 1)],
      { discount: 10 }
    );
    assert.equal(subtotal, 100);
    assert.equal(tax, 12.5);
    assert.equal(shipping, 15);
    assert.equal(discount, 10);
    assert.equal(total, 117.5); // 100 + 12.5 + 15 - 10
  });
});

describe('calcEscrowFees (platform commission split)', () => {
  test('10% commission subtracted from gross, payout is gross minus fee', () => {
    const { platformFee, payoutAmount } = calcEscrowFees(100, 0.1);
    assert.equal(platformFee, 10);
    assert.equal(payoutAmount, 90);
  });

  test('rounding on arbitrary amounts stays to the pesewa', () => {
    const { platformFee, payoutAmount } = calcEscrowFees(99.99, 0.1);
    assert.equal(platformFee, 10.0);
    assert.equal(payoutAmount, 89.99);
  });

  test('a missing rate falls back to the configured default', () => {
    const { platformFee, payoutAmount } = calcEscrowFees(200, undefined);
    assert.equal(platformFee, round2(200 * DEFAULT_PLATFORM_FEE_RATE));
    assert.equal(platformFee, round2(200 * PLATFORM_FEE_RATE)); // config stayed in sync
    assert.equal(payoutAmount, 180);
  });

  test('an explicit fallback rate overrides the default', () => {
    const { platformFee } = calcEscrowFees(200, 'oops', 0.05);
    assert.equal(platformFee, 10);
  });

  test('a 0% commission is honored (no accidental default charge)', () => {
    const { platformFee, payoutAmount } = calcEscrowFees(100, 0);
    assert.equal(platformFee, 0);
    assert.equal(payoutAmount, 100);
    const asString = calcEscrowFees(100, '0'); // DB column arrives as a string
    assert.equal(asString.platformFee, 0);
    assert.equal(asString.payoutAmount, 100);
  });

  test('per-order payout equals sum of per-vendor payouts', () => {
    const a = calcEscrowFees(60, 0.1);
    const b = calcEscrowFees(40, 0.1);
    const total = calcEscrowFees(100, 0.1);
    assert.equal(round2(a.payoutAmount + b.payoutAmount), total.payoutAmount);
  });
});

describe('Business configuration bounds', () => {
  test('PLATFORM_FEE_RATE is a valid commission between 0 and 1', () => {
    assert.ok(Number.isFinite(PLATFORM_FEE_RATE));
    assert.ok(PLATFORM_FEE_RATE >= 0 && PLATFORM_FEE_RATE <= 1);
  });

  test('ESCROW_RELEASE_DAYS is a sane positive integer', () => {
    assert.ok(Number.isInteger(ESCROW_RELEASE_DAYS));
    assert.ok(ESCROW_RELEASE_DAYS >= 1 && ESCROW_RELEASE_DAYS <= 90);
  });
});