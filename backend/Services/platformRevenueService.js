// @ts-check
// FILE LOCATION: backend/Services/platformRevenueService.js
// DESCRIPTION: Read-only aggregation of PLATFORM earnings — the money the
//   platform (owner + partners) keeps. Two independent streams:
//     1. Platform-product income — `platform_revenue` rows (source
//        'platform_product' net of 'refund'); platform-owned products
//        (vendorId IS NULL) keep 100%, booked at payment.
//     2. Marketplace commission — `escrow_allocations.platformFee`, the
//        platform's cut of vendor sales. Booked once the order is paid
//        (status leaves 'pending'/'failed'); still-held vs released is
//        reported separately so owners can see realised vs in-escrow.
//   No money is written here. All amounts are GHS, 2 dp.
import pool from '../config/db.js';
import { round2 } from '../../shared/pricing.js';

// Allocation statuses that represent commission the platform has actually taken
// from a paid order (excludes 'pending' = not yet paid, 'failed' = voided).
const BOOKED_STATUSES = ['held', 'available', 'releasing', 'released'];
// Of the booked commission, these are released from escrow (realised).
const RELEASED_STATUSES = ['available', 'releasing', 'released'];

/** @param {readonly unknown[]} arr @returns {string} a safe `?,?,...` placeholder list */
const marks = (arr) => arr.map(() => '?').join(', ');

/**
 * Normalise a from/to window. Defaults to the last 30 days. Dates are treated
 * as inclusive calendar days in the server's timezone.
 * @param {{ from?: string, to?: string }} [opts]
 * @returns {{ from: string, to: string }} ISO date strings (YYYY-MM-DD)
 */
export const normalizeRange = ({ from, to } = {}) => {
  /** @param {unknown} s @returns {s is string} */
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const today = new Date();
  const toDate = isDate(to) ? to : today.toISOString().slice(0, 10);
  let fromDate;
  if (isDate(from)) {
    fromDate = from;
  } else {
    const d = new Date(toDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 29); // 30-day window inclusive
    fromDate = d.toISOString().slice(0, 10);
  }
  // Guard against a reversed window.
  if (fromDate > toDate) fromDate = toDate;
  return { from: fromDate, to: toDate };
};

/**
 * Headline totals over the window.
 * @param {{ from: string, to: string }} range
 * @param {{ query: Function }} [executor] pool or a transaction connection
 */
const getSummary = async ({ from, to }, executor = pool) => {
  const lo = `${from} 00:00:00`;
  const hiExclusive = `${to} 23:59:59`;

  // Platform-product income (net of refunds) + featured-listing income, broken
  // out by source. Refund rows are stored as negatives.
  const [[pp]] = /** @type {any} */ (await executor.query(
    `SELECT
       COALESCE(SUM(CASE WHEN source = 'platform_product' THEN grossAmount END), 0) AS gross,
       COALESCE(SUM(CASE WHEN source = 'refund' THEN -amount END), 0) AS refunds,
       COALESCE(SUM(CASE WHEN source IN ('platform_product','refund') THEN amount END), 0) AS net,
       COALESCE(SUM(CASE WHEN source = 'featured' THEN amount END), 0) AS featured,
       COALESCE(SUM(CASE WHEN source = 'membership' THEN amount END), 0) AS membership
     FROM platform_revenue
     WHERE created_at BETWEEN ? AND ?`,
    [lo, hiExclusive]
  ));

  // Marketplace commission from vendor sales.
  const [[comm]] = /** @type {any} */ (await executor.query(
    `SELECT
       COALESCE(SUM(CASE WHEN status IN (${marks(BOOKED_STATUSES)}) THEN platformFee END), 0) AS booked,
       COALESCE(SUM(CASE WHEN status IN (${marks(RELEASED_STATUSES)}) THEN platformFee END), 0) AS released,
       COALESCE(SUM(CASE WHEN status = 'held' THEN platformFee END), 0) AS held
     FROM escrow_allocations
     WHERE created_at BETWEEN ? AND ?`,
    [...BOOKED_STATUSES, ...RELEASED_STATUSES, lo, hiExclusive]
  ));

  const platformProductNet = round2(Number(pp.net));
  const featuredNet = round2(Number(pp.featured));
  const membershipNet = round2(Number(pp.membership));
  const commissionBooked = round2(Number(comm.booked));
  const commissionReleased = round2(Number(comm.released));
  const commissionHeld = round2(Number(comm.held));

  return {
    platformProductGross: round2(Number(pp.gross)),
    platformProductRefunds: round2(Number(pp.refunds)),
    platformProductNet,
    featuredNet,
    membershipNet,
    commissionBooked,
    commissionReleased,
    commissionHeld,
    // Total platform earnings = product net + featured + membership + commission.
    totalBooked: round2(platformProductNet + featuredNet + membershipNet + commissionBooked),
    // Realised = immediate income (product/featured/membership) + released commission.
    totalReleased: round2(platformProductNet + featuredNet + membershipNet + commissionReleased),
  };
};

/**
 * Daily time series for charting. One row per calendar day in the window that
 * has activity, with platform-product net and commission booked.
 * @param {{ from: string, to: string }} range
 * @param {{ query: Function }} [executor] pool or a transaction connection
 */
const getDailySeries = async ({ from, to }, executor = pool) => {
  const lo = `${from} 00:00:00`;
  const hiExclusive = `${to} 23:59:59`;

  const [ppRows] = /** @type {any} */ (await executor.query(
    `SELECT DATE(created_at) AS d, COALESCE(SUM(amount), 0) AS v
     FROM platform_revenue
     WHERE created_at BETWEEN ? AND ?
     GROUP BY DATE(created_at)`,
    [lo, hiExclusive]
  ));
  const [commRows] = /** @type {any} */ (await executor.query(
    `SELECT DATE(created_at) AS d, COALESCE(SUM(platformFee), 0) AS v
     FROM escrow_allocations
     WHERE status IN (${marks(BOOKED_STATUSES)}) AND created_at BETWEEN ? AND ?
     GROUP BY DATE(created_at)`,
    [...BOOKED_STATUSES, lo, hiExclusive]
  ));

  /** @type {Map<string, { platformProduct: number, commission: number }>} */
  const byDay = new Map();
  /** @param {unknown} d */
  const toKey = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
  for (const r of ppRows) {
    const k = toKey(r.d);
    byDay.set(k, { platformProduct: round2(Number(r.v)), commission: 0 });
  }
  for (const r of commRows) {
    const k = toKey(r.d);
    const cur = byDay.get(k) || { platformProduct: 0, commission: 0 };
    cur.commission = round2(Number(r.v));
    byDay.set(k, cur);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, v]) => ({
      date,
      platformProduct: v.platformProduct,
      commission: v.commission,
      total: round2(v.platformProduct + v.commission),
    }));
};

/**
 * Full platform-earnings report for the admin dashboard.
 * @param {{ from?: string, to?: string }} [opts]
 * @param {{ query: Function }} [executor] pool or a transaction connection (tests)
 */
export const getPlatformRevenueReport = async (opts = {}, executor = pool) => {
  const range = normalizeRange(opts);
  const [summary, series] = await Promise.all([
    getSummary(range, executor),
    getDailySeries(range, executor),
  ]);
  return { period: range, currency: 'GHS', summary, series };
};
