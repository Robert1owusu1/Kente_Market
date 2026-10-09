// @ts-check
// FILE LOCATION: backend/Services/shippingService.js
// DESCRIPTION: Shipping rate lookup, eligibility checking, and order weight
// calculation. Uses database-backed carrier rates and vendor destinations.
import pool from '../config/db.js';
import { COUNTRY_CONFIG } from '../controllers/internationalCheckoutController.js';

/**
 * @typedef {Object} ShippingRateInput
 * @property {string} [originCountry] - ISO country code (defaults to 'GH')
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
 * Get the active exchange rate for a currency pair on a given date.
 * Fail-closed: returns null when no rate row exists (or the stored rate is
 * not a finite positive number) so callers must refuse to quote instead of
 * converting at parity. Never returns a silently-invented rate.
 * @param {string} baseCurrency
 * @param {string} targetCurrency
 * @param {Date} [date]
 * @returns {Promise<number|null>} Rate (1 base = X target), or null when unknown
 */
export const getExchangeRate = async (baseCurrency, targetCurrency, date = new Date()) => {
  if (baseCurrency === targetCurrency) return 1;

  const effectiveDate = date.toISOString().split('T')[0];
  const [[row]] = await pool.execute(
    `SELECT rate, effectiveDate FROM exchange_rates
     WHERE baseCurrency = ? AND targetCurrency = ? AND effectiveDate <= ?
     ORDER BY effectiveDate DESC LIMIT 1`,
    [baseCurrency, targetCurrency, effectiveDate]
  );

  if (!row) {
    console.warn(`No exchange rate for ${baseCurrency} -> ${targetCurrency} on ${effectiveDate}; refusing to convert`);
    return null;
  }
  const rate = parseFloat(row.rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    console.warn(`Invalid stored exchange rate for ${baseCurrency} -> ${targetCurrency}: ${row.rate}; refusing to convert`);
    return null;
  }
  warnIfStaleRate(baseCurrency, targetCurrency, row.effectiveDate);
  return rate;
};

/**
 * Best-effort staleness warning for a stored FX row. Shipping quotes keep
 * working off the row (availability first), but a >90-day-old manual seed
 * is a pricing-drift risk the operator must see in the logs.
 * @param {string} baseCurrency
 * @param {string} targetCurrency
 * @param {any} effectiveDateValue
 */
const warnIfStaleRate = (baseCurrency, targetCurrency, effectiveDateValue) => {
  try {
    const ageDays = Math.floor((Date.now() - new Date(effectiveDateValue).getTime()) / 86400000);
    if (ageDays > 90) {
      console.warn(`Stale exchange rate for ${baseCurrency} -> ${targetCurrency}: ${effectiveDateValue} (${ageDays}d old). Refresh seeded rates; shipping is still quoted from this row.`);
    }
  } catch { /* age check is best-effort */ }
};

/**
 * Inverse-rate fallback for getExchangeRate: when no direct base->target row
 * Returns null when neither direction is available.
 * @param {string} baseCurrency
 * @param {string} targetCurrency
 * @param {Date} [date]
 * @returns {Promise<number|null>}
 */
export const getExchangeRateWithInverse = async (baseCurrency, targetCurrency, date = new Date()) => {
  const direct = await getExchangeRate(baseCurrency, targetCurrency, date);
  if (direct !== null) return direct;
  // Seeds are stored GHS->X; charges are computed in GHS, so X->GHS legs
  // resolve through the inverse of the same seeded row.
  const effectiveDate = date.toISOString().split('T')[0];
  const [[inv]] = await pool.execute(
    `SELECT rate, effectiveDate FROM exchange_rates
     WHERE baseCurrency = ? AND targetCurrency = ? AND effectiveDate <= ?
     ORDER BY effectiveDate DESC LIMIT 1`,
    [targetCurrency, baseCurrency, effectiveDate]
  );
  if (!inv) return null;
  const invRate = parseFloat(inv.rate);
  if (!Number.isFinite(invRate) || invRate <= 0) return null;
  warnIfStaleRate(targetCurrency, baseCurrency, inv.effectiveDate);
  return 1 / invRate;
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
    const weightMap = new Map(products.map((/** @type {any} */ p) => [p.id, parseFloat(p.weight) || 0]));

    for (const item of items) {
      // Only fall back to 0.5kg when the product is unknown; a stored
      // weight of 0 is a real (digital/weightless) value, not missing data.
      const weight = weightMap.has(item.productId) ? weightMap.get(item.productId) : 0.5;
      totalWeight += weight * (item.qty || 1);
    }
  } else {
    totalWeight = items.reduce((sum, i) => sum + 0.5 * (i.qty || 1), 0);
  }

  return totalWeight;
};

/**
 * Shared carrier-rate lookup: applicable, active rows for a lane, preferring
 * vendor overrides over platform defaults, cheapest first.
 * @param {object} args
 * @param {string} [args.originCountry]
 * @param {string} args.destinationCountry
 * @param {string} [args.destinationRegion]
 * @param {number|string|null} [args.vendorId]
 * @param {number} args.weightKg
 * @param {string} args.effectiveDate
 * @returns {Promise<any[]>}
 */
const queryApplicableRates = async ({ originCountry = 'GH', destinationCountry, destinationRegion, vendorId, weightKg, effectiveDate }) => {
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
  return rates;
};

/**
 * Chargeable international shipping in GHS for order creation/update.
 * Server-authoritative: the returned amount is what the order/escrow/Paystack
 * verification must book. Fail-closed — a missing FX rate, missing tables, or
 * no applicable rate refuses ({ok:false}) instead of quoting parity/domestic.
 *
 * Charges the cheapest 'standard' option when present, else the cheapest
 * option overall. The storefront shows display-currency estimates; this is
 * the GHS figure actually collected.
 *
 * @param {object} args
 * @param {string} [args.originCountry]
 * @param {string} args.destinationCountry
 * @param {string} [args.destinationRegion]
 * @param {number|string|null} [args.vendorId]
 * @param {Array<{productId: number, qty: number, weightKg?: number}>} [args.items]
 * @param {number} [args.subtotal] - order subtotal in GHS
 * @param {string} [args.displayCurrency] - destination display currency for fallback-table conversion
 * @returns {Promise<{ok: true, amountGHS: number, carrier: string, serviceLevel: string, isFree: boolean}|{ok: false, status: number, code: string, message: string}>}
 */
export const getChargeableShippingGHS = async ({
  originCountry = 'GH',
  destinationCountry,
  destinationRegion,
  vendorId = null,
  items = [],
  subtotal = 0,
  displayCurrency,
}) => {
  const code = String(destinationCountry || "").toUpperCase();
  if (!COUNTRY_CONFIG[code]) {
    return { ok: false, status: 400, code: 'UNSUPPORTED_DESTINATION', message: 'Shipping is not available to this destination' };
  }
  const destDisplay = displayCurrency || COUNTRY_CONFIG[code].currency;

  try {
    const weightKg = await calculateOrderWeight(items);
    const today = new Date();
    const effectiveDate = today.toISOString().split('T')[0];

    const rates = await queryApplicableRates({
      originCountry, destinationCountry: code, destinationRegion, vendorId, weightKg, effectiveDate,
    });

    // Candidate legs normalized to GHS: {amountGHS, thresholdGHS, carrier, serviceLevel}.
    /** @type {Array<{amountGHS: number, thresholdGHS: number|null, carrier: string, serviceLevel: string}>} */
    const legs = [];

    if (rates.length > 0) {
      for (const rate of rates) {
        let amount = parseFloat(rate.baseCost);
        if (!Number.isFinite(amount) || amount < 0) continue;
        const perKgCost = parseFloat(rate.perKgCost) || 0;
        if (weightKg > Number(rate.minWeightKg)) {
          amount += perKgCost * (weightKg - Number(rate.minWeightKg));
        }
        let amountGHS = amount;
        if (rate.currency !== 'GHS') {
          const fx = await getExchangeRateWithInverse(rate.currency, 'GHS', today);
          if (fx === null) {
            return { ok: false, status: 502, code: 'SHIPPING_FX_UNAVAILABLE', message: 'Shipping rates are temporarily unavailable for this currency' };
          }
          amountGHS = amount * fx;
        }
        let thresholdGHS = null;
        if (rate.freeThreshold !== null && rate.freeThreshold !== undefined) {
          const threshold = parseFloat(rate.freeThreshold);
          if (Number.isFinite(threshold)) {
            thresholdGHS = threshold;
            if (rate.currency !== 'GHS') {
              const fx = await getExchangeRateWithInverse(rate.currency, 'GHS', today);
              if (fx === null) {
                return { ok: false, status: 502, code: 'SHIPPING_FX_UNAVAILABLE', message: 'Shipping rates are temporarily unavailable for this currency' };
              }
              thresholdGHS = threshold * fx;
            }
          }
        }
        legs.push({
          amountGHS: Math.round(amountGHS * 100) / 100,
          thresholdGHS,
          carrier: rate.carrierCode,
          serviceLevel: rate.serviceLevel,
        });
      }
    }

    if (legs.length === 0) {
      // No DB rate rows for this lane: static fallback table (display
      // currency) converted to GHS. Documented estimates, server-computed —
      // never client-supplied. Requires a seeded FX row (inverse supported).
      const fallback = {
        GH: { standard: 15, freeThreshold: 200 },
        GB: { standard: 12, freeThreshold: 100 },
        US: { standard: 18, freeThreshold: 150 },
        CA: { standard: 20, freeThreshold: 180 },
        DE: { standard: 15, freeThreshold: 120 },
        NL: { standard: 14, freeThreshold: 110 },
      }[code] || { standard: 15, freeThreshold: 200 };
      if (destDisplay !== 'GHS') {
        const fx = await getExchangeRateWithInverse(destDisplay, 'GHS', today);
        if (fx === null) {
          return { ok: false, status: 502, code: 'SHIPPING_FX_UNAVAILABLE', message: 'Shipping rates are temporarily unavailable for this currency' };
        }
        const amountGHS = Math.round(fallback.standard * fx * 100) / 100;
        const thresholdGHS = fallback.freeThreshold * fx;
        return {
          ok: true,
          amountGHS: Number(subtotal) >= thresholdGHS ? 0 : amountGHS,
          carrier: 'platform_default',
          serviceLevel: 'standard',
          isFree: Number(subtotal) >= thresholdGHS,
        };
      }
      return {
        ok: true,
        amountGHS: Number(subtotal) >= fallback.freeThreshold ? 0 : fallback.standard,
        carrier: 'platform_default',
        serviceLevel: 'standard',
        isFree: Number(subtotal) >= fallback.freeThreshold,
      };
    }

    // Charge the cheapest standard leg when one exists, else cheapest overall.
    const standards = legs.filter(l => l.serviceLevel === 'standard');
    const pool_ = standards.length > 0 ? standards : legs;
    const cheapest = pool_.reduce((a, b) => (b.amountGHS < a.amountGHS ? b : a));
    const isFree = cheapest.thresholdGHS !== null && Number(subtotal) >= cheapest.thresholdGHS;
    return {
      ok: true,
      amountGHS: isFree ? 0 : cheapest.amountGHS,
      carrier: cheapest.carrier,
      serviceLevel: cheapest.serviceLevel,
      isFree,
    };
  } catch (err) {
    if (err && (err.code === 'ER_NO_SUCH_TABLE' || /doesn't exist/i.test(err.message || ''))) {
      // Operator has not run the shipping migrations: refuse international
      // checkout loudly instead of silently charging domestic shipping.
      return { ok: false, status: 503, code: 'SHIPPING_TABLES_MISSING', message: 'International shipping is temporarily unavailable. Please try again later.' };
    }
    throw err;
  }
};

/**
 * Get shipping options for a destination and order
 * @param {ShippingRateInput} input
 * @returns {Promise<{supported: boolean, message?: string, countryCode: string, currency: string, options: ShippingOption[], fxUnavailable?: boolean}>}
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

  let rates;
  try {
    rates = await queryApplicableRates({
      originCountry, destinationCountry, destinationRegion, vendorId, weightKg, effectiveDate,
    });
  } catch (err) {
    if (err && (err.code === 'ER_NO_SUCH_TABLE' || /doesn't exist/i.test(err.message || ''))) {
      return getFallbackOptions(destinationCountry, subtotal, currency);
    }
    throw err;
  }

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
      const rateValue = await getExchangeRateWithInverse(rate.currency, currency, today);
      if (rateValue === null) {
        // Fail-closed: a missing/invalid FX rate must never quote at parity.
        return {
          supported: false,
          message: `Shipping rates are temporarily unavailable for this currency`,
          countryCode: destinationCountry,
          currency,
          options: [],
          fxUnavailable: true,
        };
      }
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
 * @param {number|string} vendorId
 * @param {string} countryCode
 * @param {string} [region]
 * @returns {Promise<boolean>}
 */
export const checkVendorDestination = async (vendorId, countryCode, region) => {
  const code = String(countryCode || "").toUpperCase();
  if (!code) return false;
  const [rows] = await pool.execute(
    `SELECT isActive FROM vendor_shipping_destinations
     WHERE vendorId = ? AND countryCode = ?
       AND (? IS NULL OR region IS NULL OR region = ?)
     ORDER BY region DESC LIMIT 1`,
    [vendorId, code, region || null, region || null]
  );

  if (rows.length === 0) return false;
  // mysql2 may return TINYINT(1) as number 0/1, single-char Buffer, or
  // boolean depending on driver options — normalize instead of `=== 1`.
  const flag = rows[0].isActive;
  const num = typeof flag === "boolean" ? (flag ? 1 : 0)
    : Buffer.isBuffer(flag) ? Number(flag.toString())
    : Number(flag);
  return num === 1;
};

/**
 * Get all shipping destinations for a vendor
 * @param {number|string} vendorId
 * @returns {Promise<Array<{id: number, countryCode: string, region: string|null, isActive: boolean}>>}
 */
export const getVendorShippingDestinations = async (vendorId) => {
  const [rows] = await pool.execute(
    `SELECT id, countryCode, region, isActive FROM vendor_shipping_destinations
     WHERE vendorId = ? ORDER BY countryCode, region`,
    [vendorId]
  );
  // MySQL TINYINT comes back as 0/1 (or Buffer/boolean depending on driver
  // options) — normalize to real booleans so the API contract matches the
  // TypeScript types (isActive: boolean).
  const toBool = (/** @type {any} */ v) => {
    if (typeof v === "boolean") return v;
    if (Buffer.isBuffer(v)) return Number(v.toString()) === 1;
    return Number(v) === 1;
  };
  return rows.map((/** @type {any} */ r) => ({ ...r, isActive: toBool(r.isActive) }));
};

/**
 * Add or update a vendor shipping destination
 * @param {number|string} vendorId
 * @param {string} countryCode
 * @param {string} [region]
 * @param {boolean} isActive
 * @returns {Promise<Object>}
 */
export const setVendorShippingDestination = async (vendorId, countryCode, region, isActive = true) => {
  const code = String(countryCode || "").toUpperCase();
  if (!COUNTRY_CONFIG[code]) {
    throw new Error(`Unsupported country: ${code}`);
  }

  if (region && COUNTRY_CONFIG[code].regions.length > 0) {
    if (!COUNTRY_CONFIG[code].regions.includes(region)) {
      throw new Error(`Invalid region for ${code}: ${region}`);
    }
  }

  // NOTE: UNIQUE(vendorId,countryCode,region) does not deduplicate NULL
  // regions under MySQL semantics, so ON DUPLICATE KEY alone cannot upsert
  // the common (vendor, country, NULL-region) row. Update-then-insert keeps
  // exactly one row per (vendor, country, region-or-NULL).
  const normRegion = region || null;
  const [existing] = await pool.execute(
    `SELECT id FROM vendor_shipping_destinations
      WHERE vendorId = ? AND countryCode = ?
        AND ((? IS NULL AND region IS NULL) OR region = ?)
      LIMIT 1`,
    [vendorId, code, normRegion, normRegion]
  );
  if (existing.length > 0) {
    await pool.execute(
      `UPDATE vendor_shipping_destinations
          SET isActive = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [isActive, existing[0].id]
    );
  } else {
    await pool.execute(
      `INSERT INTO vendor_shipping_destinations (vendorId, countryCode, region, isActive)
       VALUES (?, ?, ?, ?)`,
      [vendorId, code, normRegion, isActive]
    );
  }

  return {
    vendorId,
    countryCode: code,
    region: region || null,
    isActive,
  };
};

/**
 * Remove a vendor shipping destination
 * @param {number|string} vendorId
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
 * @returns {{supported: boolean, message?: string, countryCode: string, currency: string, options: ShippingOption[]}}
 */
function getFallbackOptions(countryCode, subtotal, currency) {
  /** @type {Record<string, {standard: number, freeThreshold: number, transitDays: string}>} */
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