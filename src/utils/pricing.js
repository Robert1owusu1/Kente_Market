// FILE LOCATION: src/utils/pricing.js
// DESCRIPTION: Single source of truth for order pricing (tax, shipping, free
//              shipping threshold). Both the cart page and checkout use these
//              so the amount shown and the amount charged always match.

export const TAX_RATE = 0.125; // 12.5% VAT
export const FREE_SHIPPING_THRESHOLD = 200;
export const STANDARD_SHIPPING_COST = 15;

// Subtotal is the sum of (price * quantity) across all cart items.
export const calcSubtotal = (items) =>
  (items || []).reduce(
    (total, item) => total + (Number(item.price) || 0) * (Number(item.quantity) || 1),
    0
  );

export const calcTax = (subtotal, rate = TAX_RATE) =>
  Number((subtotal * rate).toFixed(2));

export const calcShipping = (subtotal, threshold = FREE_SHIPPING_THRESHOLD, cost = STANDARD_SHIPPING_COST) =>
  subtotal >= threshold ? 0 : cost;

// Calculate all order totals at once. `discount` is a positive number (the
// amount being subtracted) and is applied against the subtotal before the
// final total is computed.
export const calcOrderTotals = (items, { discount = 0 } = {}) => {
  const subtotal = calcSubtotal(items);
  const tax = calcTax(subtotal);
  const shipping = calcShipping(subtotal);
  const appliedDiscount = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const total = Number((Math.max(subtotal + tax + shipping - appliedDiscount, 0)).toFixed(2));
  return { subtotal, tax, shipping, discount: appliedDiscount, total };
};
