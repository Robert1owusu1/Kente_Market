// @ts-check
// controllers/internationalCheckoutController.js
// International checkout support: address validation, shipping eligibility, and rate queries

import pool from "../config/db.js";
import { getShippingOptions as getShippingOptionsService, checkVendorDestination } from "../Services/shippingService.js";

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
    zipPattern: "^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$",
    zipLabel: "Postcode",
    regions: [] // Not used for UK
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
    zipPattern: "^[A-Z][0-9][A-Z] [0-9][A-Z][0-9]$",
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
    zipPattern: "^[0-9]{4} [A-Z]{2}$",
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
    res.json({ countries });
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
    const config = COUNTRY_CONFIG[countryCode.toUpperCase()];
    
    if (!config) {
      return res.status(404).json({ message: "Country not supported" });
    }
    
    res.json({
      countryCode: countryCode.toUpperCase(),
      name: config.name,
      currency: config.currency,
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
    const code = countryCode?.toUpperCase();
    const config = COUNTRY_CONFIG[code];
    
    if (!config) {
      return res.status(400).json({ 
        valid: false, 
        errors: { countryCode: "Unsupported country" } 
      });
    }
    
    const errors = {};
    const normalized = { ...addressData, country: code };
    
    // Validate required fields
    for (const field of config.requiredFields) {
      const value = addressData[field]?.trim();
      if (!value) {
        errors[field] = `${field} is required`;
        continue;
      }
      
      // Field-specific validation
      switch (field) {
        case "phone":
          const phoneRegex = new RegExp(config.phonePattern);
          if (!phoneRegex.test(value.replace(/\s/g, ""))) {
            errors.phone = `Invalid phone format. Example: ${config.phoneExample}`;
          } else {
            // Normalize phone to E.164 format
            normalized.phone = normalizePhone(value, code);
          }
          break;
          
        case "postalCode":
        case "zipCode":
          const zipRegex = new RegExp(config.zipPattern, "i");
          if (!zipRegex.test(value.toUpperCase().replace(/\s/g, ""))) {
            errors[field] = `Invalid ${config.zipLabel} format`;
          } else {
            normalized[field] = value.toUpperCase().replace(/\s/g, "");
          }
          break;
          
        case "region":
          if (config.regions.length > 0 && !config.regions.includes(value)) {
            errors.region = "Invalid region/province/state";
          }
          break;
          
        case "firstName":
        case "lastName":
          if (value.length < 2) {
            errors[field] = "Must be at least 2 characters";
          }
          break;
          
        case "city":
          if (value.length < 2) {
            errors.city = "Please enter a valid city";
          }
          break;
          
        case "addressLine1":
          if (value.length < 5) {
            errors.addressLine1 = "Please provide a complete address";
          }
          break;
      }
    }
    
    // Validate optional fields if provided
    for (const field of config.optionalFields) {
      const value = addressData[field]?.trim();
      if (value) {
        if (field === "zipCode" || field === "postalCode") {
          const zipRegex = new RegExp(config.zipPattern, "i");
          if (!zipRegex.test(value.toUpperCase().replace(/\s/g, ""))) {
            errors[field] = `Invalid ${config.zipLabel} format`;
          } else {
            normalized[field] = value.toUpperCase().replace(/\s/g, "");
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
      currency: config.currency
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
 * Get shipping options for a destination and cart
 * This endpoint uses the shippingService for real carrier rates.
 */
export const getShippingOptions = async (req, res) => {
  try {
    const { countryCode, subtotal, items } = req.body;
    const code = countryCode?.toUpperCase();
    const config = COUNTRY_CONFIG[code];

    if (!config) {
      return res.status(400).json({
        message: "Shipping not available to this country",
        supported: false
      });
    }

    // Get vendor IDs from items if present
    const vendorIds = [...new Set(
      (items || []).map(it => it.vendorId).filter(v => v != null)
    )];

    // For multi-vendor orders, we need to check each vendor's eligibility
    // and combine rates. For now, use the first vendor or platform default.
    const vendorId = vendorIds.length > 0 ? vendorIds[0] : null;

    const result = await getShippingOptionsService({
      destinationCountry: code,
      vendorId,
      items: items || [],
      subtotal: subtotal || 0,
      currency: config.currency,
    });

    res.json(result);
  } catch (error) {
    console.error("getShippingOptions error:", error.message);
    res.status(500).json({ message: "Failed to fetch shipping options" });
  }
};

/**
 * Default shipping options per country (placeholder until shipping workstream provides real rates)
 */
function getDefaultShippingOptions(countryCode, subtotal, currency) {
  // These are placeholder rates. The shipping workstream will replace with real carrier integration.
  const rates = {
    GH: { standard: 15, freeThreshold: 200, currency: "GHS", transitDays: "2-5" },
    GB: { standard: 12, freeThreshold: 100, currency: "GBP", transitDays: "5-10" },
    US: { standard: 18, freeThreshold: 150, currency: "USD", transitDays: "7-14" },
    CA: { standard: 20, freeThreshold: 180, currency: "CAD", transitDays: "7-14" },
    DE: { standard: 15, freeThreshold: 120, currency: "EUR", transitDays: "5-10" },
    NL: { standard: 14, freeThreshold: 110, currency: "EUR", transitDays: "5-10" }
  };
  
  const rate = rates[countryCode] || rates.GH;
  const isFree = subtotal >= rate.freeThreshold;
  
  return [
    {
      id: "standard",
      name: "Standard Shipping",
      amount: isFree ? 0 : rate.standard,
      currency: rate.currency,
      transitDaysMin: parseInt(rate.transitDays.split("-")[0]),
      transitDaysMax: parseInt(rate.transitDays.split("-")[1]),
      freeThreshold: rate.freeThreshold,
      isFree
    }
  ];
}

/**
 * Check if a vendor can ship to a destination country
 * Uses vendor_shipping_destinations table for per-vendor eligibility.
 */
export const checkVendorShippingEligibility = async (req, res) => {
  try {
    const { vendorIds, countryCode, region } = req.body;
    const code = countryCode?.toUpperCase();

    if (!COUNTRY_CONFIG[code]) {
      return res.json({ eligible: false, reason: "Country not supported" });
    }

    const results = await Promise.all(
      (vendorIds || []).map(async (vendorId) => {
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