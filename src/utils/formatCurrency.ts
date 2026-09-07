// FILE LOCATION: src/utils/formatCurrency.js
// DESCRIPTION: Single source of truth for currency formatting/parsing.
//              Every place that shows a price should use these helpers so the
//              whole app renders money consistently (and no bare "$" slips in).

// Map any stored/shared currency value (ISO code or GH₵ symbol) to the ISO code
// that Intl.NumberFormat needs. The app is a Ghana Cedi store, so anything
// unknown falls back to GHS.
const toIsoCode = (currency?: string): string => {
  const c = String(currency || '').trim().toUpperCase();
  if (c === 'GH₵' || c === 'GHC' || c === 'GH₵') return 'GHS';
  if (/^[A-Z]{3}$/.test(c)) return c;
  return 'GHS';
};

// Format an amount as money, e.g. "GH₵ 1,250.00". Passing the raw currency
// value ("GHS" or "GH₵") is optional; it always maps to a valid ISO code.
export const formatCurrency = (amount: number | string, currency?: string): string => {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: toIsoCode(currency),
    minimumFractionDigits: 2,
  }).format(num);
};

// Simple symbol formatter for tight spaces (badges, chips) - no Intl overhead.
export const formatCedi = (amount: number | string): string => `GH₵ ${(Number(amount) || 0).toFixed(2)}`;

export default formatCurrency;
