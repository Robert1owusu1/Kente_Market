// @ts-check
// FILE LOCATION: backend/Services/shippingService.js
// DESCRIPTION: Shipping rate lookup, eligibility checking, and order weight
// calculation. Uses database-backed carrier rates and vendor destinations.
import pool from '../config/db.js';
import { COUNTRY_CONFIG } from '../controllers/internationalCheckoutController.js';
import { FREE_SHIPPING_THRESHOLD, STANDARD_SHIPPING_COST } from '../../shared/pricing.js';

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

/** Rate rows older than this are a pricing-drift risk (see staleness handling). */
const STALE_RATE_DAYS = 90;

/**
 * Static fallback shipping table used when the lane has NO `shipping_rates`
 * rows (tables themselves must exist — a missing migration never falls back).
 * Values are denominated in the DESTINATION DISPLAY currency (GHS for GH,
 * GBP for GB, USD for US, ...) and are converted to GHS with toGHS() before
 * any comparison. Documentation-only estimates: no live carrier or FX feed.
 * @type {Record<string, {standard: number, freeThreshold: number, transitDays: string}>}
 */
const FALLBACK_RATES = {
  GH: { standard: 15, freeThreshold: 200, transitDays: '2-5' },
  GB: { standard: 12, freeThreshold: 100, transitDays: '5-10' },
  US: { standard: 18, freeThreshold: 150, transitDays: '7-14' },
  CA: { standard: 20, freeThreshold: 180, transitDays: '7-14' },
  DE: { standard: 15, freeThreshold: 120, transitDays: '5-10' },
  NL: { standard: 14, freeThreshold: 110, transitDays: '5-10' },
};

/** Customer-facing messages: never carry SQL/driver text (req: no internal leaks). */
const MSG_TABLES_MISSING = 'International shipping is temporarily unavailable. Please try again later.';
const MSG_FX_UNAVAILABLE = 'Shipping rates are temporarily unavailable for this currency';

/**
 * A migration that was never run must be told apart from "no rate for this
 * lane" and from a genuine server error — MySQL/TiDB both report it this way.
 * @param {any} err
 * @returns {boolean}
 */
export const isMissingTableError = (err) =>
  Boolean(err && (err.code === 'ER_NO_SUCH_TABLE' || /doesn't exist/i.test(String(err.message || ''))));

/**
 * Server-side only: name the missing table so the operator can fix it. The
 * customer only ever sees MSG_TABLES_MISSING.
 * @param {any} err
 */
const logMissingTable = (err) => {
  console.warn(`[shipping] required shipping/FX table missing: ${err.message}. Run \`npm run db:migrate\` (backend) before enabling international checkout.`);
};

/**
 * Best-effort staleness check for a stored FX row. Shipping quotes keep
 * working off the row (availability first), but a >90-day-old manual seed
 * is a pricing-drift risk the operator must see in the logs — and callers
 * can surface it as a warning instead of silently pretending it is fresh.
 * @param {string} baseCurrency
 * @param {string} targetCurrency
 * @param {any} effectiveDateValue
 * @returns {boolean} true when the row is older than STALE_RATE_DAYS
 */
const warnIfStaleRate = (baseCurrency, targetCurrency, effectiveDateValue) => {
  try {
    const ageDays = Math.floor((Date.now() - new Date(effectiveDateValue).getTime()) / 86400000);
    if (ageDays > STALE_RATE_DAYS) {
      console.warn(`Stale exchange rate for ${baseCurrency} -> ${targetCurrency}: ${effectiveDateValue} (${ageDays}d old). Refresh seeded rates; shipping is still quoted from this row.`);
      return true;
    }
  } catch { /* age check is best-effort */ }
  return false;
};

/**
 * @typedef {Object} RateMeta
 * @property {number} rate - 1 base = X target
 * @property {boolean} stale - stored row is older than STALE_RATE_DAYS
 * @property {string|null} effectiveDate
 */

/**
 * Row-level lookup with metadata. Fail-closed: returns null when no rate row
 * exists (or the stored rate is not a finite positive number) so callers must
 * refuse to quote instead of converting at parity. Never invents a rate.
 * Does NOT log the "no row" case itself — the caller decides, because an
 * inverse row may still resolve the pair (logging "refusing" and then
 * converting via the inverse was pure alarm fatigue).
 * @param {string} baseCurrency
 * @param {string} targetCurrency
 * @param {Date} [date]
 * @returns {Promise<RateMeta|null>}
 */
const lookupRateRow = async (baseCurrency, targetCurrency, date = new Date()) => {
  if (baseCurrency === targetCurrency) return { rate: 1, stale: false, effectiveDate: null };

  const effectiveDate = date.toISOString().split('T')[0];
  const [[row]] = await pool.execute(
    `SELECT rate, effectiveDate FROM exchange_rates
     WHERE baseCurrency = ? AND targetCurrency = ? AND effectiveDate <= ?
     ORDER BY effectiveDate DESC LIMIT 1`,
    [baseCurrency, targetCurrency, effectiveDate]
  );

  if (!row) return null;
  const rate = parseFloat(row.rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    console.warn(`Invalid stored exchange rate for ${baseCurrency} -> ${targetCurrency}: ${row.rate}; refusing to convert`);
    return null;
  }
  const stale = warnIfStaleRate(baseCurrency, targetCurrency, row.effectiveDate);
  return { rate, stale, effectiveDate: row.effectiveDate ? String(row.effectiveDate) : null };
};

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
  const meta = await lookupRateRow(baseCurrency, targetCurrency, date);
  if (!meta) {
    console.warn(`No exchange rate for ${baseCurrency} -> ${targetCurrency} on ${date.toISOString().split('T')[0]}; refusing to convert`);
  }
  return meta ? meta.rate : null;
};

/**
 * Inverse-rate lookup with metadata: direct base->target row first, then the
 * inverse of the stored target->base row (seeds are GHS->X; charges are
 * computed in GHS, so X->GHS legs resolve through that same row).
 * Returns null when neither direction is available.
 * @param {string} baseCurrency
 * @param {string} targetCurrency
 * @param {Date} [date]
 * @returns {Promise<RateMeta|null>}
 */
const getExchangeRateWithInverseMeta = async (baseCurrency, targetCurrency, date = new Date()) => {
  const direct = await lookupRateRow(baseCurrency, targetCurrency, date);
  if (direct !== null) return direct;

  const inv = await lookupRateRow(targetCurrency, baseCurrency, date);
  if (inv === null) {
    console.warn(`No exchange rate for ${baseCurrency} -> ${targetCurrency} (nor the inverse) on ${date.toISOString().split('T')[0]}; refusing to convert`);
    return null;
  }
  return { rate: 1 / inv.rate, stale: inv.stale, effectiveDate: inv.effectiveDate };
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
  const meta = await getExchangeRateWithInverseMeta(baseCurrency, targetCurrency, date);
  return meta ? meta.rate : null;
};

/**
 * Convert an amount into GHS — THE comparison currency for every shipping
 * threshold and every booked shipping charge. Quote and booking both go
 * through this one function so they can never disagree about currency.
 * Fail-closed: returns null when the required rate row is missing/invalid.
 * @param {number} amount
 * @param {string} fromCurrency - currency the amount is denominated in
 * @param {Date} [date]
 * @returns {Promise<{amountGHS:number, stale:boolean}|null>}
 */
const toGHS = async (amount, fromCurrency, date = new Date()) => {
  if (fromCurrency === 'GHS') return { amountGHS: amount, stale: false };
  const meta = await getExchangeRateWithInverseMeta(fromCurrency, 'GHS', date);
  if (meta === null) return null;
  return { amountGHS: amount * meta.rate, stale: meta.stale };
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
 * Shared carrier-rate lookup: applicable, active rows for a lane. A vendor's
 * OWN rows for the lane replace the platform defaults entirely (a seller who
 * sets a fee for a country is charged that fee, not whichever of theirs and
 * the platform's is cheaper); with none, the platform defaults apply.
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
  if (vendorId) {
    const own = rates.filter((/** @type {any} */ r) => r.vendorId != null && Number(r.vendorId) === Number(vendorId));
    if (own.length > 0) return own;
    return rates.filter((/** @type {any} */ r) => r.vendorId == null);
  }
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
 * @returns {Promise<{ok: true, amountGHS: number, carrier: string, serviceLevel: string, isFree: boolean, staleRate: boolean, freeThresholdGHS: number|null}|{ok: false, status: number, code: string, message: string}>}
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
    // EVERY amount and EVERY free-shipping threshold is converted to GHS with
    // toGHS() — the single conversion used by the quote path too (req: quote
    // and booking must apply the same business rule in the same currency).
    /** @type {Array<{amountGHS: number, thresholdGHS: number|null, carrier: string, serviceLevel: string}>} */
    const legs = [];
    let staleRate = false;
    /** @param {string} value */
    const fxUnavailable = (value) => ({
      ok: /** @type {false} */ (false),
      status: 502,
      code: 'SHIPPING_FX_UNAVAILABLE',
      message: value,
    });

    if (rates.length > 0) {
      for (const rate of rates) {
        let amount = parseFloat(rate.baseCost);
        if (!Number.isFinite(amount) || amount < 0) continue;
        const perKgCost = parseFloat(rate.perKgCost) || 0;
        if (weightKg > Number(rate.minWeightKg)) {
          amount += perKgCost * (weightKg - Number(rate.minWeightKg));
        }
        const amountConv = await toGHS(amount, rate.currency, today);
        if (amountConv === null) return fxUnavailable(MSG_FX_UNAVAILABLE);
        staleRate = staleRate || amountConv.stale;

        let thresholdGHS = null;
        if (rate.freeThreshold !== null && rate.freeThreshold !== undefined) {
          const threshold = parseFloat(rate.freeThreshold);
          if (Number.isFinite(threshold)) {
            const thresholdConv = await toGHS(threshold, rate.currency, today);
            if (thresholdConv === null) return fxUnavailable(MSG_FX_UNAVAILABLE);
            staleRate = staleRate || thresholdConv.stale;
            thresholdGHS = thresholdConv.amountGHS;
          }
        }
        legs.push({
          amountGHS: Math.round(amountConv.amountGHS * 100) / 100,
          thresholdGHS,
          carrier: rate.carrierCode,
          serviceLevel: rate.serviceLevel,
        });
      }
    }

    if (legs.length === 0) {
      // No DB rate rows for this lane: static fallback table. The numbers are
      // denominated in the destination DISPLAY currency (the same table the
      // quote path uses) and are converted to GHS with toGHS() before any
      // comparison — never compared against the GHS subtotal raw.
      // Documented estimates, server-computed — never client-supplied.
      const fallback = FALLBACK_RATES[code] || FALLBACK_RATES.GH;
      const amountConv = await toGHS(fallback.standard, destDisplay, today);
      const thresholdConv = await toGHS(fallback.freeThreshold, destDisplay, today);
      if (amountConv === null || thresholdConv === null) return fxUnavailable(MSG_FX_UNAVAILABLE);
      staleRate = amountConv.stale || thresholdConv.stale;
      const isFree = Number(subtotal) >= thresholdConv.amountGHS;
      return {
        ok: true,
        amountGHS: isFree ? 0 : Math.round(amountConv.amountGHS * 100) / 100,
        carrier: 'platform_default',
        serviceLevel: 'standard',
        isFree,
        staleRate,
        freeThresholdGHS: Math.round(thresholdConv.amountGHS * 100) / 100,
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
      staleRate,
      freeThresholdGHS: cheapest.thresholdGHS === null ? null : Math.round(cheapest.thresholdGHS * 100) / 100,
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      // Operator has not run the shipping/FX migrations: refuse international
      // checkout loudly instead of silently charging domestic shipping.
      logMissingTable(err);
      return { ok: false, status: 503, code: 'SHIPPING_TABLES_MISSING', message: MSG_TABLES_MISSING };
    }
    throw err;
  }
};

/**
 * Shipping for a whole order: every seller ships their own parcel, so each
 * seller group (and the platform's own products as one group) is charged its
 * own fee, resolved by getChargeableShippingGHS (seller's rate for the
 * country, else the platform default, else the fallback table), with that
 * group's subtotal tested against its free-shipping threshold. The order is
 * charged the sum. Quote and booking both call this, so they cannot differ.
 *
 * Ghana keeps working if the shipping tables are missing: the domestic flat
 * rule (shared/pricing.js) is the same GHS 15 / free from GHS 200 the seeded
 * platform row holds. International destinations stay fail-closed.
 *
 * @param {object} args
 * @param {string} args.destinationCountry
 * @param {string|null} [args.destinationRegion]
 * @param {Array<{vendorId: number|string|null, items: Array<{productId: number, qty: number}>, subtotalGHS: number}>} args.groups
 * @returns {Promise<{ok: true, amountGHS: number, groups: Array<{vendorId: number|null, amountGHS: number, isFree: boolean, freeThresholdGHS: number|null, subtotalGHS: number}>}|{ok: false, status: number, code: string, message: string}>}
 */
export const getOrderShippingGHS = async ({ destinationCountry, destinationRegion = null, groups }) => {
  const code = String(destinationCountry || '').toUpperCase();
  /** @type {Array<{vendorId: number|null, amountGHS: number, isFree: boolean, freeThresholdGHS: number|null, subtotalGHS: number}>} */
  const out = [];
  let total = 0;
  for (const g of groups) {
    const subtotalGHS = Math.round((Number(g.subtotalGHS) || 0) * 100) / 100;
    const ship = await getChargeableShippingGHS({
      destinationCountry: code,
      destinationRegion: destinationRegion || undefined,
      vendorId: g.vendorId ?? null,
      items: g.items,
      subtotal: subtotalGHS,
    });
    if (!ship.ok) {
      if (code === 'GH' && ship.code === 'SHIPPING_TABLES_MISSING') {
        const isFree = subtotalGHS >= FREE_SHIPPING_THRESHOLD;
        const amountGHS = isFree ? 0 : STANDARD_SHIPPING_COST;
        out.push({ vendorId: g.vendorId == null ? null : Number(g.vendorId), amountGHS, isFree, freeThresholdGHS: FREE_SHIPPING_THRESHOLD, subtotalGHS });
        total += amountGHS;
        continue;
      }
      return ship;
    }
    out.push({ vendorId: g.vendorId == null ? null : Number(g.vendorId), amountGHS: ship.amountGHS, isFree: ship.isFree, freeThresholdGHS: ship.freeThresholdGHS, subtotalGHS });
    total += ship.amountGHS;
  }
  return { ok: true, amountGHS: Math.round(total * 100) / 100, groups: out };
};

/**
 * Split order lines into per-seller groups for getOrderShippingGHS.
 * @param {Array<{vendorId?: any, productId: number, qty: number, price: number}>} lines
 */
export const groupLinesByVendor = (lines) => {
  /** @type {Map<string, {vendorId: number|null, items: Array<{productId: number, qty: number}>, subtotalGHS: number}>} */
  const groups = new Map();
  for (const l of lines) {
    const vendorId = l.vendorId == null ? null : Number(l.vendorId);
    const key = vendorId == null ? 'platform' : String(vendorId);
    if (!groups.has(key)) groups.set(key, { vendorId, items: [], subtotalGHS: 0 });
    const g = /** @type {{vendorId: number|null, items: Array<{productId: number, qty: number}>, subtotalGHS: number}} */ (groups.get(key));
    const qty = Math.max(1, Number(l.qty) || 1);
    g.items.push({ productId: Number(l.productId), qty });
    g.subtotalGHS += (Number(l.price) || 0) * qty;
  }
  return [...groups.values()];
};

/**
 * Fail-closed payload: the migration that creates `shipping_rates` /
 * `shipping_carriers` / `vendor_shipping_destinations` / `exchange_rates`
 * was never run. MUST NOT be answered with static fallback options — a
 * missing migration may never look like a successful quote (the booking path
 * refuses the same order with 503, so a 200 here would quote a total that
 * order creation then rejects).
 * @param {string} destinationCountry
 * @param {string} currency
 */
const tablesMissingResult = (destinationCountry, currency) => ({
  supported: /** @type {false} */ (false),
  code: 'SHIPPING_TABLES_MISSING',
  status: 503,
  message: MSG_TABLES_MISSING,
  countryCode: destinationCountry,
  currency,
  options: /** @type {any[]} */ ([]),
});

/**
 * Fail-closed payload: the FX TABLE exists but the required rate row is
 * missing or invalid. Distinct from 503 so operators can tell "run the
 * migration" from "seed/refresh the rate".
 * @param {string} destinationCountry
 * @param {string} currency
 */
const fxUnavailableResult = (destinationCountry, currency) => ({
  supported: /** @type {false} */ (false),
  code: 'SHIPPING_FX_UNAVAILABLE',
  status: 502,
  message: MSG_FX_UNAVAILABLE,
  countryCode: destinationCountry,
  currency,
  fxUnavailable: true,
  options: /** @type {any[]} */ ([]),
});

/**
 * Get shipping options for a destination and cart — the QUOTE path.
 *
 * Currency contract (identical to the booking path, `getChargeableShippingGHS`):
 *  - `input.subtotal` is the cart subtotal in **GHS** (the charge currency,
 *    computed by shared/pricing.js) — never a display-currency figure.
 *  - `input.currency` is the destination **display** currency (GBP/USD/...).
 *  - rate rows carry their own `shipping_rates.currency`; the static fallback
 *    table is denominated in the destination display currency. Amounts and
 *    free-shipping thresholds from either source are converted to GHS with
 *    `toGHS()` before they are compared with the subtotal or returned as
 *    `amountGHS`.
 *  - `amount` / `freeThreshold` are display-currency figures for the UI;
 *    `amountGHS` / `freeThresholdGHS` are the figures order creation books.
 *
 * Fail-closed: missing migration table → 503 `SHIPPING_TABLES_MISSING`;
 * missing/invalid FX row → 502 `SHIPPING_FX_UNAVAILABLE`. Neither is ever
 * disguised as a successful quote, and no driver error escapes as an opaque
 * 500.
 *
 * @param {ShippingRateInput} input
 * @returns {Promise<{supported: boolean, message?: string, code?: string, status?: number, countryCode: string, currency: string, options: ShippingOption[], fxUnavailable?: boolean, warnings?: string[]}>}
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

  // The storefront sends the GHS cart subtotal; that is the only value a
  // threshold may be compared against (req: one consistent currency).
  const subtotalGHS = Number(subtotal) || 0;
  const today = new Date();

  try {
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
    const effectiveDate = today.toISOString().split('T')[0];

    const rates = await queryApplicableRates({
      originCountry, destinationCountry, destinationRegion, vendorId, weightKg, effectiveDate,
    });

    // Tables exist but this lane has no rows → documented static fallback
    // (converted to GHS below). A MISSING table never reaches this branch.
    if (rates.length === 0) {
      return await getFallbackOptions(destinationCountry, subtotalGHS, currency, today);
    }

    const warnings = new Set();
    const options = [];
    for (const rate of rates) {
      let raw = parseFloat(rate.baseCost);
      if (!Number.isFinite(raw) || raw < 0) continue;
      const perKgCost = parseFloat(rate.perKgCost) || 0;
      if (weightKg > Number(rate.minWeightKg)) {
        raw += perKgCost * (weightKg - Number(rate.minWeightKg));
      }

      // Display-currency figure for the storefront (display only).
      let displayAmount = raw;
      if (rate.currency !== currency) {
        const rateValue = await getExchangeRateWithInverse(rate.currency, currency, today);
        if (rateValue === null) {
          // Fail-closed: a missing/invalid FX rate must never quote at parity.
          return fxUnavailableResult(destinationCountry, currency);
        }
        displayAmount = raw * rateValue;
      }

      // Charge-currency figure — same conversion the booking path books.
      const amountConv = await toGHS(raw, rate.currency, today);
      if (amountConv === null) return fxUnavailableResult(destinationCountry, currency);
      if (amountConv.stale) warnings.add('STALE_EXCHANGE_RATE');

      // Free-shipping threshold, normalized to GHS before ANY comparison.
      /** @type {number|null} */
      let freeThreshold = null;
      /** @type {number|null} */
      let freeThresholdGHS = null;
      const parsedThreshold = rate.freeThreshold ? parseFloat(rate.freeThreshold) : null;
      if (parsedThreshold !== null && Number.isFinite(parsedThreshold)) {
        const thresholdConv = await toGHS(parsedThreshold, rate.currency, today);
        if (thresholdConv === null) return fxUnavailableResult(destinationCountry, currency);
        if (thresholdConv.stale) warnings.add('STALE_EXCHANGE_RATE');
        freeThreshold = parsedThreshold;
        freeThresholdGHS = thresholdConv.amountGHS;
      }

      // F-7 fix: GHS subtotal vs GHS threshold (was: raw GHS vs the rate
      // currency's threshold, which made quote(GB,100) report free shipping
      // while order creation charged 222.22 GHS for the same cart).
      const isFree = freeThresholdGHS !== null && subtotalGHS >= freeThresholdGHS;

      options.push({
        carrier: rate.carrierCode,
        carrierName: rate.carrierName,
        serviceLevel: rate.serviceLevel,
        amount: isFree ? 0 : Math.round(displayAmount * 100) / 100,
        amountGHS: isFree ? 0 : Math.round(amountConv.amountGHS * 100) / 100,
        currency,
        rateCurrency: rate.currency,
        transitDaysMin: rate.transitDaysMin,
        transitDaysMax: rate.transitDaysMax,
        freeThreshold,
        freeThresholdGHS,
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
      warnings: Array.from(warnings),
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      logMissingTable(err);
      return tablesMissingResult(destinationCountry, currency);
    }
    throw err;
  }
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
 * Fallback shipping options from the static table — used only when the
 * shipping tables EXIST but this lane has no `shipping_rates` rows. A missing
 * migration never reaches this function (it returns 503 instead).
 *
 * The table's numbers are denominated in the destination DISPLAY currency;
 * both the amount and the free-shipping threshold are converted to GHS with
 * toGHS() — the same conversion and the same comparison the booking path uses,
 * so quote and booking can never disagree about free shipping.
 *
 * @param {string} countryCode
 * @param {number} subtotalGHS - cart subtotal in GHS (charge currency)
 * @param {string} currency - destination display currency
 * @param {Date} [date]
 * @returns {Promise<{supported: boolean, message?: string, code?: string, status?: number, countryCode: string, currency: string, options: any[], fxUnavailable?: boolean, warnings?: string[]}>}
 */
async function getFallbackOptions(countryCode, subtotalGHS, currency, date = new Date()) {
  const rate = FALLBACK_RATES[countryCode] || FALLBACK_RATES.GH;
  const displayCurrency = COUNTRY_CONFIG[countryCode]?.currency || currency;
  const warnings = new Set();

  const amountConv = await toGHS(rate.standard, displayCurrency, date);
  const thresholdConv = await toGHS(rate.freeThreshold, displayCurrency, date);
  if (amountConv === null || thresholdConv === null) {
    return fxUnavailableResult(countryCode, currency);
  }
  if (amountConv.stale || thresholdConv.stale) warnings.add('STALE_EXCHANGE_RATE');

  const isFree = subtotalGHS >= thresholdConv.amountGHS;
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
      amountGHS: isFree ? 0 : Math.round(amountConv.amountGHS * 100) / 100,
      currency,
      rateCurrency: displayCurrency,
      transitDaysMin: min,
      transitDaysMax: max,
      freeThreshold: rate.freeThreshold,
      freeThresholdGHS: thresholdConv.amountGHS,
      isFree,
    }],
    warnings: Array.from(warnings),
  };
}
// ---------------------------------------------------------------------------
// Fee management: the platform's default price list (vendorId NULL) and each
// seller's own overrides (vendorId = seller). One active 'standard' rate per
// owner per destination country; setting a new one retires the previous row
// (kept for history) instead of editing it in place.
// ---------------------------------------------------------------------------

/** @param {any} v @param {number} min @param {number} max */
const boundedMoney = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : null;
};
/** @param {any} v @param {number} min @param {number} max */
const boundedInt = (v, min, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** Active carriers, for the fee forms. */
export const listShippingCarriers = async () => {
  const [rows] = await pool.execute(
    `SELECT code, name, supportedCountries FROM shipping_carriers WHERE isActive = TRUE ORDER BY name`
  );
  return rows.map((/** @type {any} */ r) => ({
    code: r.code,
    name: r.name,
    countries: typeof r.supportedCountries === 'string' ? JSON.parse(r.supportedCountries) : (r.supportedCountries || []),
  }));
};

/**
 * Active standard rates of one owner (null = platform defaults).
 * @param {number|null} vendorId
 */
export const listShippingRates = async (vendorId) => {
  const [rows] = await pool.execute(
    `SELECT sr.destinationCountry AS countryCode, sr.baseCost, sr.perKgCost, sr.freeThreshold, sr.currency,
            sr.transitDaysMin, sr.transitDaysMax, sr.effectiveFrom, c.code AS carrierCode, c.name AS carrierName
     FROM shipping_rates sr JOIN shipping_carriers c ON c.id = sr.carrierId
     WHERE sr.vendorId <=> ? AND sr.originCountry = 'GH' AND sr.destinationRegion IS NULL
       AND sr.serviceLevel = 'standard' AND sr.isActive = TRUE
       AND (sr.effectiveTo IS NULL OR sr.effectiveTo >= CURDATE())
     ORDER BY sr.destinationCountry, sr.baseCost`,
    [vendorId]
  );
  return rows.map((/** @type {any} */ r) => ({
    countryCode: r.countryCode,
    baseCost: Number(r.baseCost),
    perKgCost: Number(r.perKgCost) || 0,
    freeThreshold: r.freeThreshold === null ? null : Number(r.freeThreshold),
    currency: r.currency,
    transitDaysMin: r.transitDaysMin,
    transitDaysMax: r.transitDaysMax,
    carrierCode: r.carrierCode,
    carrierName: r.carrierName,
  }));
};

/**
 * Validate and set an owner's standard rate for one destination country.
 * Ghana fees are in GHS; abroad, GHS or the destination's own currency.
 * @param {number|null} vendorId - null = platform default
 * @param {string} countryCode
 * @param {any} input
 * @returns {Promise<{ok: true, rate: any}|{ok: false, message: string}>}
 */
export const setStandardShippingRate = async (vendorId, countryCode, input = {}) => {
  const code = String(countryCode || '').toUpperCase();
  const country = COUNTRY_CONFIG[code];
  if (!country) return { ok: false, message: 'Unsupported country' };

  const currency = String(input.currency || (code === 'GH' ? 'GHS' : country.currency)).toUpperCase();
  const allowedCurrencies = code === 'GH' ? ['GHS'] : ['GHS', country.currency];
  if (!allowedCurrencies.includes(currency)) {
    return { ok: false, message: `Currency must be ${allowedCurrencies.join(' or ')} for ${code}` };
  }
  const baseCost = boundedMoney(input.baseCost, 0, 100000);
  if (baseCost === null) return { ok: false, message: 'Fee must be a number between 0 and 100000' };
  const perKgCost = input.perKgCost === undefined || input.perKgCost === null || input.perKgCost === ''
    ? 0 : boundedMoney(input.perKgCost, 0, 10000);
  if (perKgCost === null) return { ok: false, message: 'Per-kg fee must be between 0 and 10000' };
  let freeThreshold = null;
  if (input.freeThreshold !== undefined && input.freeThreshold !== null && input.freeThreshold !== '') {
    freeThreshold = boundedMoney(input.freeThreshold, 0, 10000000);
    if (freeThreshold === null) return { ok: false, message: 'Free-delivery amount must be a positive number' };
  }
  const transitDaysMin = boundedInt(input.transitDaysMin, 0, 120);
  const transitDaysMax = boundedInt(input.transitDaysMax, 0, 180);
  if (transitDaysMin === null || transitDaysMax === null || transitDaysMax < transitDaysMin) {
    return { ok: false, message: 'Delivery days must be whole numbers, with max not below min' };
  }

  const carriers = await listShippingCarriers();
  const carrierCode = String(input.carrierCode || (code === 'GH' ? 'local_gh' : 'ems'));
  const carrier = carriers.find((/** @type {any} */ c) => c.code === carrierCode);
  if (!carrier || !carrier.countries.includes(code)) {
    return { ok: false, message: `Carrier ${carrierCode} does not deliver to ${code}` };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE shipping_rates SET isActive = FALSE, effectiveTo = CURDATE()
       WHERE vendorId <=> ? AND originCountry = 'GH' AND destinationCountry = ?
         AND destinationRegion IS NULL AND serviceLevel = 'standard' AND isActive = TRUE`,
      [vendorId, code]
    );
    await conn.execute(
      `INSERT INTO shipping_rates
         (carrierId, vendorId, originCountry, destinationCountry, destinationRegion, serviceLevel,
          minWeightKg, maxWeightKg, baseCost, perKgCost, freeThreshold, transitDaysMin, transitDaysMax,
          currency, effectiveFrom, effectiveTo, isActive)
       SELECT id, ?, 'GH', ?, NULL, 'standard', 0, 999, ?, ?, ?, ?, ?, ?, CURDATE(), NULL, TRUE
       FROM shipping_carriers WHERE code = ?`,
      [vendorId, code, baseCost, perKgCost, freeThreshold, transitDaysMin, transitDaysMax, currency, carrierCode]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
  return {
    ok: true,
    rate: { countryCode: code, baseCost, perKgCost, freeThreshold, currency, transitDaysMin, transitDaysMax, carrierCode, carrierName: carrier.name },
  };
};

/**
 * Remove an owner's rate for a country. A seller then falls back to the
 * platform default; the platform then falls back to the built-in table.
 * @param {number|null} vendorId
 * @param {string} countryCode
 * @returns {Promise<boolean>} whether a rate was active
 */
export const removeStandardShippingRate = async (vendorId, countryCode) => {
  const code = String(countryCode || '').toUpperCase();
  if (!COUNTRY_CONFIG[code]) return false;
  const [result] = /** @type {[any, any]} */ (await pool.execute(
    `UPDATE shipping_rates SET isActive = FALSE, effectiveTo = CURDATE()
     WHERE vendorId <=> ? AND originCountry = 'GH' AND destinationCountry = ?
       AND destinationRegion IS NULL AND serviceLevel = 'standard' AND isActive = TRUE`,
    [vendorId, code]
  ));
  return result.affectedRows > 0;
};
