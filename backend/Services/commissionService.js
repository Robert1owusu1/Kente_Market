// FILE LOCATION: backend/Services/commissionService.js
// DESCRIPTION: Configurable marketplace commission engine. Resolves the
//              effective commission rate for an order line by applying the most
//              specific active commission rule first:
//                  product  >  vendor  >  category  >  global
//              then the vendor's own platformFeeRate, then the env default.
import pool from '../config/db.js';
import { PLATFORM_FEE_RATE } from '../config/businessConfig.js';
import { round2, calcEscrowFees } from '../../shared/pricing.js';

/**
 * Resolve the effective commission rate (0..1 fraction) for a given product.
 * @param {Object} opts
 * @param {number} opts.productId - product id
 * @param {number} [opts.vendorId] - owning vendor user id
 * @param {string} [opts.category] - product category (used for category rules)
 * @returns {Promise<number>} commission fraction, e.g. 0.08 = 8%
 */
export const resolveCommissionRate = async ({ productId, vendorId, category }) => {
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

  const [rows] = await pool.execute(
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
      return Math.max(0, Math.min(rate, 0.5)); // 0..50% hard cap
    }
  }

  // Fall back to the vendor's own negotiated rate, then to env default.
  if (vendorId) {
    const [vendorRows] = await pool.execute(
      `SELECT platformFeeRate FROM vendors WHERE userId = ?`,
      [vendorId]
    );
    if (vendorRows.length > 0) {
      const vRate = parseFloat(vendorRows[0].platformFeeRate);
      if (Number.isFinite(vRate)) {
        return Math.max(0, Math.min(vRate, 0.5));
      }
    }
  }

  return PLATFORM_FEE_RATE;
};

/**
 * Compute commission + net payout for a gross amount.
 */
export const computeCommission = async ({ grossAmount, productId, vendorId, category }) => {
  const rate = await resolveCommissionRate({ productId, vendorId, category });
  const gross = round2(Math.max(0, parseFloat(grossAmount) || 0));
  const { platformFee, payoutAmount } = calcEscrowFees(gross, rate, PLATFORM_FEE_RATE);
  return { rate, gross, platformFee, payoutAmount };
};