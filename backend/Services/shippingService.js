// @ts-check
// FILE LOCATION: backend/Services/shippingService.js
// DESCRIPTION: Shipping rate lookup, eligibility checking, and order weight
// calculation. Uses database-backed carrier rates and vendor destinations.
import pool from '../config/db.js';
import { COUNTRY_CONFIG } from '../controllers/internationalCheckoutController.js';

/**
 * @typedef {Object} ShippingRateInput
 * @property {string} originCountry - ISO country code (always 'GH')
 * @property {string} destinationCountry - ISO country code
 * @property {string} [destinationRegion] - Region/state/province
 * @property {number} [vendorId] - Vendor user ID for vendor-specific rates
 * @property {Array<{productId: number, qty: number, weightKg?: number}>} items - Order items
 * @property {number} subtotal - Order subtotal in order currency
 * @property {string} currency - Order currency (ISO 4217)
 */

/**
 * @typedef {Object} ShippingOption
 * @property {string} carrier - Carrier code (e.g., 'dhl', 'ems', 'local_gh')
 * @property {string} carrierName - Carrier display name
 * @property {string} serviceLevel - 'standard', 'express', 'economy'
 * @property {number} amount - Cost in order currency
 * @property {string} currency - Order currency
 * @property {number} transitDaysMin
 * @property {number} transitDaysMax
 * @property {number} [freeThreshold] - Subtotal for free shipping
 * @property {boolean} isFree
 */

/**
 * Get the active exchange rate for a currency pair on a given date
 * @param {string} baseCurrency
 * @param {string} targetCurrency
 * @param {Date} [date]
 * @returns {Promise<number>} Rate (1 base = X target)
 */
export const getExchangeRate = async (baseCurrency, targetCurrency, date = new Date()) => {
  if (baseCurrency === targetCurrency) return 1;

  const effectiveDate = date.toISOString().split('T')[0];
  const [[row]] = await pool.execute(
    `SELECT rate FROM exchange_rates
     WHERE baseCurrency = ? AND targetCurrency = ? AND effectiveDate <= ?
     ORDER BY effectiveDate DESC LIMIT 1`,
    [baseCurrency, targetCurrency, effectiveDate]
  );

  if (!row) {
    console.warn(` No exchange rate found for ${baseCurrency} -> ${targetCurrency} on ${effectiveDate}, using 1`);
    return 1;
  }
  return parseFloat(row.rate);
};

/**
 * Calculate total order weight from items
 * @param {Array<{productId: number, qty: number, weightKg?: number}>} items
 * @returns {Promise<number>} Total weight in kg
 */
export const calculateOrderWeight = async (items) => {
  if (!Array.isArray(items) || items.length === 0) return 0;

  let totalWeight = 0;
  const productIds = [...new Set(items.map(i => i.productId).filter(Boolean))];

  if (productIds.length > 0) {
    const placeholders = productIds.map(() => '?').join(', ');
    const [products] = await pool.execute(
      `SELECT id, weight FROM product WHERE id IN (${placeholders})`,
      productIds
    );
    const weightMap = new Map(products.map(p => [p.id, parseFloat(p.weight) || 0]));

    for (const item of items) {
      const weight = weightMap.get(item.productId) || 0.5;
      totalWeight += weight * (item.qty || 1);
    }
  } else {
    totalWeight = items.reduce((sum, i) => sum + 0.5 * (i.qty || 1), 0);
  }

  return totalWeight;
};

/**
 * Get shipping options for a destination and order
 * @param {ShippingRateInput} input
 * @returns {Promise<{supported: boolean, countryCode: string, currency: string, options: ShippingOption[]}>}
 */
export const getShippingOptions = async (input) => {
  const {
    originCountry = 'GH',
    destinationCountry,
    destinationRegion,
    vendorId,
    items,
    subtotal,
    currency,
  } = input;

  if (!COUNTRY_CONFIG[destinationCountry]) {
    return {
      supported: false,
      message: `Shipping not available to ${destinationCountry}`,
      countryCode: destinationCountry,
      currency,
      options: [],
    };
  }

  if (vendorId) {
    const eligible = await checkVendorDestination(vendorId, destinationCountry, destinationRegion);
    if (!eligible) {
      return {
        supported: false,
        message: `This vendor does not ship to ${destinationCountry}${destinationRegion ? ` (${destinationRegion})` : ''}`,
        countryCode: destinationCountry,
        currency,
        options: [],
      };
    }
  }

  const weightKg = await calculateOrderWeight(items);
  const today = new Date();
  const effectiveDate = today.toISOString().split('T')[0];

  const vendorCondition = vendorId ? `AND (sr.vendorId = ? OR sr.vendorId IS NULL)` : `AND sr.vendorId IS NULL`;
  const vendorParams = vendorId ? [vendorId] : [];

  const [rates] = await pool.execute(
    `SELECT sr.*, c.code AS carrierCode, c.name AS carrierName
     FROM shipping_rates sr
     JOIN shipping_carriers c ON c.id = sr.carrierId
     WHERE sr.originCountry = ?
       AND sr.destinationCountry = ?
       AND (sr.destinationRegion IS NULL OR sr.destinationRegion = ?)
       AND sr.serviceLevel IN ('standard', 'express', 'economy')
       AND sr.minWeightKg <= ?
       AND sr.maxWeightKg >= ?
       AND sr.isActive = TRUE
       AND c.isActive = TRUE
       AND sr.effectiveFrom <= ?
       AND (sr.effectiveTo IS NULL OR sr.effectiveTo >= ?)
       ${vendorCondition}
     ORDER BY sr.vendorId DESC, sr.baseCost ASC`,
    [originCountry, destinationCountry, destinationRegion || null, weightKg, weightKg, effectiveDate, effectiveDate, ...vendorParams]
  );

  if (rates.length === 0) {
    return getFallbackOptions(destinationCountry, subtotal, currency);
  }

  const options = [];
  for (const rate of rates) {
    let amount = parseFloat(rate.baseCost);
    const perKgCost = parseFloat(rate.perKgCost) || 0;
    if (weightKg > rate.minWeightKg) {
      amount += perKgCost * (weightKg - rate.minWeightKg);
    }

    if (rate.currency !== currency) {
      const rateValue = await getExchangeRate(rate.currency, currency, today);
      amount = amount * rateValue;
    }

    const freeThreshold = rate.freeThreshold ? parseFloat(rate.freeThreshold) : null;
    const isFree = freeThreshold !== null && subtotal >= freeThreshold;

    options.push({
      carrier: rate.carrierCode,
      carrierName: rate.carrierName,
      serviceLevel: rate.serviceLevel,
      amount: isFree ? 0 : Math.round(amount * 100) / 100,
      currency,
      transitDaysMin: rate.transitDaysMin,
      transitDaysMax: rate.transitDaysMax,
      freeThreshold,
      isFree,
    });
  }

  const deduped = new Map();
  for (const opt of options) {
    const key = `${opt.carrier}:${opt.serviceLevel}`;
    if (!deduped.has(key) || opt.amount < deduped.get(key).amount) {
      deduped.set(key, opt);
    }
  }

  return {
    supported: true,
    countryCode: destinationCountry,
    currency,
    options: Array.from(deduped.values()).sort((a, b) => a.amount - b.amount),
  };
};

/**
 * Check if a vendor can ship to a destination
 * @param {number} vendorId
 * @param {string} countryCode
 * @param {string} [region]
 * @returns {Promise<boolean>}
 */
export const checkVendorDestination = async (vendorId, countryCode, region) => {
  const [rows] = await pool.execute(
    `SELECT isActive FROM vendor_shipping_destinations
     WHERE vendorId = ? AND countryCode = ? AND (region IS NULL OR region = ?)
     ORDER BY region DESC LIMIT 1`,
    [vendorId, countryCode.toUpperCase(), region || null]
  );

  if (rows.length === 0) return false;
  return rows[0].isActive === 1;
};

/**
 * Get all shipping destinations for a vendor
 * @param {number} vendorId
 * @returns {Promise<Array<{countryCode: string, region: string|null, isActive: boolean}>>}
 */
export const getVendorShippingDestinations = async (vendorId) => {
  const [rows] = await pool.execute(
    `SELECT countryCode, region, isActive FROM vendor_shipping_destinations
     WHERE vendorId = ? ORDER BY countryCode, region`,
    [vendorId]
  );
  return rows;
};

/**
 * Add or update a vendor shipping destination
 * @param {number} vendorId
 * @param {string} countryCode
 * @param {string} [region]
 * @param {boolean} isActive
 * @returns {Promise<Object>}
 */
export const setVendorShippingDestination = async (vendorId, countryCode, region, isActive = true) => {
  const code = countryCode.toUpperCase();
  if (!COUNTRY_CONFIG[code]) {
    throw new Error(`Unsupported country: ${code}`);
  }

  if (region && COUNTRY_CONFIG[code].regions.length > 0) {
    if (!COUNTRY_CONFIG[code].regions.includes(region)) {
      throw new Error(`Invalid region for ${code}: ${region}`);
    }
  }

  const [result] = await pool.execute(
    `INSERT INTO vendor_shipping_destinations (vendorId, countryCode, region, isActive)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE isActive = ?, updated_at = CURRENT_TIMESTAMP`,
    [vendorId, code, region || null, isActive, isActive]
  );

  return {
    vendorId,
    countryCode: code,
    region: region || null,
    isActive,
  };
};

/**
 * Remove a vendor shipping destination
 * @param {number} vendorId
 * @param {number} destinationId
 * @returns {Promise<boolean>}
 */
export const removeVendorShippingDestination = async (vendorId, destinationId) => {
  const [result] = await pool.execute(
    `DELETE FROM vendor_shipping_destinations WHERE id = ? AND vendorId = ?`,
    [destinationId, vendorId]
  );
  return result.affectedRows > 0;
};

/**
 * Fallback shipping options from COUNTRY_CONFIG (used when DB has no rates)
 * @param {string} countryCode
 * @param {number} subtotal
 * @param {string} currency
 * @returns {Object}
 */
function getFallbackOptions(countryCode, subtotal, currency) {
  const rates = {
    GH: { standard: 15, freeThreshold: 200, transitDays: '2-5' },
    GB: { standard: 12, freeThreshold: 100, transitDays: '5-10' },
    US: { standard: 18, freeThreshold: 150, transitDays: '7-14' },
    CA: { standard: 20, freeThreshold: 180, transitDays: '7-14' },
    DE: { standard: 15, freeThreshold: 120, transitDays: '5-10' },
    NL: { standard: 14, freeThreshold: 110, transitDays: '5-10' },
  };

  const rate = rates[countryCode] || rates.GH;
  const isFree = subtotal >= rate.freeThreshold;
  const [min, max] = rate.transitDays.split('-').map(Number);

  return {
    supported: true,
    countryCode,
    currency,
    options: [{
      carrier: 'platform_default',
      carrierName: 'Standard Shipping',
      serviceLevel: 'standard',
      amount: isFree ? 0 : rate.standard,
      currency,
      transitDaysMin: min,
      transitDaysMax: max,
      freeThreshold: rate.freeThreshold,
      isFree,
    }],
  };
}