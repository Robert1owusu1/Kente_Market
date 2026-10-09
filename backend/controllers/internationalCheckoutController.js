// @ts-check
// controllers/internationalCheckoutController.js
// Checkout workstream: international address validation, shipping eligibility
// and shipping-price queries.
//
// Coordination contract (shipping/payments workstreams):
// - GET    /api/checkout/international/countries
// - GET    /api/checkout/international/countries/:countryCode
// - POST   /api/checkout/international/validate-address
// - POST   /api/checkout/international/shipping-options   (mock rates until
//          the shipping workstream provides real carrier rates)
// - POST   /api/checkout/international/vendor-eligibility (permissive until
//          the shipping workstream adds vendor_shipping_destinations checks)
//
// Currency safety: charge currency is always GHS. `currency` fields below
// are DISPLAY-ONLY placeholders for the shipping mock and must never be
// treated as chargeable amounts. No exchange rates are invented here.

import {
  SUPPORTED_DESTINATIONS,
  CHARGE_CURRENCY,
  normalizeDestinationCode,
} from "../utils/destinationValidation.js";

/**
 * Supported countries with their address field requirements and validation patterns.
 * This is the single source of truth for international address forms.
 */
const COUNTRY_CONFIG = {
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
 * Get list of supported countries for checkout
 */
export const getSupportedCountries = async (req, res) => {
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
 */
export const getAddressConfig = async (req, res) => {
  try {
    const { countryCode } = req.params;
    const config = COUNTRY_CONFIG[String(countryCode || "").toUpperCase()];

    if (!config) {
      return res.status(404).json({ message: "Country not supported" });
    }

    res.json({
      countryCode: String(countryCode).toUpperCase(),
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
 */
export const validateAddress = async (req, res) => {
  try {
    const { countryCode, ...addressData } = req.body;
    const code = normalizeDestinationCode(countryCode === "Ghana" ? "GH" : countryCode);
    const config = code ? COUNTRY_CONFIG[code] : null;

    if (!config) {
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

    const errors = {};
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
          if (!zipRegex.test(value)) {
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
          if (!zipRegex.test(value)) {
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
 * MOCK until the shipping workstream provides real carrier rates.
 * Amounts are informational; the order total remains server-authoritative
 * in GHS via shared/pricing.js in orderController.
 */
export const getShippingOptions = async (req, res) => {
  try {
    const { countryCode, subtotal } = req.body;
    const code = normalizeDestinationCode(countryCode);
    const config = code ? COUNTRY_CONFIG[code] : null;

    if (!config) {
      return res.status(400).json({
        message: "Shipping not available to this country",
        supported: false
      });
    }

    const shippingOptions = getDefaultShippingOptions(code, subtotal);

    res.json({
      supported: true,
      countryCode: code,
      currency: config.currency,
      chargeCurrency: CHARGE_CURRENCY,
      mock: true,
      options: shippingOptions
    });
  } catch (error) {
    console.error("getShippingOptions error:", error.message);
    res.status(500).json({ message: "Failed to fetch shipping options" });
  }
};

/**
 * Default shipping options per country (MOCK placeholder until the shipping
 * workstream replaces it with real carrier integration).
 */
function getDefaultShippingOptions(countryCode, subtotal) {
  // Placeholder rates. The shipping workstream will replace with real rates.
  const rates = {
    GH: { standard: 15, freeThreshold: 200, currency: "GHS", transitDays: "2-5" },
    GB: { standard: 12, freeThreshold: 100, currency: "GBP", transitDays: "5-10" },
    US: { standard: 18, freeThreshold: 150, currency: "USD", transitDays: "7-14" },
    CA: { standard: 20, freeThreshold: 180, currency: "CAD", transitDays: "7-14" },
    DE: { standard: 15, freeThreshold: 120, currency: "EUR", transitDays: "5-10" },
    NL: { standard: 14, freeThreshold: 110, currency: "EUR", transitDays: "5-10" }
  };

  const rate = rates[countryCode] || rates.GH;
  const numericSubtotal = Number(subtotal) || 0;
  const isFree = numericSubtotal >= rate.freeThreshold;

  return [
    {
      id: "standard",
      name: "Standard Shipping",
      amount: isFree ? 0 : rate.standard,
      currency: rate.currency,
      transitDaysMin: parseInt(rate.transitDays.split("-")[0], 10),
      transitDaysMax: parseInt(rate.transitDays.split("-")[1], 10),
      freeThreshold: rate.freeThreshold,
      isFree
    }
  ];
}

/**
 * Check if a vendor can ship to a destination country.
 * Permissive until the shipping workstream adds the
 * vendor_shipping_destinations table checks.
 */
export const checkVendorShippingEligibility = async (req, res) => {
  try {
    const { vendorIds, countryCode } = req.body;
    const code = normalizeDestinationCode(countryCode);

    if (!code) {
      return res.json({ eligible: false, reason: "Country not supported" });
    }

    const ids = Array.isArray(vendorIds) ? vendorIds : [];
    const results = ids.map(vendorId => ({
      vendorId,
      eligible: true,
      countryCode: code
    }));

    res.json({ eligible: true, vendors: results, mock: true });
  } catch (error) {
    console.error("checkVendorShippingEligibility error:", error.message);
    res.status(500).json({ message: "Failed to check shipping eligibility" });
  }
};
