// @ts-check
// FILE LOCATION: backend/config/businessConfig.js
// DESCRIPTION: Single source of truth for business-rule configuration
//              (platform commission, escrow release window) with validation.
import dotenv from 'dotenv';
import { DEFAULT_PLATFORM_FEE_RATE } from '../../shared/pricing.js';
dotenv.config();

// Parse + validate a numeric env value, falling back to a safe default.
/**
 * @param {string | undefined} raw raw env value
 * @param {string} label env key name (for the warning message)
 * @param {{ min: number, max: number, def: number }} opts boundaries + fallback
 * @returns {number} validated config value
 */
const asNumber = (raw, label, { min, max, def }) => {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= min && n <= max) {
    return n;
  }
  console.warn(`⚠️ Invalid ${label}=${raw}; using default ${def}`);
  return def;
};

// Platform commission rate (0..1). 0.1 = 10%. Used for vendors without their
// own per-vendor platformFeeRate.
export const PLATFORM_FEE_RATE = asNumber(process.env.PLATFORM_FEE_RATE, 'PLATFORM_FEE_RATE', {
  min: 0,
  max: 1,
  def: DEFAULT_PLATFORM_FEE_RATE,
});

// Days after a delivered + hold order is auto-released to vendors.
export const ESCROW_RELEASE_DAYS = asNumber(process.env.ESCROW_RELEASE_DAYS, 'ESCROW_RELEASE_DAYS', {
  min: 1,
  max: 90,
  def: 7,
});

// Custom orders: share of the quote released to the weaver up-front at payment
// (advance) — the remainder is held in escrow until delivery is confirmed.
// 0.5 = 50% advance / 50% held.
export const CUSTOM_ADVANCE_RATIO = asNumber(process.env.CUSTOM_ADVANCE_RATIO, 'CUSTOM_ADVANCE_RATIO', {
  min: 0,
  max: 0.9,
  def: 0.5,
});

// Maximum AI try-on generations allowed per user per day (cost-control).
export const AI_TRYON_DAILY_LIMIT = asNumber(process.env.AI_TRYON_DAILY_LIMIT, 'AI_TRYON_DAILY_LIMIT', {
  min: 1,
  max: 1000,
  def: 10,
});