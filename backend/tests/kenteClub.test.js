// FILE LOCATION: backend/tests/kenteClub.test.js
// DESCRIPTION: Kente Club membership lifecycle (Phase 3, Step 10). First charge
//   activates + books membership revenue + enables the members discount;
//   subscription.create links; payment_failed → past_due (benefit kept);
//   disable → cancelled (benefit gone).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

let pool = null;
let dbAvailable = true;
try { pool = (await import('../config/db.js')).default; await pool.query('SELECT 1'); } catch { dbAvailable = false; }

const { processMembershipWebhook, getActiveMembershipDiscountPercent } = await import('../Services/membershipService.js');
const MembershipPlan = (await import('../models/membershipPlanModel.js')).default;
const Membership = (await import('../models/membershipModel.js')).default;

const TS = Date.now();
const fx = { userId: null, planId: null, membershipId: null };
const PLAN_CODE = `PLN_memb_${TS}`;
const CUST = `CUS_memb_${TS}`;
const SUBCODE = `SUB_memb_${TS}`;
const REF = `MEMB_test_${TS}`;
const PRICE = 50;

after(async () => {
  if (!dbAvailable) return;
  await pool.query(`DELETE FROM platform_revenue WHERE source='membership' AND orderId IS NULL AND amount = ?`, [PRICE]).catch(() => {});
  if (fx.membershipId) await pool.query('DELETE FROM memberships WHERE id = ?', [fx.membershipId]).catch(() => {});
  if (fx.planId) await pool.query('DELETE FROM membership_plans WHERE id = ?', [fx.planId]).catch(() => {});
  if (fx.userId) await pool.query('DELETE FROM users WHERE id = ?', [fx.userId]).catch(() => {});
  await pool.end().catch(() => {});
});

describe('Kente Club membership lifecycle', { skip: !dbAvailable }, () => {
  before(async () => {
    const [u] = await pool.query(`INSERT INTO users (firstName,lastName,email,password,role) VALUES ('Club','Member',?, 'x','customer')`, [`club_${TS}@t.local`]);
    fx.userId = u.insertId;
    const plan = await MembershipPlan.create({ slug: `test_memb_${TS}`, name: 'Gold', price: PRICE, discountPercent: 10, billingInterval: 'monthly', paystackPlanCode: PLAN_CODE, isActive: true, isPublic: true });
    fx.planId = plan.id;
    const m = await Membership.create({ userId: fx.userId, planId: fx.planId, priceAtSubscribe: PRICE, discountPercentAtSubscribe: 10, currency: 'GHS', billingInterval: 'monthly', startReference: REF, paystackCustomerCode: CUST });
    fx.membershipId = m.id;
  });

  test('first charge activates, books revenue, enables discount', async () => {
    const r = await processMembershipWebhook({ event: 'charge.success', data: { reference: REF, customer: { customer_code: CUST }, paid_at: '2026-01-01T00:00:00Z' } });
    assert.equal(r.action, 'activated');
    const m = await Membership.findById(fx.membershipId);
    assert.equal(m.status, 'active');
    assert.equal(await getActiveMembershipDiscountPercent(fx.userId), 10);
    const [[rev]] = await pool.query(`SELECT COUNT(*) AS n FROM platform_revenue WHERE source='membership' AND amount = ? AND orderId IS NULL`, [PRICE]);
    assert.ok(rev.n >= 1, 'membership revenue booked');
  });

  test('an unrelated charge is not handled', async () => {
    const r = await processMembershipWebhook({ event: 'charge.success', data: { reference: 'ORDER_x' } });
    assert.equal(r.handled, false);
  });

  test('subscription.create links the code', async () => {
    const r = await processMembershipWebhook({ event: 'subscription.create', data: { subscription_code: SUBCODE, email_token: 'TK', customer: { customer_code: CUST }, plan: { plan_code: PLAN_CODE }, next_payment_date: '2026-02-01T00:00:00Z' } });
    assert.equal(r.action, 'linked');
    const m = await Membership.findById(fx.membershipId);
    assert.equal(m.paystackSubscriptionCode, SUBCODE);
  });

  test('payment_failed → past_due keeps the benefit', async () => {
    const r = await processMembershipWebhook({ event: 'invoice.payment_failed', data: { subscription: { subscription_code: SUBCODE } } });
    assert.equal(r.action, 'past_due');
    assert.equal(await getActiveMembershipDiscountPercent(fx.userId), 10); // grace
  });

  test('disable cancels and removes the benefit', async () => {
    const r = await processMembershipWebhook({ event: 'subscription.disable', data: { subscription_code: SUBCODE } });
    assert.equal(r.action, 'cancelled');
    assert.equal(await getActiveMembershipDiscountPercent(fx.userId), 0);
  });
});
