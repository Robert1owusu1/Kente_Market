import { describe, it, expect } from 'vitest';
import { 
  round2, 
  calcSubtotal, 
  calcTax, 
  calcShipping, 
  calcCouponDiscount, 
  calcOrderTotals 
} from '../utils/pricing';

describe('Pricing Utilities', () => {
  describe('round2', () => {
    it('rounds to 2 decimal places', () => {
      expect(round2(1.005)).toBe(1.01);
      expect(round2(1.004)).toBe(1);
      expect(round2(1.995)).toBe(2);
    });

    it('handles string inputs', () => {
      expect(round2('1.005')).toBe(1.01);
      expect(round2('10.555')).toBe(10.56);
    });

    it('handles edge cases', () => {
      expect(round2(0)).toBe(0);
      // round-half-away-from-zero: -1.005 -> -1 (not -1.01)
      expect(round2(-1.005)).toBe(-1);
      expect(round2(NaN)).toBe(NaN);
    });
  });

  describe('calcSubtotal', () => {
    it('calculates subtotal from items with qty', () => {
      const items = [
        { price: 10, qty: 2 },
        { price: 5.5, qty: 3 },
      ];
      expect(calcSubtotal(items)).toBe(36.5);
    });

    it('calculates subtotal from items with quantity', () => {
      const items = [
        { price: 10, quantity: 2 },
        { price: 5, quantity: 1 },
      ];
      expect(calcSubtotal(items)).toBe(25);
    });

    it('handles empty array', () => {
      expect(calcSubtotal([])).toBe(0);
    });

    it('handles missing qty/quantity', () => {
      const items = [{ price: 10 }];
      expect(calcSubtotal(items)).toBe(10);
    });
  });

  describe('calcTax', () => {
    it('calculates 15% VAT by default', () => {
      expect(calcTax(100)).toBe(15);
      expect(calcTax(200)).toBe(30);
    });

    it('accepts custom rate', () => {
      expect(calcTax(100, 0.1)).toBe(10);
      expect(calcTax(100, 0.05)).toBe(5);
    });
  });

  describe('calcShipping', () => {
    it('returns free shipping above threshold', () => {
      expect(calcShipping(250)).toBe(0);
      expect(calcShipping(200)).toBe(0);
    });

    it('returns standard shipping below threshold', () => {
      expect(calcShipping(100)).toBe(15);
      expect(calcShipping(0)).toBe(15);
    });

    it('accepts custom threshold and cost', () => {
      expect(calcShipping(50, 100, 10)).toBe(10);
      expect(calcShipping(150, 100, 10)).toBe(0);
    });
  });

  describe('calcCouponDiscount', () => {
    it('calculates percentage discount', () => {
      expect(calcCouponDiscount(100, 'percentage', 10)).toBe(10);
      expect(calcCouponDiscount(200, 'percentage', 25)).toBe(50);
    });

    it('calculates fixed discount', () => {
      expect(calcCouponDiscount(100, 'fixed', 15)).toBe(15);
      expect(calcCouponDiscount(100, 'fixed', 50)).toBe(50);
    });

    it('caps fixed discount at subtotal', () => {
      expect(calcCouponDiscount(50, 'fixed', 100)).toBe(50);
    });

    it('handles invalid discount type', () => {
      expect(calcCouponDiscount(100, 'invalid', 10)).toBe(10);
    });
  });

  describe('calcOrderTotals', () => {
    it('calculates full order totals', () => {
      const items = [
        { price: 50, qty: 2 },
        { price: 25, qty: 1 },
      ];
      const totals = calcOrderTotals(items, { discount: 10 });
      
      expect(totals.subtotal).toBe(125);
      expect(totals.tax).toBe(18.75);
      expect(totals.shipping).toBe(15); // 125 < 200 threshold
      expect(totals.discount).toBe(10);
      expect(totals.total).toBe(148.75); // 125 + 18.75 + 15 - 10
    });

    it('adds shipping for orders under threshold', () => {
      const items = [{ price: 50, qty: 1 }];
      const totals = calcOrderTotals(items);
      
      expect(totals.subtotal).toBe(50);
      expect(totals.tax).toBe(7.5);
      expect(totals.shipping).toBe(15);
      expect(totals.total).toBe(72.5);
    });

    it('caps discount at subtotal', () => {
      const items = [{ price: 50, qty: 1 }];
      const totals = calcOrderTotals(items, { discount: 100 });
      
      expect(totals.discount).toBe(50);
      expect(totals.total).toBe(15 + 7.5); // shipping + tax
    });
  });
});