// Frontend/backend pricing parity guard: both sides compute money from
// shared/pricing.js, so this suite mirrors the critical backend money.test.js
// bounds — a drift in the shared module fails loudly on both sides.
import { describe, test, expect } from 'vitest';
import {
  TAX_RATE,
  FREE_SHIPPING_THRESHOLD,
  STANDARD_SHIPPING_COST,
  DEFAULT_PLATFORM_FEE_RATE,
  round2,
  calcSubtotal,
  calcTax,
  calcShipping,
  calcCouponDiscount,
  calcOrderTotals,
  calcEscrowFees,
} from '../../../shared/pricing.js';

const item = (price: number, quantity = 1) => ({ price, quantity });

describe('Ghana pricing rules (shared/pricing.js)', () => {
  test('VAT 15%, free shipping >= GH₵200 else GH₵15, 10% platform default', () => {
    expect(TAX_RATE).toBe(0.15);
    expect(FREE_SHIPPING_THRESHOLD).toBe(200);
    expect(STANDARD_SHIPPING_COST).toBe(15);
    expect(DEFAULT_PLATFORM_FEE_RATE).toBe(0.1);
  });

  test('cart totals: tax on subtotal, threshold shipping, discount subtracted', () => {
    const t = calcOrderTotals([item(80), item(90)]);
    expect(t.subtotal).toBe(170);
    expect(t.shipping).toBe(15);
    expect(t.tax).toBe(25.5);
    expect(t.total).toBe(210.5);
    const free = calcOrderTotals([item(200)]);
    expect(free.shipping).toBe(0);
    expect(free.total).toBe(230);
  });

  test('coupon math matches server: % uncapped, fixed capped at subtotal', () => {
    expect(calcCouponDiscount(100, 'percentage', 10)).toBe(10);
    expect(calcCouponDiscount(30, 'fixed', 50)).toBe(30);
    expect(calcCouponDiscount(100, 'percentage', -5)).toBe(0);
  });

  test('subtotal tolerates qty/quantity shapes; escrow splits add up', () => {
    expect(calcSubtotal([{ price: 25, qty: 2 } as never])).toBe(50);
    const a = calcEscrowFees(60, 0.1);
    const b = calcEscrowFees(40, 0.1);
    expect(round2(a.payoutAmount + b.payoutAmount)).toBe(calcEscrowFees(100, 0.1).payoutAmount);
  });
});
