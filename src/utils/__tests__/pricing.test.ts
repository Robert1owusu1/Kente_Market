// Frontend/backend pricing parity guard: both sides compute money from
// shared/pricing.js, so this suite mirrors the critical backend money.test.js
// bounds — a drift in the shared module fails loudly on both sides.
import { describe, test, expect } from 'vitest';
import * as pricing from '../../../shared/pricing.js';
import {
  DEFAULT_PLATFORM_FEE_RATE,
  round2,
  calcSubtotal,
  calcTax,
  calcCouponDiscount,
  calcOrderTotals,
  calcEscrowFees,
} from '../../../shared/pricing.js';

const item = (price: number, quantity = 1) => ({ price, quantity });

describe('Ghana pricing rules (shared/pricing.js)', () => {
  test('no money rule is hard-coded: VAT and delivery are inputs', () => {
    // VAT is the admin setting (settings.tax_rate) and delivery is per seller
    // (shipping quote); the old constants must not come back.
    for (const gone of ['TAX_RATE', 'FREE_SHIPPING_THRESHOLD', 'STANDARD_SHIPPING_COST', 'calcShipping']) {
      expect(gone in pricing).toBe(false);
    }
    expect(() => calcOrderTotals([item(80)], {} as never)).toThrow(/VAT rate/);
    // Only the commission fallback stays (admin commission rules come first).
    expect(DEFAULT_PLATFORM_FEE_RATE).toBe(0.1);
  });

  test('cart totals: tax on subtotal at the given rate, given delivery, discount subtracted', () => {
    const t = calcOrderTotals([item(80), item(90)], { taxRate: 0.15, shipping: 15 });
    expect(t.subtotal).toBe(170);
    expect(t.shipping).toBe(15);
    expect(t.tax).toBe(25.5);
    expect(t.total).toBe(210.5);
    const free = calcOrderTotals([item(200)], { taxRate: 0.15, shipping: 0 });
    expect(free.shipping).toBe(0);
    expect(free.total).toBe(230);
    expect(calcOrderTotals([item(100)], { taxRate: 0.125, shipping: 0 }).tax).toBe(12.5);
  });

  test('coupon math matches server: % uncapped, fixed capped at subtotal', () => {
    expect(calcCouponDiscount(100, 'percentage', 10)).toBe(10);
    expect(calcCouponDiscount(30, 'fixed', 50)).toBe(30);
    expect(calcCouponDiscount(100, 'percentage', -5)).toBe(0);
    expect(calcTax(100, 0.15)).toBe(15);
  });

  test('subtotal tolerates qty/quantity shapes; escrow splits add up', () => {
    expect(calcSubtotal([{ price: 25, qty: 2 } as never])).toBe(50);
    const a = calcEscrowFees(60, 0.1);
    const b = calcEscrowFees(40, 0.1);
    expect(round2(a.payoutAmount + b.payoutAmount)).toBe(calcEscrowFees(100, 0.1).payoutAmount);
  });
});
