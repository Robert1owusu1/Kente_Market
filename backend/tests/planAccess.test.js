// FILE LOCATION: backend/tests/planAccess.test.js
// DESCRIPTION: Plan feature gating (Phase 2, Step 5). Verifies getPlanAccess +
//   hasFeature across the three modes: legacy (gate off, allow all), enforced
//   with no plan (allow nothing), and enforced on a plan (allow plan features).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

const { getPlanAccess, hasFeature } = await import('../Services/planAccessService.js');
const Plan = (await import('../models/planModel.js')).default;
const VendorSubscription = (await import('../models/vendorSubscriptionModel.js')).default;
const Setting = (await import('../models/settingModel.js')).default;
const { PLAN_FEATURES } = await import('../../shared/plans.js');

const TS = Date.now();
const fx = { planUserId: null, plainUserId: null, planId: null, subId: null };
let originalRequired = 'false';

after(async () => {
  if (!dbAvailable) return;
  await Setting.update('vendorPlans.required', originalRequired === 'true', 'boolean').catch(() => {});
  if (fx.subId) await pool.query('DELETE FROM vendor_subscriptions WHERE id = ?', [fx.subId]).catch(() => {});
  if (fx.planId) await pool.query('DELETE FROM plans WHERE id = ?', [fx.planId]).catch(() => {});
  if (fx.planUserId) await pool.query('DELETE FROM users WHERE id = ?', [fx.planUserId]).catch(() => {});
  if (fx.plainUserId) await pool.query('DELETE FROM users WHERE id = ?', [fx.plainUserId]).catch(() => {});
  await pool.end().catch(() => {});
});

describe('plan feature gating', { skip: !dbAvailable }, () => {
  before(async () => {
    const cur = await Setting.get('vendorPlans.required');
    originalRequired = cur === true || cur === 'true' ? 'true' : 'false';

    const [u1] = await pool.query(`INSERT INTO users (firstName,lastName,email,password,role) VALUES ('P','One',?, 'x','vendor')`, [`plan_${TS}@t.local`]);
    fx.planUserId = u1.insertId;
    const [u2] = await pool.query(`INSERT INTO users (firstName,lastName,email,password,role) VALUES ('P','Two',?, 'x','vendor')`, [`plain_${TS}@t.local`]);
    fx.plainUserId = u2.insertId;

    const plan = await Plan.create({
      slug: `access_plan_${TS}`, name: 'Access Pro', price: 100, commissionRate: 0.1,
      features: [PLAN_FEATURES.STOREFRONT, PLAN_FEATURES.ANALYTICS], productLimit: 25,
      isActive: true, isPublic: true,
    });
    fx.planId = plan.id;
    const sub = await VendorSubscription.create({
      vendorId: fx.planUserId, planId: fx.planId, priceAtSubscribe: 100,
      commissionRateAtSubscribe: 0.1, currency: 'GHS', billingInterval: 'monthly',
    });
    fx.subId = sub.id;
    await VendorSubscription.update(sub.id, { status: 'active' });
  });

  test('legacy mode (gate off, no plan): everything allowed', async () => {
    await Setting.update('vendorPlans.required', false, 'boolean');
    const access = await getPlanAccess(fx.plainUserId);
    assert.equal(access.enforced, false);
    assert.equal(hasFeature(access, PLAN_FEATURES.PROMOTIONS), true);
    assert.equal(access.productLimit, null);
  });

  test('enforced, no plan: nothing allowed', async () => {
    await Setting.update('vendorPlans.required', true, 'boolean');
    const access = await getPlanAccess(fx.plainUserId);
    assert.equal(access.enforced, true);
    assert.equal(access.hasPlan, false);
    assert.equal(hasFeature(access, PLAN_FEATURES.ANALYTICS), false);
  });

  test('on a plan: only the plan features are allowed', async () => {
    const access = await getPlanAccess(fx.planUserId);
    assert.equal(access.enforced, true);
    assert.equal(access.hasPlan, true);
    assert.equal(access.productLimit, 25);
    assert.equal(hasFeature(access, PLAN_FEATURES.ANALYTICS), true);       // granted
    assert.equal(hasFeature(access, PLAN_FEATURES.STOREFRONT), true);      // granted
    assert.equal(hasFeature(access, PLAN_FEATURES.PROMOTIONS), false);     // not in plan
    assert.equal(hasFeature(access, PLAN_FEATURES.INTERNATIONAL_SHIPPING), false);
  });
});
