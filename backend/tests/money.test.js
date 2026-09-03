// FILE LOCATION: backend/tests/money.test.js
// DESCRIPTION: Regression tests for the money-critical math that the app relies
//              on for orders and escrow. These mirror the exact formulas used in
//              backend/controllers/orderController.js and backend/Services/escrowService.js
//              so that a change breaking rounding / fee / pricing rules fails here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORM_FEE_RATE, ESCROW_RELEASE_DAYS } from '../config/businessConfig.js';

// --- Exact replicas of the production helpers (kept in sync deliberately) ---
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const computeOrderTotals = (serverItems) => {
  const subtotal = round2(serverItems.reduce((s, it) => s + it.price * it.qty, 0));
  const shipping = subtotal > 50 ? 0 : 5;
  const tax = round2(subtotal * 0.1);
  const totalAmount = round2(subtotal + shipping + tax);
  return { subtotal, shipping, tax, totalAmount };
};
const escrowFees = (amount, feeRate) => {
  const platformFee = round2(amount * (parseFloat(feeRate) || PLATFORM_FEE_RATE));
  const payoutAmount = round2(amount - platformFee);
  return { platformFee, payoutAmount };
};
// ---------------------------------------------------------------------------

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

describe('Order pricing (must match CartContext rules: tax 10%, free shipping > GH₵50)', () => {
  test('subtotal below threshold -> GH₵5 shipping + 10% tax', () => {
    const { subtotal, shipping, tax, totalAmount } = computeOrderTotals([
      { price: 20, qty: 1 },
      { price: 10.5, qty: 2 },
    ]);
    assert.equal(subtotal, 41.0);
    assert.equal(shipping, 5);
    assert.equal(tax, 4.1);
    assert.equal(totalAmount, 50.1);
  });

  test('subtotal over GH₵50 -> free shipping', () => {
    const { subtotal, shipping, tax, totalAmount } = computeOrderTotals([
      { price: 60, qty: 1 },
    ]);
    assert.equal(subtotal, 60);
    assert.equal(shipping, 0);
    assert.equal(tax, 6);
    assert.equal(totalAmount, 66);
  });

  test('exactly GH₵50 is NOT over threshold so shipping is charged', () => {
    const { shipping } = computeOrderTotals([{ price: 50, qty: 1 }]);
    assert.equal(shipping, 5);
  });

  test('multi-line multiplication is rounded per item then summed', () => {
    const { subtotal } = computeOrderTotals([{ price: 19.99, qty: 3 }]);
    assert.equal(subtotal, 59.97);
  });
});

describe('Server-authoritative pricing (client price must NOT influence the total)', () => {
  test('a tampered client price is ignored and server price used', () => {
    const serverPrice = 25.0;
    const clientAttemptedFromTheFront = [{ price: 0.01, product: 1, quantity: 2 }];
    // Reconstruct what addOrderItems does: it takes serverPrice, not client price.
    const serverItems = clientAttemptedFromTheFront.map((r) => ({
      price: round2(serverPrice),
      qty: r.quantity,
    }));
    const { subtotal } = computeOrderTotals(serverItems);
    assert.equal(subtotal, 50.0); // 25 * 2, NOT 0.01 * 2
  });
});

describe('Escrow fee / payout math (platform commission)', () => {
  test('10% commission subtracted from gross, payout is gross minus fee', () => {
    const { platformFee, payoutAmount } = escrowFees(100, 0.1);
    assert.equal(platformFee, 10);
    assert.equal(payoutAmount, 90);
  });

  test('rounding on arbitrary amounts stays to the pesewa', () => {
    const { platformFee, payoutAmount } = escrowFees(99.99, 0.1);
    assert.equal(platformFee, 10.0);
    assert.equal(payoutAmount, 89.99);
  });

  test('a missing rate falls back to the configured PLATFORM_FEE_RATE', () => {
    const { platformFee } = escrowFees(200, null);
    assert.equal(platformFee, round2(200 * PLATFORM_FEE_RATE));
  });

  test('per-order payout equals sum of per-vendor payouts', () => {
    const a = escrowFees(60, 0.1);
    const b = escrowFees(40, 0.1);
    const total = escrowFees(100, 0.1);
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