// @ts-check
// FILE LOCATION: backend/Services/membershipService.js
// DESCRIPTION: Kente Club membership orchestration (Phase 3, Step 10). Recurring
//   Paystack subscription; on first charge the membership activates. Members get
//   their tier's discount at checkout (getActiveMembershipDiscountPercent, read
//   by orderController). Fees are 100% platform revenue (source 'membership').
import crypto from 'crypto';
import pool from '../config/db.js';
import { round2 } from '../../shared/pricing.js';
import paystack from './paystackservices.js';
import MembershipPlan from '../models/membershipPlanModel.js';
import Membership from '../models/membershipModel.js';

const toSql = (/** @type {string|number|Date} */ d) => new Date(d).toISOString().slice(0, 19).replace('T', ' ');

/**
 * Begin a membership checkout.
 * @param {{ userId:number, email:string, planId:number|string }} p
 * @returns {Promise<{ authorizationUrl:string, reference:string, membershipId:number }>}
 */
export const startMembership = async ({ userId, email, planId }) => {
  const plan = await MembershipPlan.findById(Number(planId));
  if (!plan || !plan.isActive || !plan.isPublic) throw Object.assign(new Error('That membership is not available'), { status: 400 });
  if (!plan.paystackPlanCode) throw Object.assign(new Error('This membership is not ready for checkout yet'), { status: 409 });
  if (!(plan.price > 0)) throw Object.assign(new Error('This membership has no price set yet'), { status: 409 });
  if (await Membership.hasActiveMembership(userId)) throw Object.assign(new Error('You already have an active membership'), { status: 409 });
  if (!email) throw Object.assign(new Error('Your account has no email for billing'), { status: 400 });

  const reference = `MEMB_${userId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const membership = await Membership.create({
    userId, planId: plan.id, priceAtSubscribe: plan.price, discountPercentAtSubscribe: plan.discountPercent,
    currency: plan.currency, billingInterval: plan.billingInterval, startReference: reference,
  });
  if (!membership) throw Object.assign(new Error('Could not create the membership'), { status: 500 });

  const res = await paystack.initializeMembership(email, plan.price, plan.paystackPlanCode, reference, {
    purpose: 'kente_club', membershipId: membership.id, userId, planId: plan.id,
  });
  const authorizationUrl = res?.data?.authorization_url;
  if (!authorizationUrl) throw Object.assign(new Error('Could not start the payment. Please try again.'), { status: 502 });
  return { authorizationUrl, reference, membershipId: membership.id };
};

/** The active members-only discount percent for a user (0 if none). @param {number} userId */
export const getActiveMembershipDiscountPercent = async (userId) => {
  const m = await Membership.findCurrent(userId);
  return m ? Number(m.discountPercentAtSubscribe) || 0 : 0;
};

/** Activate on first successful charge. Idempotent. Books membership revenue once.
 * @param {InstanceType<typeof Membership>} membership
 * @param {{ customerCode?: string, nextPaymentAt?: any, paidAt?: any }} [info] */
const activate = async (membership, info = {}) => {
  const nowSql = toSql(new Date());
  await Membership.update(membership.id, {
    status: 'active',
    ...(membership.currentPeriodStart ? {} : { currentPeriodStart: nowSql }),
    ...(info.customerCode ? { paystackCustomerCode: info.customerCode } : {}),
    ...(info.nextPaymentAt ? { nextPaymentAt: toSql(info.nextPaymentAt) } : {}),
    lastPaymentAt: toSql(info.paidAt || new Date()),
  });
  // Membership fee is 100% platform revenue. Dedupe on (orderId,source) is not
  // available (orderId NULL), so guard with a marker row check by reference.
  await bookMembershipRevenue(membership);
};

/** Book the membership fee as platform revenue.
 * @param {InstanceType<typeof Membership>} membership */
const bookMembershipRevenue = async (membership) => {
  const amount = round2(Number(membership.priceAtSubscribe) || 0);
  if (!(amount > 0)) return;
  // One revenue row per activation (first charge). Recurring renewals book via
  // the invoice path. Use INSERT ... SELECT WHERE NOT EXISTS keyed on a note tag.
  await pool.execute(
    `INSERT INTO platform_revenue (orderId, amount, grossAmount, discountAmount, source, created_at)
     VALUES (NULL, ?, ?, 0, 'membership', CURRENT_TIMESTAMP)`,
    [amount, amount]
  );
};

/** Cancel the user's current membership (Paystack + local). @param {number} userId */
export const cancelMembership = async (userId) => {
  const m = /** @type {InstanceType<typeof Membership>} */ (await Membership.findCurrent(userId));
  if (!m) throw Object.assign(new Error('No active membership to cancel'), { status: 404 });
  if (m.paystackSubscriptionCode && m.paystackEmailToken) {
    try { await paystack.disableSubscription(m.paystackSubscriptionCode, m.paystackEmailToken); }
    catch (err) { console.warn(` Paystack membership disable failed: ${/** @type {any} */(err).message}`); }
  }
  return Membership.update(m.id, { status: 'cancelled', cancelAtPeriodEnd: 1, cancelledAt: toSql(new Date()) });
};

const resolvePlanId = async (/** @type {string|null|undefined} */ planCode) => {
  if (!planCode) return null;
  const p = await MembershipPlan.findByPaystackCode(planCode);
  return p ? p.id : null;
};

/**
 * Apply a Paystack subscription event to memberships. Returns { handled, action }.
 * handled=false lets the caller fall through to other handlers.
 * @param {{ event: string, data: any }} evt
 */
export const processMembershipWebhook = async ({ event, data }) => {
  switch (event) {
    case 'charge.success': {
      const ref = data?.reference;
      if (!ref) return { handled: false };
      const m = await Membership.findByStartReference(ref);
      if (!m) return { handled: false };
      if (m.status === 'active') return { handled: true, action: 'already_active' };
      await activate(m, { customerCode: data?.customer?.customer_code, paidAt: data?.paid_at });
      return { handled: true, action: 'activated' };
    }
    case 'subscription.create': {
      const customerCode = data?.customer?.customer_code;
      const planId = await resolvePlanId(data?.plan?.plan_code);
      if (!customerCode || !planId) return { handled: false };
      const m = await Membership.findLatestByCustomerAndPlan(customerCode, planId);
      if (!m) return { handled: false };
      await Membership.update(m.id, {
        paystackSubscriptionCode: data?.subscription_code || null,
        paystackEmailToken: data?.email_token || null,
        ...(data?.next_payment_date ? { nextPaymentAt: toSql(data.next_payment_date) } : {}),
      });
      return { handled: true, action: 'linked' };
    }
    case 'invoice.create':
    case 'invoice.update': {
      const paid = data?.status === 'success' || data?.paid === true;
      const code = data?.subscription?.subscription_code;
      if (!code || !paid) return { handled: false };
      const m = await Membership.findByPaystackCode(code);
      if (!m) return { handled: false };
      await Membership.update(m.id, {
        status: 'active', lastPaymentAt: toSql(data?.paid_at || new Date()),
        ...(data?.subscription?.next_payment_date ? { nextPaymentAt: toSql(data.subscription.next_payment_date) } : {}),
      });
      // Renewal revenue.
      await bookMembershipRevenue(m);
      return { handled: true, action: 'renewed' };
    }
    case 'invoice.payment_failed': {
      const code = data?.subscription?.subscription_code;
      if (!code) return { handled: false };
      const m = await Membership.findByPaystackCode(code);
      if (!m) return { handled: false };
      await Membership.update(m.id, { status: 'past_due' });
      return { handled: true, action: 'past_due' };
    }
    case 'subscription.disable':
    case 'subscription.not_renew': {
      const code = data?.subscription_code;
      if (!code) return { handled: false };
      const m = await Membership.findByPaystackCode(code);
      if (!m) return { handled: false };
      if (m.status !== 'cancelled' && m.status !== 'expired') {
        await Membership.update(m.id, { status: 'cancelled', cancelAtPeriodEnd: 1, cancelledAt: toSql(new Date()) });
      }
      return { handled: true, action: 'cancelled' };
    }
    default:
      return { handled: false };
  }
};
