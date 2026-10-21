// @ts-check
// FILE LOCATION: backend/Services/commissionService.js
// DESCRIPTION: Configurable marketplace commission engine. Resolves the
//              effective commission rate for an order line by applying the most
//              specific active commission rule first:
//                  product  >  vendor  >  category  >  global
//              then the vendor's own platformFeeRate, then the env default.
//
//              Commission base: the vendor's goods value AFTER the order-level
//              discount is apportioned pro rata (what the customer actually paid
//              for those goods). Tax and shipping are never part of the base.
//              Each line is rated on its own product/category, so a product or
//              category rule applies to exactly the lines it names.
import pool from '../config/db.js';
import { PLATFORM_FEE_RATE } from '../config/businessConfig.js';
import { round2, calcEscrowFees } from '../../shared/pricing.js';

const clampRate = (/** @type {number} */ r) => Math.max(0, Math.min(r, 0.5)); // 0..50% hard cap

/**
 * Resolve the effective commission rate (0..1 fraction) for a given product.
 * @param {Object} opts
 * @param {number} [opts.productId] - product id
 * @param {number} [opts.vendorId] - owning vendor user id
 * @param {string} [opts.category] - product category (used for category rules)
 * @param {any} [executor] - pool or transaction connection (defaults to the pool)
 * @returns {Promise<number>} commission fraction, e.g. 0.08 = 8%
 */
export const resolveCommissionRate = async ({ productId, vendorId, category }, executor = pool) => {
  const bind = [];
  const clauses = [];

  // product-level rule
  if (productId) {
    clauses.push(`(scope = 'product' AND targetId = ? AND isActive = 1)`);
    bind.push(String(productId));
  }
  // vendor-level rule
  if (vendorId) {
    clauses.push(`(scope = 'vendor' AND targetId = ? AND isActive = 1)`);
    bind.push(String(vendorId));
  }
  // category-level rule
  if (category) {
    clauses.push(`(scope = 'category' AND targetId = ? AND isActive = 1)`);
    bind.push(String(category));
  }
  // global rule
  clauses.push(`(scope = 'global' AND isActive = 1)`);

  const where = clauses.join(' OR ');

  const [rows] = await executor.execute(
    `SELECT scope, targetId, rate
     FROM commission_rules
     WHERE ${where}
     ORDER BY
       CASE scope
         WHEN 'product'   THEN 0
         WHEN 'vendor'    THEN 1
         WHEN 'category'  THEN 2
         WHEN 'global'    THEN 3
       END,
       priority DESC,
       id DESC
     LIMIT 1`,
    bind
  );

  if (rows.length > 0) {
    const rate = parseFloat(rows[0].rate);
    if (Number.isFinite(rate)) {
      return clampRate(rate);
    }
  }

  // Fall back to the vendor's own negotiated rate, then to env default.
  if (vendorId) {
    const [vendorRows] = await executor.execute(
      `SELECT platformFeeRate FROM vendors WHERE userId = ?`,
      [vendorId]
    );
    if (vendorRows.length > 0) {
      const vRate = parseFloat(vendorRows[0].platformFeeRate);
      if (Number.isFinite(vRate)) {
        return clampRate(vRate);
      }
    }
  }

  return PLATFORM_FEE_RATE;
};

/**
 * Compute commission + net payout for a gross amount.
 * @param {Object} opts
 * @param {number | string} opts.grossAmount - gross amount (GHS) before any fees
 * @param {number} opts.productId - product id
 * @param {number} [opts.vendorId] - owning vendor user id
 * @param {string} [opts.category] - product category
 * @returns {Promise<{ rate: number, gross: number, platformFee: number, payoutAmount: number }>}
 */
export const computeCommission = async ({ grossAmount, productId, vendorId, category }) => {
  const rate = await resolveCommissionRate({ productId, vendorId, category });
  const gross = round2(Math.max(0, parseFloat(String(grossAmount)) || 0));
  const { platformFee, payoutAmount } = calcEscrowFees(gross, rate, PLATFORM_FEE_RATE);
  return { rate, gross, platformFee, payoutAmount };
};

/**
 * @typedef {Object} RatedLine
 * @property {number | string | null} vendorId owning vendor (null = platform-owned)
 * @property {number | string | null} [productId]
 * @property {number} gross P = list price x qty (seller's price; the referral base)
 * @property {number} rate platform commission fraction resolved for THIS line
 * @property {number | string | null} [advanceRatio] product advance ratio, if any
 */

/**
 * @typedef {Object} CommissionLine
 * @property {number | string | null} vendorId
 * @property {number | string | null} productId
 * @property {number} P list value (price x qty)
 * @property {number} r platform rate
 * @property {number} F platform commission P x r (for platform-owned lines: notional, caps referrals)
 * @property {number} Da admin-coupon share (platform-funded; <= F)
 * @property {number} Ds seller-coupon share (seller-funded)
 * @property {number | string | null} [advanceRatio]
 */

/**
 * @typedef {Object} AllocationRow
 * @property {number | string} vendorId
 * @property {'standard' | 'advance' | 'balance' | 'shipping'} allocationType
 * @property {number} amount what the customer paid for this vendor's goods
 *   ('shipping': the delivery fee of a seller who delivers themselves)
 * @property {number} platformFeeRate gross line-weighted platform rate, informational, 4 dp
 * @property {number} platformFee platform's take after any admin coupon, frozen at order time
 * @property {number} payoutAmount seller proceeds = amount - platformFee
 */

/**
 * Who funds the order discount: an admin coupon (platform) or a seller coupon.
 * @param {any} couponVendorId coupons.vendorId (null = admin coupon)
 * @returns {'platform' | 'seller'}
 */
export const discountFunder = (couponVendorId) =>
  couponVendorId === null || couponVendorId === undefined || couponVendorId === '' ? 'platform' : 'seller';

/**
 * Pure: per-line commission accounting (REFERRAL_SYSTEM_DESIGN.md §3).
 *  - Platform commission F = P x r is computed first, on the seller's list price.
 *  - An ADMIN coupon is funded by the platform: split over lines in proportion
 *    to F (so no line's share exceeds its F) and capped at sum(F). Seller
 *    income P - F is protected.
 *  - A SELLER coupon is funded by that seller: split over the seller's lines in
 *    proportion to P and capped at sum(P - F). The platform fee F is protected.
 * Values are kept unrounded here; callers round once when aggregating.
 * @param {RatedLine[]} lines
 * @param {{ discount?: number | string, couponVendorId?: any }} [opts]
 * @returns {{ lines: CommissionLine[], appliedDiscount: number, funder: 'platform' | 'seller' }}
 */
export const computeCommissionLines = (lines, { discount = 0, couponVendorId = null } = {}) => {
  const funder = discountFunder(couponVendorId);
  const base = lines.map((l) => {
    const P = Math.max(0, Number(l.gross) || 0);
    const r = Math.max(0, Number(l.rate) || 0);
    return { vendorId: l.vendorId ?? null, productId: l.productId ?? null, P, r, F: P * r, Da: 0, Ds: 0, advanceRatio: l.advanceRatio ?? null };
  });
  const D = Math.max(0, parseFloat(String(discount)) || 0);
  let applied = 0;
  if (D > 0 && funder === 'platform') {
    const sumF = base.reduce((s, l) => s + l.F, 0);
    applied = Math.min(D, sumF);
    if (sumF > 0) for (const l of base) l.Da = applied * (l.F / sumF);
  } else if (D > 0) {
    const own = base.filter((l) => String(l.vendorId) === String(couponVendorId));
    const sumP = own.reduce((s, l) => s + l.P, 0);
    const room = own.reduce((s, l) => s + (l.P - l.F), 0);
    applied = Math.min(D, Math.max(0, room));
    if (sumP > 0) for (const l of own) l.Ds = applied * (l.P / sumP);
  }
  return { lines: base, appliedDiscount: round2(applied), funder };
};

/**
 * Pure: escrow allocation rows (one per vendor, or an advance + balance pair)
 * from computed commission lines. Platform-owned lines get no allocation.
 * With no discount and one rate this is exactly the previous formula
 * (amount = P, fee = round2(P x r)).
 * @param {CommissionLine[]} lines
 * @param {{ advanceRatio?: number | string }} [opts]
 * @returns {AllocationRow[]}
 */
export const buildAllocationRows = (lines, { advanceRatio = 0 } = {}) => {
  /** @type {Map<any, { P: number, PR: number, paid: number, fee: number, advanceRatio: any }>} */
  const byVendor = new Map();
  for (const l of lines) {
    if (!l.vendorId) continue; // platform-owned items skip escrow
    const v = byVendor.get(l.vendorId) || { P: 0, PR: 0, paid: 0, fee: 0, advanceRatio: l.advanceRatio };
    v.P += l.P;
    v.PR += l.P * l.r;
    v.paid += l.P - l.Da - l.Ds;
    v.fee += l.F - l.Da;
    byVendor.set(l.vendorId, v);
  }

  /** @type {AllocationRow[]} */
  const rows = [];
  for (const [vendorId, v] of byVendor) {
    const amount = round2(Math.max(0, v.paid));
    const feeExact = Math.max(0, Math.min(v.fee, v.paid));
    const effRate = v.paid > 0 ? feeExact / v.paid : 0;
    const storedRate = v.P > 0 ? Math.round((v.PR / v.P) * 10000) / 10000 : 0;
    const row = (/** @type {AllocationRow['allocationType']} */ allocationType, /** @type {number} */ amt, /** @type {number} */ fee) => {
      const platformFee = round2(Math.min(fee, amt));
      return { vendorId, allocationType, amount: round2(amt), platformFeeRate: storedRate, platformFee, payoutAmount: round2(amt - platformFee) };
    };

    const ratio = v.advanceRatio !== null && v.advanceRatio !== undefined
      ? parseFloat(String(v.advanceRatio))
      : Math.max(0, Math.min(1, parseFloat(String(advanceRatio)) || 0));

    if (ratio > 0 && amount > 0) {
      const advanceAmount = round2(amount * ratio);
      const balanceAmount = round2(amount - advanceAmount);
      if (advanceAmount > 0) rows.push(row('advance', advanceAmount, advanceAmount * effRate));
      if (balanceAmount > 0) rows.push(row('balance', balanceAmount, balanceAmount * effRate));
      continue;
    }
    rows.push(row('standard', amount, feeExact));
  }
  return rows;
};

/**
 * Pure: delivery-fee allocations for sellers who deliver their own parcels.
 * The fee is the seller's in full: no commission, no coupon share (coupons
 * discount goods only). Parcels the platform delivers produce no row — the
 * platform keeps that fee.
 * @param {Array<{ vendorId: any, deliveredBy: string, shippingFee: any }>} parts
 * @returns {AllocationRow[]}
 */
export const buildDeliveryFeeRows = (parts) => (parts || [])
  .filter((p) => p.vendorId != null && p.deliveredBy === 'seller' && round2(Number(p.shippingFee) || 0) > 0)
  .map((p) => {
    const amount = round2(Number(p.shippingFee));
    return { vendorId: p.vendorId, allocationType: /** @type {const} */ ('shipping'), amount, platformFeeRate: 0, platformFee: 0, payoutAmount: amount };
  });

/**
 * Compact, auditable per-line record stored on the order
 * (`orders.commissionSnapshot`) when escrow is allocated. Platform revenue,
 * partial refunds and referral commissions read it, so all of them use the
 * numbers frozen at checkout.
 * @param {CommissionLine[]} lines
 * @param {{ appliedDiscount: number, funder: string, couponVendorId?: any }} meta
 */
export const toCommissionSnapshot = (lines, { appliedDiscount, funder, couponVendorId = null }) => ({
  v: 1,
  funder,
  couponVendorId: couponVendorId ?? null,
  discount: appliedDiscount,
  lines: lines.map((l) => ({
    productId: l.productId,
    vendorId: l.vendorId,
    P: round4(l.P),
    r: round4(l.r),
    F: round4(l.F),
    Da: round4(l.Da),
    Ds: round4(l.Ds),
  })),
});

const round4 = (/** @type {number} */ n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;

/**
 * Price + rate every order line from the DB. Platform-owned lines are rated
 * too (notional commission — caps admin coupons and referrals, R8).
 * Lines whose product is unknown (e.g. a custom request with no base
 * product) use the line's own vendorId and price, rated by vendor > global.
 * @param {any} executor pool or transaction connection
 * @param {any[]} items order lines ({ product|productId|id, qty|quantity, price, vendorId })
 * @returns {Promise<RatedLine[]>}
 */
export const rateOrderLines = async (executor, items) => {
  if (!Array.isArray(items) || items.length === 0) return [];

  const productIds = items
    .map((it) => it?.product || it?.productId || it?.id)
    .filter((id) => id !== undefined && id !== null);

  /** @type {Map<any, any>} */
  const productMap = new Map();
  if (productIds.length > 0) {
    const placeholders = productIds.map(() => '?').join(', ');
    const [products] = await executor.execute(
      `SELECT id, vendorId, price, category, advanceRatio FROM product WHERE id IN (${placeholders})`,
      productIds
    );
    for (const p of products) productMap.set(p.id, p);
  }

  /** @type {Map<string, number>} */
  const rateCache = new Map();
  /** @type {RatedLine[]} */
  const lines = [];
  for (const it of items) {
    const pid = it?.product || it?.productId || it?.id;
    const product = productMap.get(pid);
    const vendorId = product?.vendorId || it?.vendorId || null;
    // Order lines from orderController carry `qty`; custom lines carry both.
    const qty = parseFloat(String(it?.quantity ?? it?.qty)) || 1;
    const price = parseFloat(String(it?.price ?? product?.price)) || 0;
    const key = `${product?.id ?? ''}|${vendorId ?? ''}|${product?.category ?? ''}`;
    if (!rateCache.has(key)) {
      rateCache.set(key, await resolveCommissionRate({
        productId: product?.id,
        vendorId: vendorId || undefined,
        category: product?.category || undefined,
      }, executor));
    }
    lines.push({
      vendorId,
      productId: product?.id ?? null,
      gross: qty * price,
      rate: /** @type {number} */ (rateCache.get(key)),
      advanceRatio: product?.advanceRatio ?? null,
    });
  }
  return lines;
};

/**
 * Rate, split and allocate an order. Shared by standard checkout
 * (createEscrowAllocations) and custom-order checkout so both apply the same
 * commission and coupon-funding rules.
 * @param {any} executor pool or transaction connection
 * @param {any[]} items
 * @param {{ discount?: number | string, advanceRatio?: number | string, couponVendorId?: any }} [opts]
 * @returns {Promise<{ rows: AllocationRow[], snapshot: ReturnType<typeof toCommissionSnapshot> }>}
 */
export const buildEscrowAllocationRows = async (executor, items, { discount = 0, advanceRatio = 0, couponVendorId = null } = {}) => {
  const rated = await rateOrderLines(executor, items);
  const { lines, appliedDiscount, funder } = computeCommissionLines(rated, { discount, couponVendorId });
  return {
    rows: buildAllocationRows(lines, { advanceRatio }),
    snapshot: toCommissionSnapshot(lines, { appliedDiscount, funder, couponVendorId }),
  };
};

/**
 * Checkout cap (R7): the discount a coupon may actually give on these items.
 * Admin coupon <= sum of platform commission; seller coupon <= the seller's
 * proceeds on its own lines. The order total must use the returned value.
 * @param {any} executor
 * @param {any[]} items
 * @param {number} discount nominal discount from the coupon rules
 * @param {any} couponVendorId coupons.vendorId (null = admin coupon)
 * @returns {Promise<number>}
 */
export const capCouponDiscount = async (executor, items, discount, couponVendorId) => {
  if (!(Number(discount) > 0)) return 0;
  const rated = await rateOrderLines(executor, items);
  return computeCommissionLines(rated, { discount, couponVendorId }).appliedDiscount;
};

/**
 * The fee/payout to credit when an allocation is released. The commission was
 * frozen on the row when the order was placed; later rule changes must not
 * rewrite it. Rows without a stored fee (none are written by current code)
 * fall back to recomputing from the stored rate.
 * @param {{ amount: any, platformFee?: any, platformFeeRate?: any }} allocation
 * @returns {{ platformFee: number, payoutAmount: number }}
 */
export const allocationFees = (allocation) => {
  const amount = round2(Math.max(0, parseFloat(String(allocation.amount)) || 0));
  const fee = allocation.platformFee === null || allocation.platformFee === undefined
    ? NaN
    : parseFloat(String(allocation.platformFee));
  if (Number.isFinite(fee) && fee >= 0 && fee <= amount) {
    const platformFee = round2(fee);
    return { platformFee, payoutAmount: round2(amount - platformFee) };
  }
  return calcEscrowFees(amount, allocation.platformFeeRate, PLATFORM_FEE_RATE);
};

/**
 * The order's frozen commission snapshot (orders.commissionSnapshot), or null
 * for orders allocated before it existed.
 * @param {number | string} orderId
 * @param {any} [executor]
 * @returns {Promise<{ v: number, funder: string, couponVendorId: any, discount: number, lines: Array<{ productId: any, vendorId: any, P: number, r: number, F: number, Da: number, Ds: number }> } | null>}
 */
export const readCommissionSnapshot = async (orderId, executor = pool) => {
  const [[row]] = await executor.execute(`SELECT commissionSnapshot FROM orders WHERE id = ?`, [orderId]);
  const raw = row?.commissionSnapshot;
  if (!raw) return null;
  try {
    const snap = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return snap && Array.isArray(snap.lines) ? snap : null;
  } catch {
    return null;
  }
};
