// @ts-check
// controllers/internationalCheckoutController.js
// UNIFIED international checkout controller (checkout + shipping workstreams).
//
// Endpoints:
// - GET    /api/checkout/international/countries
// - GET    /api/checkout/international/countries/:countryCode
// - POST   /api/checkout/international/validate-address
// - POST   /api/checkout/international/shipping-options   (DB-backed carrier
//          rates via shippingService, with static fallback table)
// - POST   /api/checkout/international/vendor-eligibility (DB-backed
//          vendor_shipping_destinations checks, fail-closed)
//
// Currency safety: charge currency is always GHS (see CHARGE_CURRENCY).
// `currency` fields on shipping options are DISPLAY-ONLY and must never be
// treated as chargeable amounts. Supported destinations: GH/GB/US/CA/DE/NL.

import {
  SUPPORTED_DESTINATIONS,
  CHARGE_CURRENCY,
  normalizeDestinationCode,
} from "../utils/destinationValidation.js";
import { getShippingOptions as getShippingOptionsService, checkVendorDestination } from "../Services/shippingService.js";

/**
 * Per-country address field requirements and validation patterns.
 * @typedef {Object} CountryConfig
 * @property {string} name
 * @property {string} currency
 * @property {string} phonePattern
 * @property {string} phoneExample
 * @property {string[]} requiredFields
 * @property {string[]} optionalFields
 * @property {string[]} regions
 * @property {string} zipPattern
 * @property {string} zipLabel
 */

/**
 * Supported countries with their address field requirements and validation patterns.
 * This is the single source of truth for international address forms.
 * Exported (string-keyed map) so shipping-side code can validate destinations
 * against the exact same table.
 * NOTE: zip patterns use optional-space (` ?`) form and values are tested
 * after upper-casing and whitespace-stripping, so "SW1A 1AA" and "SW1A1AA"
 * both validate.
 *
 * @type {Record<string, CountryConfig>}
 */
export const COUNTRY_CONFIG = {
  GH: {
    name: "Ghana",
    currency: "GHS",
    phonePattern: "^(\\+233|0)[0-9]{9}$",
    phoneExample: "+233 24 123 4567",
    requiredFields: ["firstName", "lastName", "phone", "addressLine1", "city", "region"],
    optionalFields: ["addressLine2", "zipCode"],
    regions: [
      "Greater Accra", "Ashanti", "Western", "Central", "Eastern", "Volta",
      "Northern", "Upper East", "Upper West", "Brong Ahafo", "Western North",
      "Ahafo", "Bono", "Bono East", "Oti", "Savannah", "North East"
    ],
    zipPattern: "^[0-9]{5}$",
    zipLabel: "Postal Code"
  },
  GB: {
    name: "United Kingdom",
    currency: "GBP",
    phonePattern: "^(\\+44|0)[1-9][0-9]{8,9}$",
    phoneExample: "+44 20 7123 4567",
    requiredFields: ["firstName", "lastName", "phone", "addressLine1", "city", "postalCode"],
    optionalFields: ["addressLine2", "region"],
    zipPattern: "^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$",
    zipLabel: "Postcode",
    regions: []
  },
  US: {
    name: "United States",
    currency: "USD",
    phonePattern: "^(\\+1|1)?[2-9][0-9]{9}$",
    phoneExample: "+1 555 123 4567",
    requiredFields: ["firstName", "lastName", "phone", "addressLine1", "city", "region", "postalCode"],
    optionalFields: ["addressLine2"],
    zipPattern: "^[0-9]{5}(-[0-9]{4})?$",
    zipLabel: "ZIP Code",
    regions: [
      "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
      "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
      "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
      "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
      "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
      "DC", "PR", "GU", "AS", "MP", "VI"
    ]
  },
  CA: {
    name: "Canada",
    currency: "CAD",
    phonePattern: "^(\\+1|1)?[2-9][0-9]{9}$",
    phoneExample: "+1 555 123 4567",
    requiredFields: ["firstName", "lastName", "phone", "addressLine1", "city", "region", "postalCode"],
    optionalFields: ["addressLine2"],
    zipPattern: "^[A-Z][0-9][A-Z] ?[0-9][A-Z][0-9]$",
    zipLabel: "Postal Code",
    regions: [
      "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE",
      "QC", "SK", "YT"
    ]
  },
  DE: {
    name: "Germany",
    currency: "EUR",
    phonePattern: "^(\\+49|0)[1-9][0-9]{8,12}$",
    phoneExample: "+49 30 12345678",
    requiredFields: ["firstName", "lastName", "phone", "addressLine1", "city", "postalCode"],
    optionalFields: ["addressLine2", "region"],
    zipPattern: "^[0-9]{5}$",
    zipLabel: "PLZ",
    regions: [
      "BW", "BY", "BE", "BB", "HB", "HH", "HE", "MV", "NI", "NW",
      "RP", "SL", "SN", "ST", "SH", "TH"
    ]
  },
  NL: {
    name: "Netherlands",
    currency: "EUR",
    phonePattern: "^(\\+31|0)[1-9][0-9]{8}$",
    phoneExample: "+31 20 123 4567",
    requiredFields: ["firstName", "lastName", "phone", "addressLine1", "city", "postalCode"],
    optionalFields: ["addressLine2", "region"],
    zipPattern: "^[0-9]{4} ?[A-Z]{2}$",
    zipLabel: "Postcode",
    regions: [
      "DR", "FL", "FR", "GE", "GR", "LI", "NB", "NH", "OV", "UT", "ZE", "ZH"
    ]
  }
};

/**
 * Normalize a caller-supplied country identifier to a COUNTRY_CONFIG key.
 * Accepts ISO codes (any case/whitespace) and the legacy "Ghana" name.
 * @param {unknown} countryCode
 * @returns {string | null}
 */
const toCountryCode = (countryCode) => {
  if (typeof countryCode !== "string") return null;
  if (countryCode.trim().toLowerCase() === "ghana") return "GH";
  return normalizeDestinationCode(countryCode);
};

/**
 * Get list of supported countries for checkout
 *
 * @param {import("express").Request} _req
 * @param {import("express").Response} res
 */
export const getSupportedCountries = async (_req, res) => {
  try {
    const countries = Object.entries(COUNTRY_CONFIG).map(([code, config]) => ({
      code,
      name: config.name,
      currency: config.currency,
      phoneExample: config.phoneExample,
      zipLabel: config.zipLabel
    }));
    res.json({ countries, chargeCurrency: CHARGE_CURRENCY });
  } catch (error) {
    console.error("getSupportedCountries error:", error.message);
    res.status(500).json({ message: "Failed to fetch supported countries" });
  }
};

/**
 * Get address field configuration for a specific country
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export const getAddressConfig = async (req, res) => {
  try {
    const { countryCode } = req.params;
    const code = toCountryCode(countryCode);
    const config = code ? COUNTRY_CONFIG[code] : null;

    if (!config || !code) {
      return res.status(404).json({ message: "Country not supported" });
    }

    res.json({
      countryCode: code,
      name: config.name,
      currency: config.currency,
      chargeCurrency: CHARGE_CURRENCY,
      phonePattern: config.phonePattern,
      phoneExample: config.phoneExample,
      requiredFields: config.requiredFields,
      optionalFields: config.optionalFields,
      zipPattern: config.zipPattern,
      zipLabel: config.zipLabel,
      regions: config.regions
    });
  } catch (error) {
    console.error("getAddressConfig error:", error.message);
    res.status(500).json({ message: "Failed to fetch address configuration" });
  }
};

/**
 * Validate an international address
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export const validateAddress = async (req, res) => {
  try {
    const { countryCode, ...addressData } = req.body;
    const code = toCountryCode(countryCode);
    const config = code ? COUNTRY_CONFIG[code] : null;

    if (!config || !code) {
      return res.status(400).json({
        valid: false,
        errors: { countryCode: "Unsupported country" }
      });
    }

    // Cross-check against the shared allowlist so the two modules agree.
    if (!SUPPORTED_DESTINATIONS[code]) {
      return res.status(400).json({
        valid: false,
        errors: { countryCode: "Unsupported country" }
      });
    }

    /** @type {Record<string, string>} */
    const errors = {};
    /** @type {Record<string, any>} */
    const normalized = { ...addressData, country: code, countryCode: code };

    // Validate required fields
    for (const field of config.requiredFields) {
      const raw = addressData[field];
      const value = typeof raw === "string" ? raw.trim() : "";
      if (!value) {
        errors[field] = `${field} is required`;
        continue;
      }
      // Field-specific validation
      switch (field) {
        case "phone": {
          const phoneRegex = new RegExp(config.phonePattern);
          if (!phoneRegex.test(value.replace(/\s/g, ""))) {
            errors.phone = `Invalid phone format. Example: ${config.phoneExample}`;
          } else {
            // Normalize phone to E.164 format
            normalized.phone = normalizePhone(value, code);
          }
          break;
        }

        case "postalCode":
        case "zipCode": {
          const zipRegex = new RegExp(config.zipPattern, "i");
          // Normalize-then-test: strip all whitespace so "SW1A 1AA" and
          // "SW1A1AA" both validate against the optional-space pattern.
          if (!zipRegex.test(value.toUpperCase().replace(/\s/g, ""))) {
            errors[field] = `Invalid ${config.zipLabel} format`;
          } else {
            normalized[field] = value.toUpperCase().trim();
          }
          break;
        }

        case "region": {
          if (config.regions.length > 0 && !config.regions.includes(value)) {
            errors.region = "Invalid region/province/state";
          }
          break;
        }

        case "firstName":
        case "lastName": {
          if (value.length < 2) {
            errors[field] = "Must be at least 2 characters";
          }
          break;
        }

        case "city": {
          if (value.length < 2) {
            errors.city = "Please enter a valid city";
          }
          break;
        }

        case "addressLine1": {
          if (value.length < 5) {
            errors.addressLine1 = "Please provide a complete address";
          }
          break;
        }

        default:
          break;
      }
    }

    // Validate optional fields if provided
    for (const field of config.optionalFields) {
      const raw = addressData[field];
      const value = typeof raw === "string" ? raw.trim() : "";
      if (value) {
        if (field === "zipCode" || field === "postalCode") {
          const zipRegex = new RegExp(config.zipPattern, "i");
          if (!zipRegex.test(value.toUpperCase().replace(/\s/g, ""))) {
            errors[field] = `Invalid ${config.zipLabel} format`;
          } else {
            normalized[field] = value.toUpperCase().trim();
          }
        } else if (field === "region" && config.regions.length > 0 && !config.regions.includes(value)) {
          errors.region = "Invalid region/province/state";
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ valid: false, errors });
    }

    // Success - return normalized address
    res.json({
      valid: true,
      normalized,
      currency: config.currency,
      chargeCurrency: CHARGE_CURRENCY
    });
  } catch (error) {
    console.error("validateAddress error:", error.message);
    res.status(500).json({ message: "Failed to validate address" });
  }
};

/**
 * Normalize phone number to E.164 format
 *
 * @param {string} phone
 * @param {string} countryCode
 * @returns {string}
 */
function normalizePhone(phone, countryCode) {
  const cleaned = phone.replace(/\s/g, "");

  switch (countryCode) {
    case "GH":
      if (cleaned.startsWith("0")) {
        return "+233" + cleaned.substring(1);
      }
      if (cleaned.startsWith("+233")) {
        return cleaned;
      }
      return "+233" + cleaned;

    case "GB":
      if (cleaned.startsWith("0")) {
        return "+44" + cleaned.substring(1);
      }
      if (cleaned.startsWith("+44")) {
        return cleaned;
      }
      return "+44" + cleaned;

    case "US":
    case "CA":
      if (cleaned.startsWith("+1")) {
        return cleaned;
      }
      if (cleaned.startsWith("1") && cleaned.length === 11) {
        return "+" + cleaned;
      }
      if (cleaned.length === 10) {
        return "+1" + cleaned;
      }
      return "+1" + cleaned;

    case "DE":
      if (cleaned.startsWith("0")) {
        return "+49" + cleaned.substring(1);
      }
      if (cleaned.startsWith("+49")) {
        return cleaned;
      }
      return "+49" + cleaned;

    case "NL":
      if (cleaned.startsWith("0")) {
        return "+31" + cleaned.substring(1);
      }
      if (cleaned.startsWith("+31")) {
        return cleaned;
      }
      return "+31" + cleaned;

    default:
      return phone;
  }
}

/**
 * Get shipping options for a destination and cart.
 * DB-backed carrier rates via shippingService (fail-closed per-vendor
 * eligibility); amounts are informational display values, the order total
 * remains server-authoritative in GHS via shared/pricing.js in orderController.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export const getShippingOptions = async (req, res) => {
  try {
    const { countryCode, subtotal, region } = req.body;
    /** @type {any[]} */
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const code = toCountryCode(countryCode);
    const config = code ? COUNTRY_CONFIG[code] : null;

    if (!config || !code) {
      return res.status(400).json({
        message: "Shipping not available to this country",
        supported: false
      });
    }

    // Fail-closed: EVERY vendor in the cart must be eligible to ship to this
    // destination — not just the first one. A multi-vendor cart must never
    // receive options (or a green light) because vendor #1 ships there while
    // vendor #2 has opted out.
    const vendorIds = [...new Set(
      (items || []).map(it => it.vendorId).filter(v => v != null)
    )];

    for (const vendorId of vendorIds) {
      const eligible = await checkVendorDestination(vendorId, code, region);
      if (!eligible) {
        return res.json({
          supported: false,
          message: `This vendor does not ship to ${code}${region ? ` (${region})` : ""}`,
          countryCode: code,
          currency: config.currency,
          chargeCurrency: CHARGE_CURRENCY,
          options: [],
        });
      }
    }

    // Eligibility above has already cleared every vendor. Rate lookup prefers
    // the first vendor's override and falls back to platform defaults.
    // NOTE: multi-vendor rate combination (summing per-vendor legs) is NOT
    // implemented — see orderController which re-resolves the authoritative
    // GHS shipping per vendor at order creation.
    const vendorId = vendorIds.length > 0 ? vendorIds[0] : null;

    const result = await getShippingOptionsService({
      destinationCountry: code,
      destinationRegion: region,
      vendorId,
      items: items || [],
      subtotal: subtotal || 0,
      currency: config.currency,
    });

    // A missing FX rate is a fail-closed outage, never parity pricing.
    if (result && /** @type {any} */ (result).fxUnavailable) {
      return res.status(502).json({
        message: "Shipping rates are temporarily unavailable for this currency",
        supported: false,
        countryCode: code,
        currency: config.currency,
        chargeCurrency: CHARGE_CURRENCY,
        options: [],
      });
    }

    res.json({ ...result, chargeCurrency: CHARGE_CURRENCY, mock: false });
  } catch (error) {
    console.error("getShippingOptions error:", error.message);
    res.status(500).json({ message: "Failed to fetch shipping options" });
  }
};

/**
 * Check if a vendor can ship to a destination country.
 * Uses vendor_shipping_destinations table for per-vendor eligibility
 * (fail-closed: a missing row means NOT eligible).
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export const checkVendorShippingEligibility = async (req, res) => {
  try {
    const { countryCode, region } = req.body;
    /** @type {any[]} */
    const vendorIds = Array.isArray(req.body.vendorIds) ? req.body.vendorIds : [];
    const code = toCountryCode(countryCode);

    if (!code || !COUNTRY_CONFIG[code]) {
      return res.json({ eligible: false, reason: "Country not supported" });
    }

    const results = await Promise.all(
      vendorIds.map(async (vendorId) => {
        const eligible = await checkVendorDestination(vendorId, code, region);
        return { vendorId, eligible, countryCode: code, region: region || null };
      })
    );

    const allEligible = results.every(r => r.eligible);
    res.json({ eligible: allEligible, vendors: results });
  } catch (error) {
    console.error("checkVendorShippingEligibility error:", error.message);
    res.status(500).json({ message: "Failed to check shipping eligibility" });
  }
};
