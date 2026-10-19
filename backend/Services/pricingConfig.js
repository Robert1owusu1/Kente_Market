// @ts-check
// FILE LOCATION: backend/Services/pricingConfig.js
// DESCRIPTION: Money settings the admin controls, read from the `settings`
//              table instead of being hard-coded:
//                tax_rate                VAT in percent (Admin -> Settings)
//                referral.minWithdrawal  minimum referral withdrawal, GHS (Admin -> Referrals)
//              Seeded by migratePricingSettings.js. Cached for 30 s so a busy
//              checkout does not query on every order; an admin change takes
//              effect within that window (clearPricingConfigCache() on save).
//
//              Fail-closed: a missing or invalid value throws
//              PricingConfigError instead of falling back to a guessed number,
//              so checkout stops (503) rather than charging the wrong VAT.
import pool from '../config/db.js';

const TTL_MS = 30 * 1000;
/** @type {{ at: number, values: Record<string, string> } | null} */
let cache = null;

export class PricingConfigError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'PricingConfigError';
    this.status = 503;
    this.publicMessage = 'Checkout is temporarily unavailable. Please try again shortly.';
  }
}

export const clearPricingConfigCache = () => { cache = null; };

const load = async () => {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.values;
  const [rows] = /** @type {[any[], any]} */ (await pool.execute(
    `SELECT settingKey, settingValue FROM settings WHERE settingKey IN ('tax_rate', 'referral.minWithdrawal')`
  ));
  /** @type {Record<string, string>} */
  const values = {};
  for (const r of rows) values[r.settingKey] = r.settingValue;
  cache = { at: Date.now(), values };
  return values;
};

/** VAT as a fraction (0.15 = 15%). @returns {Promise<number>} */
export const getVatRate = async () => {
  const raw = (await load()).tax_rate;
  const pct = Number(raw);
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(pct) || pct < 0 || pct > 50) {
    console.error(`[pricing] settings.tax_rate is missing or invalid (${raw === undefined ? 'missing' : JSON.stringify(raw)}); refusing to price orders. Set it in Admin -> Settings or run npm run db:migrate.`);
    throw new PricingConfigError('VAT rate is not configured');
  }
  return Math.round(pct * 1000) / 100000;
};

/** Minimum referral withdrawal in GHS. @returns {Promise<number>} */
export const getReferralMinWithdrawal = async () => {
  const raw = (await load())['referral.minWithdrawal'];
  const n = Number(raw);
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(n) || n < 0 || n > 100000) {
    console.error('[pricing] settings.referral.minWithdrawal is missing or invalid; refusing referral withdrawals. Run npm run db:migrate or set it in Admin -> Referrals.');
    throw new PricingConfigError('Referral minimum withdrawal is not configured');
  }
  return Math.round(n * 100) / 100;
};
