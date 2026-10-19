// @ts-check
// FILE LOCATION: backend/Services/exchangeRateService.js
// DESCRIPTION: Automatic exchange rates for international shipping.
//
// International fees may be set in GBP/USD/CAD/EUR; every order is charged in
// GHS, so those fees are converted with the newest `exchange_rates` row
// (Services/shippingService.js#toGHS). This job keeps those rows current from
// ExchangeRate-API's open access endpoint (no key, updated once a day,
// commercial use allowed with attribution — the checkout shows the
// "Rates By Exchange Rate API" link; docs: exchangerate-api.com/docs/free).
//
// Safety:
//   - Only an https source answering `result: "success"` with base GHS and a
//     finite positive rate per currency is accepted.
//   - A rate that moved more than FX_MAX_DAILY_CHANGE (default 25%) from the
//     last AUTOMATIC rate (within BASELINE_MAX_AGE_DAYS) is rejected and
//     logged; the previous row stays in force. With no recent automatic rate
//     — first run after the migration seeded rough estimates, or a long
//     outage — the baseline is the newest stored row and the looser
//     FIRST_FETCH_MAX_CHANGE applies. Measuring against the seed with the
//     daily limit would refuse a correct rate forever whenever the estimate
//     was more than 25% out.
//   - Any failure keeps the last stored rates (lookups use the newest row on
//     or before today), and shipping lookups already warn on stale rows.
//   - Never runs when NODE_ENV=test or FX_AUTO_UPDATE=false.
import pool from '../config/db.js';

const DEFAULT_URL = 'https://open.er-api.com/v6/latest/GHS';
export const FX_SOURCE = 'exchangerate-api';
export const FX_TARGETS = Object.freeze(['GBP', 'USD', 'CAD', 'EUR']);

const maxChange = () => {
  const n = Number(process.env.FX_MAX_DAILY_CHANGE);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.25;
};

// Only a recent automatic rate is a trustworthy day-to-day baseline.
const BASELINE_MAX_AGE_DAYS = 7;
// Against an estimate or a stale rate: still refuse an obviously broken answer.
const FIRST_FETCH_MAX_CHANGE = 0.6;

export const isFxAutoUpdateEnabled = () =>
  process.env.FX_AUTO_UPDATE !== 'false' && process.env.NODE_ENV !== 'test';

/**
 * Latest stored GHS->target rate on or before `day`, or null.
 * @param {string} target
 * @param {string} day - YYYY-MM-DD
 * @param {string} [source] - only rows from this source (default: any)
 * @returns {Promise<{rate: number, effectiveDate: string, source: string}|null>}
 */
const latestStored = async (target, day, source) => {
  const [rows] = /** @type {[any[], any]} */ (await pool.execute(
    `SELECT rate, effectiveDate, source FROM exchange_rates
     WHERE baseCurrency = 'GHS' AND targetCurrency = ? AND effectiveDate <= ?${source ? ' AND source = ?' : ''}
     ORDER BY effectiveDate DESC LIMIT 1`,
    source ? [target, day, source] : [target, day]
  ));
  if (!rows[0]) return null;
  const rate = Number(rows[0].rate);
  // mysql2 returns a DATE as a local-midnight Date; format it as the
  // calendar day it is (toISOString could shift it a day in UTC+ zones).
  const d = rows[0].effectiveDate;
  const effectiveDate = d instanceof Date
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : String(d).slice(0, 10);
  return Number.isFinite(rate) && rate > 0 ? { rate, effectiveDate, source: rows[0].source } : null;
};

/** @param {string} from @param {string} to - YYYY-MM-DD */
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/**
 * Fetch today's GHS rates and store them.
 * @param {{ fetchImpl?: typeof fetch, force?: boolean, date?: Date }} [opts] `date` is the
 *   effective date to store (tests use a far-future date so concurrent suites
 *   pricing at today's rates are unaffected).
 * @returns {Promise<{skipped?: string, updated: string[], rejected: Array<{currency: string, reason: string}>}>}
 */
export const refreshExchangeRates = async ({ fetchImpl = fetch, force = false, date = new Date() } = {}) => {
  if (!force && !isFxAutoUpdateEnabled()) return { skipped: 'disabled', updated: [], rejected: [] };

  const url = (process.env.FX_RATES_URL || DEFAULT_URL).trim();
  if (!/^https:\/\//.test(url)) throw new Error('FX_RATES_URL must be an https URL');

  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!res.ok) throw new Error(`exchange rate source answered HTTP ${res.status}`);
  const body = /** @type {any} */ (await res.json());
  if (body?.result !== 'success' || body?.base_code !== 'GHS' || !body?.rates || typeof body.rates !== 'object') {
    throw new Error('exchange rate source returned an unexpected payload');
  }

  const today = date.toISOString().split('T')[0];
  /** @type {string[]} */
  const updated = [];
  /** @type {Array<{currency: string, reason: string}>} */
  const rejected = [];
  for (const target of FX_TARGETS) {
    const rate = Number(body.rates[target]);
    if (!Number.isFinite(rate) || rate <= 0) {
      rejected.push({ currency: target, reason: 'missing or invalid in source' });
      continue;
    }
    const auto = await latestStored(target, today, FX_SOURCE);
    const recentAuto = auto && daysBetween(auto.effectiveDate, today) <= BASELINE_MAX_AGE_DAYS ? auto : null;
    const prev = recentAuto || await latestStored(target, today);
    const limit = recentAuto ? maxChange() : FIRST_FETCH_MAX_CHANGE;
    if (prev && Math.abs(rate / prev.rate - 1) > limit) {
      rejected.push({ currency: target, reason: `moved ${(Math.abs(rate / prev.rate - 1) * 100).toFixed(1)}% from ${prev.rate} (limit ${Math.round(limit * 100)}%)` });
      continue;
    }
    await pool.execute(
      `INSERT INTO exchange_rates (baseCurrency, targetCurrency, rate, source, effectiveDate)
       VALUES ('GHS', ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rate = VALUES(rate), source = VALUES(source)`,
      [target, Math.round(rate * 1e6) / 1e6, FX_SOURCE, today]
    );
    updated.push(target);
  }
  if (rejected.length) {
    console.warn(`[fx] rates not updated (previous rates kept): ${rejected.map((r) => `${r.currency}: ${r.reason}`).join('; ')}`);
  }
  return { updated, rejected };
};

/**
 * Current rate per currency for the admin dashboard.
 * @param {Date} [date]
 * @returns {Promise<Array<{currency: string, rate: number|null, perUnitGHS: number|null, effectiveDate: string|null, source: string|null, ageDays: number|null}>>}
 */
export const getExchangeRateStatus = async (date = new Date()) => {
  const day = date.toISOString().split('T')[0];
  const out = [];
  for (const target of FX_TARGETS) {
    const row = await latestStored(target, day);
    const ageDays = row ? Math.max(0, Math.floor((date.getTime() - new Date(`${row.effectiveDate}T00:00:00`).getTime()) / 86400000)) : null;
    out.push({
      currency: target,
      rate: row ? row.rate : null,
      perUnitGHS: row ? Math.round((1 / row.rate) * 100) / 100 : null,
      effectiveDate: row ? row.effectiveDate : null,
      source: row ? row.source : null,
      ageDays,
    });
  }
  return out;
};
