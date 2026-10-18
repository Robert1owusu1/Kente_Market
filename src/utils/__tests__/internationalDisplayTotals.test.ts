// The checkout summary for a diaspora address showed Ghana's flat/free
// shipping and a lower total than the server then booked and Paystack
// charged. Abroad it must show the quote's exact chargeable shipping.
import { describe, it, expect } from 'vitest';
import { internationalDisplayTotals } from '../internationalCheckout';
import { calcOrderTotals } from '../../../shared/pricing.js';

describe('internationalDisplayTotals', () => {
  it('uses the quoted shipping, not Ghana\'s free-over-200 rule', () => {
    // GHS 450 item to the UK: Ghana would show free shipping and 517.50.
    const parts = { subtotal: 450, tax: 67.5, discount: 0 };
    expect(internationalDisplayTotals(parts, 222.22)).toEqual({ shipping: 222.22, total: 739.72 });
    expect(calcOrderTotals([{ price: 450, quantity: 1 }]).total).toBe(517.5);
  });

  it('subtracts a discount the same way calcOrderTotals does (capped at the subtotal)', () => {
    expect(internationalDisplayTotals({ subtotal: 100, tax: 15, discount: 10 }, 50).total).toBe(155);
    expect(internationalDisplayTotals({ subtotal: 100, tax: 15, discount: 500 }, 50).total).toBe(65);
  });

  it('shows nothing (not a guess) until the quote has a figure', () => {
    for (const unknown of [null, undefined, NaN, -1]) {
      expect(internationalDisplayTotals({ subtotal: 100, tax: 15, discount: 0 }, unknown as number)).toEqual({ shipping: null, total: null });
    }
  });

  it('free international shipping (quote 0) is shown as 0, not "calculating"', () => {
    expect(internationalDisplayTotals({ subtotal: 100, tax: 15, discount: 0 }, 0)).toEqual({ shipping: 0, total: 115 });
  });
});
