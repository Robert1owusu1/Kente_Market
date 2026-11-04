// FILE LOCATION: backend/tests/featuredListing.test.js
// DESCRIPTION: Paid featured listings (Phase 3, Step 8). Activation features the
//   product + books platform revenue (source 'featured'); the sweep un-features
//   expired placements; the plan gate blocks vendors without featured_eligible.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch { dbAvailable = false; }

const {
  activateFeaturedByReference, expireFeaturedPlacements, startFeaturedPurchase,
} = await import('../Services/featuredListingService.js');
const Setting = (await import('../models/settingModel.js')).default;
const Plan = (await import('../models/planModel.js')).default;
const VendorSubscription = (await import('../models/vendorSubscriptionModel.js')).default;
const { PLAN_FEATURES } = await import('../../shared/plans.js');

const TS = Date.now();
const fx = { userId: null, user2Id: null, productId: null, product2Id: null, placementId: null, placement2Id: null, planId: null, subId: null };
const REF = `FEAT_test_${TS}`;
const AMT = 35;

after(async () => {
  if (!dbAvailable) return;
  await Setting.update('featured.enabled', false, 'boolean').catch(() => {});
  await Setting.update('featured.pricePerDay', '0', 'number').catch(() => {});
  await pool.query(`DELETE FROM platform_revenue WHERE source='featured' AND orderId IS NULL AND amount IN (?, ?)`, [AMT, 7]).catch(() => {});
  for (const id of [fx.placementId, fx.placement2Id]) if (id) await pool.query('DELETE FROM featured_placements WHERE id = ?', [id]).catch(() => {});
  if (fx.subId) await pool.query('DELETE FROM vendor_subscriptions WHERE id = ?', [fx.subId]).catch(() => {});
  for (const id of [fx.productId, fx.product2Id]) if (id) await pool.query('DELETE FROM product WHERE id = ?', [id]).catch(() => {});
  if (fx.planId) await pool.query('DELETE FROM plans WHERE id = ?', [fx.planId]).catch(() => {});
  for (const id of [fx.userId, fx.user2Id]) if (id) await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  await pool.end().catch(() => {});
});

describe('paid featured listings', { skip: !dbAvailable }, () => {
  before(async () => {
    const [u] = await pool.query(`INSERT INTO users (firstName,lastName,email,password,role) VALUES ('Feat','Vendor',?, 'x','vendor')`, [`feat_${TS}@t.local`]);
    fx.userId = u.insertId;
    const [p] = await pool.query(`INSERT INTO product (title,img,price,category,vendorId,approvalStatus) VALUES ('Kente A','a.jpg',100,'kente',?, 'approved')`, [fx.userId]);
    fx.productId = p.insertId;
    const [pl] = await pool.query(
      `INSERT INTO featured_placements (vendorId, productId, days, amount, status, purchaseReference) VALUES (?, ?, 7, ?, 'pending_payment', ?)`,
      [fx.userId, fx.productId, AMT, REF]
    );
    fx.placementId = pl.insertId;
  });

  test('activation features the product + books featured revenue; idempotent', async () => {
    const r = await activateFeaturedByReference(REF);
    assert.equal(r.action, 'activated');
    const [[prod]] = await pool.query(`SELECT featured, featuredUntil FROM product WHERE id = ?`, [fx.productId]);
    assert.equal(prod.featured, 1);
    assert.ok(prod.featuredUntil, 'featuredUntil set');
    const [[rev]] = await pool.query(`SELECT COUNT(*) AS n FROM platform_revenue WHERE source='featured' AND amount = ? AND orderId IS NULL`, [AMT]);
    assert.ok(rev.n >= 1, 'featured revenue booked');
    const r2 = await activateFeaturedByReference(REF);
    assert.equal(r2.action, 'already_active');
  });

  test('the sweep un-features an expired placement', async () => {
    const past = new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' ');
    await pool.query(`UPDATE featured_placements SET status='active', startsAt=?, expiresAt=? WHERE id=?`, [past, past, fx.placementId]);
    await pool.query(`UPDATE product SET featured=1, featuredUntil=? WHERE id=?`, [past, fx.productId]);
    const res = await expireFeaturedPlacements();
    assert.ok(res.productsUnfeatured >= 1);
    const [[prod]] = await pool.query(`SELECT featured FROM product WHERE id=?`, [fx.productId]);
    assert.equal(prod.featured, 0);
  });

  test('plan gate blocks a vendor without featured_eligible', async () => {
    await Setting.update('featured.enabled', true, 'boolean');
    await Setting.update('featured.pricePerDay', '5', 'number');
    const [u2] = await pool.query(`INSERT INTO users (firstName,lastName,email,password,role) VALUES ('No','Feat',?, 'x','vendor')`, [`nofeat_${TS}@t.local`]);
    fx.user2Id = u2.insertId;
    const [p2] = await pool.query(`INSERT INTO product (title,img,price,category,vendorId,approvalStatus) VALUES ('Kente B','b.jpg',80,'kente',?, 'approved')`, [fx.user2Id]);
    fx.product2Id = p2.insertId;
    const plan = await Plan.create({ slug:`feat_plan_${TS}`, name:'Basic', price:50, commissionRate:0.1, features:[PLAN_FEATURES.STOREFRONT], isActive:true, isPublic:true });
    fx.planId = plan.id;
    const sub = await VendorSubscription.create({ vendorId: fx.user2Id, planId: fx.planId, priceAtSubscribe:50, commissionRateAtSubscribe:0.1, currency:'GHS', billingInterval:'monthly' });
    fx.subId = sub.id;
    await VendorSubscription.update(sub.id, { status: 'active' });

    await assert.rejects(
      () => startFeaturedPurchase({ vendorUserId: fx.user2Id, vendorEmail: `nofeat_${TS}@t.local`, productId: fx.product2Id, days: 3 }),
      (e) => { assert.equal(e.status, 403); return true; }
    );
  });
});
