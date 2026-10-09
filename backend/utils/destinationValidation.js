// utils/destinationValidation.js
// Checkout workstream-owned pure helper (no DB, no secrets).
// Single source of truth for which destination countries the checkout
// workstream accepts, and how their address/phone fields validate.
//
// Currency safety: this module NEVER converts money and NEVER invents
// exchange rates. The charge currency remains GHS (Paystack account
// currency); `displayCurrency` is informational only for the address form.

export const SUPPORTED_DESTINATIONS = {
  GH: { name: "Ghana", displayCurrency: "GHS", phonePattern: "^(\\+233|0)[0-9]{9}$" },
  GB: { name: "United Kingdom", displayCurrency: "GBP", phonePattern: "^(\\+44|0)[1-9][0-9]{8,9}$" },
  US: { name: "United States", displayCurrency: "USD", phonePattern: "^(\\+1|1)?[2-9][0-9]{9}$" },
  CA: { name: "Canada", displayCurrency: "CAD", phonePattern: "^(\\+1|1)?[2-9][0-9]{9}$" },
  DE: { name: "Germany", displayCurrency: "EUR", phonePattern: "^(\\+49|0)[1-9][0-9]{8,12}$" },
  NL: { name: "Netherlands", displayCurrency: "EUR", phonePattern: "^(\\+31|0)[1-9][0-9]{8}$" },
};

// Charge currency is always GHS until the payments workstream enables a
// multi-currency Paystack configuration. Display currency must never be
// treated as chargeable.
export const CHARGE_CURRENCY = "GHS";

export const isSupportedDestination = (code) => {
  if (!code || typeof code !== "string") return false;
  return Object.hasOwn(SUPPORTED_DESTINATIONS, code.toUpperCase());
};

export const normalizeDestinationCode = (code) => {
  if (!code || typeof code !== "string") return null;
  const upper = code.trim().toUpperCase();
  return isSupportedDestination(upper) ? upper : null;
};

// Minimal required-field check used by order creation/update. Full
// per-country field/zip validation lives in
// controllers/internationalCheckoutController.js (validateAddress).
export const validateDestinationAddress = (shippingAddress = {}) => {
  const rawCode =
    shippingAddress?.countryCode ||
    shippingAddress?.country ||
    shippingAddress?.destinationCountryCode ||
    "GH";
  const code = normalizeDestinationCode(rawCode === "Ghana" ? "GH" : rawCode);
  if (!code) {
    return {
      valid: false,
      code: "UNSUPPORTED_DESTINATION",
      message: "Shipping is not available to this destination",
    };
  }
  const required = ["firstName", "lastName", "email", "phone"];
  const isPickup = shippingAddress?.deliveryMethod === "pickup";
  const fields = isPickup
    ? required
    : [...required, "address", "city", "region"];
  // International home delivery uses addressLine1/city/postalCode naming in
  // the new form; accept either naming so the legacy Ghana form keeps working.
  const get = (obj, ...keys) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  const missing = fields.filter((f) => {
    if (f === "address") return !get(shippingAddress, "address", "addressLine1");
    if (f === "region") {
      // UK/NL do not require region; postal code is required instead.
      if (code === "GB" || code === "NL") return false;
      return !get(shippingAddress, "region", "state", "province");
    }
    return !get(shippingAddress, f);
  });
  if (missing.length > 0) {
    return {
      valid: false,
      code: "MISSING_ADDRESS_FIELDS",
      message: `Missing required address fields: ${missing.join(", ")}`,
      missing,
    };
  }
  const email = get(shippingAddress, "email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, code: "INVALID_EMAIL", message: "Invalid email format" };
  }
  const phone = get(shippingAddress, "phone").replace(/\s/g, "");
  const pattern = SUPPORTED_DESTINATIONS[code].phonePattern;
  if (!new RegExp(pattern).test(phone)) {
    return {
      valid: false,
      code: "INVALID_PHONE",
      message: `Invalid phone number for ${SUPPORTED_DESTINATIONS[code].name}`,
    };
  }
  return { valid: true, countryCode: code };
};

// Totals separation guard: subtotal + shipping + tax - discount must equal
// total (2-dp). Used by tests and the checkout review step; the backend
// remains authoritative and never trusts client totals.
export const verifyTotalsBreakdown = ({ subtotal, shipping, tax, discount = 0, total }) => {
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const expected = round2(Number(subtotal) + Number(shipping) + Number(tax) - Number(discount));
  return { expected, matches: expected === round2(Number(total)) };
};
