// @ts-check
// FILE LOCATION: backend/Services/featuredListingService.js
// DESCRIPTION: Paid featured/sponsored listings (Phase 3, Step 8). A vendor on a
//   plan with `featured_eligible` pays to feature a product for N days. On
//   payment the product is featured until expiry and the fee is booked as
//   platform revenue (source 'featured'). An hourly sweep un-features expirations.
import crypto from 'crypto';
import pool from '../config/db.js';
import { round2 } from '../../shared/pricing.js';
import paystack from './paystackservices.js';
import Setting from '../models/settingModel.js';
import { getPlanAccess, hasFeature } from './planAccessService.js';
import { PLAN_FEATURES } from '../../shared/plans.js';

/** @param {string|number|Date} d */
const toSql = (d) => new Date(d).toISOString().slice(0, 19).replace('T', ' ');

/** Read featured pricing/config from settings. */
export const getFeaturedConfig = async () => {
  const enabled = await Setting.get('featured.enabled');
  const pricePerDay = await Setting.get('featured.pricePerDay');
  const maxDays = await Setting.get('featured.maxDays');
  return {
    enabled: enabled === true || enabled === 'true',
    pricePerDay: round2(Number(pricePerDay) || 0),
    maxDays: Math.max(1, Math.floor(Number(maxDays) || 30)),
  };
};

/**
 * Begin a featured-listing checkout for one of the vendor's own products.
 * @param {{ vendorUserId:number, vendorEmail:string, productId:number, days:number }} p
 * @returns {Promise<{ authorizationUrl:string, reference:string, placementId:number, amount:number }>}
 */
export const startFeaturedPurchase = async ({ vendorUserId, vendorEmail, productId, days }) => {
  const cfg = await getFeaturedConfig();
  if (!cfg.enabled) throw Object.assign(new Error('Featured listings are not available right now'), { status: 409 });
  if (!(cfg.pricePerDay > 0)) throw Object.assign(new Error('Featured pricing is not configured yet'), { status: 409 });

  const nDays = Math.floor(Number(days));
  if (!Number.isInteger(nDays) || nDays < 1 || nDays > cfg.maxDays) {
    throw Object.assign(new Error(`Choose between 1 and ${cfg.maxDays} days`), { status: 400 });
  }

  // Plan gate: the vendor's plan must include featured eligibility.
  const access = await getPlanAccess(vendorUserId);
  if (!hasFeature(access, PLAN_FEATURES.FEATURED_ELIGIBLE)) {
    throw Object.assign(new Error('Your plan does not include featured listings. Upgrade your plan to use them.'), { status: 403, code: 'PLAN_FEATURE_REQUIRED' });
  }

  // Product must belong to this vendor and be approved.
  const [[product]] = /** @type {any} */ (await pool.execute(
    `SELECT id, vendorId, approvalStatus FROM product WHERE id = ?`, [productId]
  ));
  if (!product || Number(product.vendorId) !== Number(vendorUserId)) {
    throw Object.assign(new Error('Product not found'), { status: 404 });
  }
  if (product.approvalStatus !== 'approved') {
    throw Object.assign(new Error('Only approved products can be featured'), { status: 409 });
  }
  if (!vendorEmail) throw Object.assign(new Error('Your account has no email for billing'), { status: 400 });

  const amount = round2(cfg.pricePerDay * nDays);
  const reference = `FEAT_${vendorUserId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const [res] = /** @type {any} */ (await pool.execute(
    `INSERT INTO featured_placements (vendorId, productId, days, amount, status, purchaseReference)
     VALUES (?, ?, ?, ?, 'pending_payment', ?)`,
    [vendorUserId, productId, nDays, amount, reference]
  ));
  const placementId = res.insertId;

  const pres = await paystack.initializeFeaturedPurchase(vendorEmail, amount, reference, {
    purpose: 'featured_listing', placementId, vendorId: vendorUserId, productId,
  });
  const authorizationUrl = pres?.data?.authorization_url;
  if (!authorizationUrl) throw Object.assign(new Error('Could not start the payment. Please try again.'), { status: 502 });
  return { authorizationUrl, reference, placementId, amount };
};

/**
 * Activate a featured placement after a verified charge. Idempotent.
 * @param {string} reference
 * @returns {Promise<{ handled: boolean, action?: string }>}
 */
export const activateFeaturedByReference = async (reference) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[p]] = /** @type {any} */ (await conn.execute(
      `SELECT * FROM featured_placements WHERE purchaseReference = ? FOR UPDATE`, [reference]
    ));
    if (!p) { await conn.rollback(); return { handled: false }; }
    if (p.status !== 'pending_payment') { await conn.rollback(); return { handled: true, action: 'already_active' }; }

    const startsAt = new Date();
    const expiresAt = new Date(startsAt.getTime() + p.days * 86400000);
    await conn.execute(
      `UPDATE featured_placements SET status = 'active', startsAt = ?, expiresAt = ? WHERE id = ?`,
      [toSql(startsAt), toSql(expiresAt), p.id]
    );
    // Feature the product; extend expiry if it already had a later one.
    await conn.execute(
      `UPDATE product SET featured = 1,
              featuredUntil = CASE WHEN featuredUntil IS NULL OR featuredUntil < ? THEN ? ELSE featuredUntil END
        WHERE id = ?`,
      [toSql(expiresAt), toSql(expiresAt), p.productId]
    );
    // Book platform revenue (fee is 100% platform income).
    await conn.execute(
      `INSERT INTO platform_revenue (orderId, amount, grossAmount, discountAmount, source, created_at)
       VALUES (NULL, ?, ?, 0, 'featured', CURRENT_TIMESTAMP)`,
      [round2(Number(p.amount)), round2(Number(p.amount))]
    );
    await conn.commit();
    return { handled: true, action: 'activated' };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
};

/** Webhook entry: handle a featured charge, else report not-ours. */
export const processFeaturedWebhook = async (/** @type {{ event: string, data: any }} */ { event, data }) => {
  if (event !== 'charge.success') return { handled: false };
  const ref = data?.reference;
  if (!ref) return { handled: false };
  return activateFeaturedByReference(ref);
};

/**
 * Hourly sweep: un-feature products whose paid placement has expired. Only
 * clears products featured via a (now-expired) placement — admin-featured
 * products (featuredUntil IS NULL) are left alone.
 */
export const expireFeaturedPlacements = async () => {
  const now = toSql(new Date());
  const [placements] = /** @type {any} */ (await pool.execute(
    `UPDATE featured_placements SET status = 'expired' WHERE status = 'active' AND expiresAt < ?`, [now]
  ));
  // Un-feature products whose paid window has passed (NULL = admin-featured, keep).
  const [products] = /** @type {any} */ (await pool.execute(
    `UPDATE product SET featured = 0, featuredUntil = NULL WHERE featured = 1 AND featuredUntil IS NOT NULL AND featuredUntil < ?`, [now]
  ));
  return { placementsExpired: placements.affectedRows || 0, productsUnfeatured: products.affectedRows || 0 };
};
