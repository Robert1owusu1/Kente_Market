// FILE LOCATION: shared/pricing.js
// DESCRIPTION: Single source of truth for ALL money math in the platform.
//
//   - Frontend (src/utils/pricing.js re-exports from here)
//   - Backend  (orderController, escrowService, commissionService, walletService)
//   - Tests    (backend/tests/money.test.js imports production code directly)
//
// Never duplicate these formulas anywhere else. If pricing rules change, change
// them here once — cart, checkout, order creation, escrow and the tests all
// pick up the same values automatically, so the price shown == price charged.

// --- Order pricing rules ---
export const TAX_RATE = 0.125; // 12.5% VAT
export const FREE_SHIPPING_THRESHOLD = 200; // subtotal >= this ships free
export const STANDARD_SHIPPING_COST = 15;

// --- Marketplace commission ---
export const DEFAULT_PLATFORM_FEE_RATE = 0.1; // 10% fallback commission

/**
 * Round a real number to 2 decimals (GHS pesewas) using round-half-away-from-zero.
 * This is the ONLY rounding function for money in the app. MySQL DECIMAL values
 * arrive as strings, so callers must coerce with Number() before rounding.
 */
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Order subtotal = Σ price × quantity. Accepts items with either `qty`
 * (backend order items) or `quantity` (frontend cart items).
 */
export const calcSubtotal = (items) =>
  round2(
    (items || []).reduce(
      (total, it) =>
        total + (Number(it.price) || 0) * (Number(it.quantity ?? it.qty) || 1),
      0
    )
  );

/**
 * VAT on the subtotal.
 */
export const calcTax = (subtotal, rate = TAX_RATE) => round2(subtotal * rate);

/**
 * Shipping cost: FREE above the threshold, otherwise the flat cost.
 */
export const calcShipping = (
  subtotal,
  threshold = FREE_SHIPPING_THRESHOLD,
  cost = STANDARD_SHIPPING_COST
) => (subtotal >= threshold ? 0 : cost);

/**
 * Server-side coupon discount amount (never trust the client's discount).
 * + `percentage` (discountValue = 0..100) -> value% of subtotal
 * + `fixed`        (discountValue = GHS amount) -> the amount, capped at subtotal
 */
export const calcCouponDiscount = (subtotal, discountType, discountValue) => {
  const value = Math.max(0, parseFloat(discountValue) || 0);
  if (discountType === 'percentage') {
    return round2((subtotal * value) / 100);
  }
  return Math.min(value, subtotal);
};

/**
 * Full order totals. `discount` is a positive amount to subtract from the
 * total (usually from calcCouponDiscount). The subtotal is always recomputed
 * from the items so a tampered client price can never leak into the total.
 */
export const calcOrderTotals = (items, { discount = 0 } = {}) => {
  const subtotal = calcSubtotal(items);
  const tax = calcTax(subtotal);
  const shipping = calcShipping(subtotal);
  const appliedDiscount = round2(Math.min(Math.max(Number(discount) || 0, 0), subtotal));
  const total = round2(Math.max(subtotal + tax + shipping - appliedDiscount, 0));
  return { subtotal, tax, shipping, discount: appliedDiscount, total };
};

/**
 * Escrow/payout division for a gross amount at a commission rate.
 * `feeRate` must already be resolved by the caller (commission engine, per-vendor
 * override or config default). A non-finite rate falls back to `fallbackRate`
 * (default: DEFAULT_PLATFORM_FEE_RATE). Zero/NaN-safe: a vendor with a 0% rate
 * keeps 100% of the payout.
 */
export const calcEscrowFees = (
  amount,
  feeRate,
  fallbackRate = DEFAULT_PLATFORM_FEE_RATE
) => {
  const gross = round2(Math.max(0, Number(amount) || 0));
  // Accept a real 0% rate, but treat true missings (null/undefined/'') as an
  // instruction to use the fallback instead of charging 0.
  const parsedRate = Number(feeRate);
  const hasRate =
    feeRate !== null &&
    feeRate !== undefined &&
    feeRate !== '' &&
    Number.isFinite(parsedRate);
  const rate = hasRate ? parsedRate : fallbackRate;
  const platformFee = round2(gross * rate);
  const payoutAmount = round2(Math.max(gross - platformFee, 0));
  return { platformFee, payoutAmount };
};