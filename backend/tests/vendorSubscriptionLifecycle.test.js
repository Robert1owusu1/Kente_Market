// FILE LOCATION: backend/tests/vendorSubscriptionLifecycle.test.js
// DESCRIPTION: Vendor subscription webhook lifecycle (Phase 2, Step 4). Drives
//   processSubscriptionWebhook with mock Paystack payloads (no network) over
//   real DB fixtures: first charge activates + applies plan economics;
//   subscription.create links the code; invoice.payment_failed → past_due;
//   subscription.disable → cancelled. Cleans up.
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

const { processSubscriptionWebhook } = await import('../Services/vendorSubscriptionService.js');
const Plan = (await import('../models/planModel.js')).default;
const Vendor = (await import('../models/vendorModel.js')).default;
const VendorSubscription = (await import('../models/vendorSubscriptionModel.js')).default;

const TS = Date.now();
const fx = { userId: null, vendorId: null, planId: null, subId: null };
const PLAN_CODE = `PLN_test_${TS}`;
const CUST = `CUS_test_${TS}`;
const SUBCODE = `SUB_test_${TS}`;
const REF = `VSUB_test_${TS}`;

after(async () => {
  if (!dbAvailable) return;
  if (fx.subId) await pool.query('DELETE FROM vendor_subscriptions WHERE id = ?', [fx.subId]).catch(() => {});
  if (fx.vendorId) await pool.query('DELETE FROM vendors WHERE id = ?', [fx.vendorId]).catch(() => {});
  if (fx.userId) await pool.query('DELETE FROM users WHERE id = ?', [fx.userId]).catch(() => {});
  if (fx.planId) await pool.query('DELETE FROM plans WHERE id = ?', [fx.planId]).catch(() => {});
  await pool.end().catch(() => {});
});

describe('vendor subscription lifecycle (webhooks)', { skip: !dbAvailable }, () => {
  before(async () => {
    const [u] = await pool.query(
      `INSERT INTO users (firstName, lastName, email, password, role) VALUES ('Ama','Loom',?, 'x','vendor')`,
      [`subvendor_${TS}@test.local`]
    );
    fx.userId = u.insertId;
    const [v] = await pool.query(
      `INSERT INTO vendors (userId, businessName, status, platformFeeRate, originVerified) VALUES (?, 'Ama Looms', 'approved', 0.1000, 1)`,
      [fx.userId]
    );
    fx.vendorId = v.insertId;

    const plan = await Plan.create({
      slug: `test_plan_${TS}`, name: 'Test Pro', price: 120, commissionRate: 0.08,
      billingInterval: 'monthly', paystackPlanCode: PLAN_CODE, isActive: true, isPublic: true,
    });
    fx.planId = plan.id;

    const sub = await VendorSubscription.create({
      vendorId: fx.userId, planId: fx.planId, priceAtSubscribe: 120,
      commissionRateAtSubscribe: 0.08, currency: 'GHS', billingInterval: 'monthly',
      startReference: REF, paystackCustomerCode: CUST,
    });
    fx.subId = sub.id;
  });

  test('first charge.success activates and applies plan economics', async () => {
    const r = await processSubscriptionWebhook({
      event: 'charge.success',
      data: { reference: REF, customer: { customer_code: CUST }, authorization: { authorization_code: 'AUTH_x' }, paid_at: '2026-01-01T00:00:00Z' },
    });
    assert.equal(r.handled, true);
    assert.equal(r.action, 'activated');

    const sub = await VendorSubscription.findById(fx.subId);
    assert.equal(sub.status, 'active');
    const vendor = await Vendor.findByUserId(fx.userId);
    assert.equal(vendor.planId, fx.planId);
    assert.equal(Number(vendor.platformFeeRate), 0.08); // plan commission applied
  });

  test('an unrelated order charge is not handled here', async () => {
    const r = await processSubscriptionWebhook({ event: 'charge.success', data: { reference: 'ORDER_ref_not_ours' } });
    assert.equal(r.handled, false);
  });

  test('subscription.create links the Paystack subscription code', async () => {
    const r = await processSubscriptionWebhook({
      event: 'subscription.create',
      data: { subscription_code: SUBCODE, email_token: 'TOK_x', customer: { customer_code: CUST }, plan: { plan_code: PLAN_CODE }, next_payment_date: '2026-02-01T00:00:00Z' },
    });
    assert.equal(r.action, 'linked');
    const sub = await VendorSubscription.findById(fx.subId);
    assert.equal(sub.paystackSubscriptionCode, SUBCODE);
    assert.equal(sub.paystackEmailToken, 'TOK_x');
  });

  test('invoice.payment_failed moves it to past_due', async () => {
    const r = await processSubscriptionWebhook({
      event: 'invoice.payment_failed',
      data: { subscription: { subscription_code: SUBCODE } },
    });
    assert.equal(r.action, 'past_due');
    const sub = await VendorSubscription.findById(fx.subId);
    assert.equal(sub.status, 'past_due');
  });

  test('invoice success renews back to active', async () => {
    const r = await processSubscriptionWebhook({
      event: 'invoice.update',
      data: { status: 'success', paid_at: '2026-02-01T00:00:00Z', subscription: { subscription_code: SUBCODE, next_payment_date: '2026-03-01T00:00:00Z' } },
    });
    assert.equal(r.action, 'renewed');
    const sub = await VendorSubscription.findById(fx.subId);
    assert.equal(sub.status, 'active');
  });

  test('subscription.disable cancels it', async () => {
    const r = await processSubscriptionWebhook({
      event: 'subscription.disable',
      data: { subscription_code: SUBCODE },
    });
    assert.equal(r.action, 'cancelled');
    const sub = await VendorSubscription.findById(fx.subId);
    assert.equal(sub.status, 'cancelled');
    // Gate now sees no active subscription.
    assert.equal(await VendorSubscription.hasActiveSubscription(fx.userId), false);
  });
});
