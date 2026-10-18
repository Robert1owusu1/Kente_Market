// utils/internationalCheckout.ts
// Checkout workstream pure helpers (no React). Mirrors
// backend/utils/destinationValidation.js allowlist so the form, validation,
// and tests agree. No FX, no invented rates.

export const SUPPORTED_DESTINATION_CODES = ["GH", "GB", "US", "CA", "DE", "NL"] as const;
export type DestinationCode = (typeof SUPPORTED_DESTINATION_CODES)[number];

// Each destination's own currency (mirrors COUNTRY_CONFIG in
// backend/controllers/internationalCheckoutController.js). Fees abroad may be
// set in GHS or this currency; Ghana fees are always GHS.
export const DESTINATION_CURRENCY: Record<DestinationCode, string> = {
  GH: "GHS",
  GB: "GBP",
  US: "USD",
  CA: "CAD",
  DE: "EUR",
  NL: "EUR",
};

export const DESTINATION_NAMES: Record<DestinationCode, string> = {
  GH: "Ghana",
  GB: "United Kingdom",
  US: "United States",
  CA: "Canada",
  DE: "Germany",
  NL: "Netherlands",
};

// Per-destination phone patterns. Mirrors
// backend/utils/destinationValidation.js SUPPORTED_DESTINATIONS so the
// checkout phone hint/validation agrees with the server. The server is
// authoritative; this is for immediate form feedback only.
export const DESTINATION_PHONE_PATTERNS: Record<DestinationCode, string> = {
  GH: "^(\\+233|0)[0-9]{9}$",
  GB: "^(\\+44|0)[1-9][0-9]{8,9}$",
  US: "^(\\+1|1)?[2-9][0-9]{9}$",
  CA: "^(\\+1|1)?[2-9][0-9]{9}$",
  DE: "^(\\+49|0)[1-9][0-9]{8,12}$",
  NL: "^(\\+31|0)[1-9][0-9]{8}$",
};

export const isValidPhoneForDestination = (phone: unknown, code: unknown): boolean => {
  if (typeof phone !== "string") return false;
  const dest = normalizeDestinationCode(code);
  if (!dest) return false;
  return new RegExp(DESTINATION_PHONE_PATTERNS[dest]).test(phone.replace(/\s/g, ""));
};

// Payment-amount freeze: returns true when a previously initialized payable
// total has silently changed (refresh/retry must not charge the new amount).
// 2-dp comparison so float noise never blocks a legitimate retry.
export const hasPayableAmountChanged = (initial: number | null, current: number): boolean => {
  if (initial === null || !Number.isFinite(initial) || !Number.isFinite(current)) return false;
  const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  return round2(initial) !== round2(current);
};

export const isSupportedDestinationCode = (code: unknown): code is DestinationCode => {
  if (typeof code !== "string") return false;
  return (SUPPORTED_DESTINATION_CODES as readonly string[]).includes(code.toUpperCase());
};

export const normalizeDestinationCode = (code: unknown): DestinationCode | null => {
  if (typeof code !== "string") return null;
  const upper = code.trim().toUpperCase();
  if (upper === "GHANA") return "GH";
  return isSupportedDestinationCode(upper) ? (upper as DestinationCode) : null;
};

export interface TotalsBreakdown {
  subtotal: number;
  shipping: number;
  tax: number;
  discount?: number | null;
  total: number;
}

// Verifies the review-step separation: subtotal + shipping + tax - discount
// equals total (2-dp). Display only; the backend total is authoritative.
export const verifyTotalsBreakdown = (t: TotalsBreakdown): { expected: number; matches: boolean } => {
  const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const expected = round2(
    Number(t.subtotal) + Number(t.shipping) + Number(t.tax) - Number(t.discount ?? 0)
  );
  return { expected, matches: expected === round2(Number(t.total)) };
};

// What the checkout summary SHOWS for an international destination. Ghana's
// flat shipping does not apply abroad: the server books the carrier/fallback
// charge returned by the shipping quote as `chargeableShippingGHS` (same
// function as order creation). Same arithmetic as shared/pricing
// calcOrderTotals, with that shipping figure. Display only — the charge is
// always the server-booked total. Null while the quote is unknown.
export const internationalDisplayTotals = (
  parts: { subtotal: number; tax: number; discount: number },
  chargeableShippingGHS: number | null | undefined,
): { shipping: number | null; total: number | null } => {
  const ship = Number(chargeableShippingGHS);
  if (chargeableShippingGHS === null || chargeableShippingGHS === undefined || !Number.isFinite(ship) || ship < 0) {
    return { shipping: null, total: null };
  }
  const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const discount = Math.min(Math.max(Number(parts.discount) || 0, 0), parts.subtotal);
  return {
    shipping: round2(ship),
    total: round2(Math.max(parts.subtotal + parts.tax + ship - discount, 0)),
  };
};
