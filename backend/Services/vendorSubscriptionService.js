// @ts-check
// FILE LOCATION: backend/Services/vendorSubscriptionService.js
// DESCRIPTION: Vendor plan subscription orchestration (Phase 2, Step 4).
//   - startSubscription: an APPROVED, origin-verified vendor picks a plan; we
//     create a pending vendor_subscriptions row and a Paystack checkout bound
//     to the plan (recurring). The dashboard stays LOCKED until payment lands.
//   - activateSubscription: on first successful charge, unlock the vendor:
//     status=active, set vendors.planId + vendors.platformFeeRate (the plan's
//     commission) so the plan's economics take effect.
//   - processSubscriptionWebhook: drive the lifecycle from Paystack events
//     (activate, renew, past_due, cancel). Idempotent — safe to replay.
import pool from '../config/db.js';
import crypto from 'crypto';
import paystack from './paystackservices.js';
import Vendor from '../models/vendorModel.js';
import Plan from '../models/planModel.js';
import VendorSubscription from '../models/vendorSubscriptionModel.js';

/** MySQL DATETIME string (Date objects get JSON-stringified by generic updates).
 * @param {string|number|Date|null|undefined} d */
const toSql = (d) => (d ? new Date(d).toISOString().slice(0, 19).replace('T', ' ') : null);

/**
 * Begin a subscription checkout for an approved vendor.
 * @param {number} vendorUserId users.id of the vendor
 * @param {number|string} planId
 * @returns {Promise<{ authorizationUrl: string, reference: string, subscriptionId: number }>}
 */
export const startSubscription = async (vendorUserId, planId) => {
  const vendor = await Vendor.findByUserId(vendorUserId);
  if (!vendor) { const e = new Error('No vendor profile found'); throw Object.assign(e, { status: 404 }); }
  if (vendor.status !== 'approved') {
    throw Object.assign(new Error('Your store must be approved before you can pay for a plan'), { status: 403 });
  }

  const plan = await Plan.findById(Number(planId));
  if (!plan || !plan.isActive || !plan.isPublic) {
    throw Object.assign(new Error('That plan is not available'), { status: 400 });
  }
  if (!plan.paystackPlanCode) {
    throw Object.assign(new Error('This plan is not ready for checkout yet. Please contact support.'), { status: 409 });
  }
  if (!(plan.price > 0)) {
    throw Object.assign(new Error('This plan has no price set yet'), { status: 409 });
  }

  // One active subscription per vendor.
  if (await VendorSubscription.hasActiveSubscription(vendorUserId)) {
    throw Object.assign(new Error('You already have an active plan'), { status: 409 });
  }
  if (!vendor.email) {
    throw Object.assign(new Error('Your account has no email for billing'), { status: 400 });
  }

  const reference = `VSUB_${vendorUserId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const sub = await VendorSubscription.create({
    vendorId: vendorUserId,
    planId: plan.id,
    priceAtSubscribe: plan.price,
    commissionRateAtSubscribe: plan.commissionRate ?? 0.1,
    currency: plan.currency,
    billingInterval: plan.billingInterval,
    startReference: reference,
  });
  if (!sub) throw Object.assign(new Error('Could not create the subscription'), { status: 500 });

  const res = await paystack.initializeSubscription(
    vendor.email, plan.price, plan.paystackPlanCode, reference,
    { purpose: 'vendor_subscription', subscriptionId: sub.id, vendorId: vendorUserId, planId: plan.id }
  );
  const authorizationUrl = res?.data?.authorization_url;
  if (!authorizationUrl) {
    throw Object.assign(new Error('Could not start the payment. Please try again.'), { status: 502 });
  }
  return { authorizationUrl, reference, subscriptionId: sub.id };
};

/**
 * Unlock a vendor on a successful subscription charge. Idempotent.
 * @param {import('../models/vendorSubscriptionModel.js').default} sub
 * @param {{ customerCode?: string, authorizationCode?: string, periodEnd?: string|Date|null, nextPaymentAt?: string|Date|null, paidAt?: string|Date|null }} [info]
 */
export const activateSubscription = async (sub, info = {}) => {
  const nowSql = toSql(new Date());
  await VendorSubscription.update(sub.id, {
    status: 'active',
    ...(sub.currentPeriodStart ? {} : { currentPeriodStart: nowSql }),
    ...(info.customerCode ? { paystackCustomerCode: info.customerCode } : {}),
    ...(info.authorizationCode ? { paystackAuthorizationCode: info.authorizationCode } : {}),
    ...(info.periodEnd ? { currentPeriodEnd: toSql(info.periodEnd) } : {}),
    ...(info.nextPaymentAt ? { nextPaymentAt: toSql(info.nextPaymentAt) } : {}),
    lastPaymentAt: toSql(info.paidAt || new Date()),
  });

  // Apply the plan's economics to the vendor: commission + current-plan pointer.
  const vendor = await Vendor.findByUserId(sub.vendorId);
  if (vendor) {
    await Vendor.update(vendor.id, {
      planId: sub.planId,
      platformFeeRate: sub.commissionRateAtSubscribe,
    });
  }
};

/** Cancel the vendor's current subscription (at Paystack + locally).
 * @param {number} vendorUserId */
export const cancelSubscription = async (vendorUserId) => {
  const sub = await VendorSubscription.findCurrent(vendorUserId);
  if (!sub) throw Object.assign(new Error('No active plan to cancel'), { status: 404 });
  if (sub.paystackSubscriptionCode && sub.paystackEmailToken) {
    // Best-effort: Paystack stops future renewals. Local state is the source of truth.
    try { await paystack.disableSubscription(sub.paystackSubscriptionCode, sub.paystackEmailToken); }
    catch (err) { console.warn(` Paystack subscription disable failed: ${/** @type {any} */(err).message}`); }
  }
  return VendorSubscription.update(sub.id, { status: 'cancelled', cancelAtPeriodEnd: 1, cancelledAt: toSql(new Date()) });
};

// --- Webhook processing --------------------------------------------------

/** Resolve the plan for a Paystack plan object/code.
 * @param {string|null|undefined} planCode */
const resolvePlanId = async (planCode) => {
  if (!planCode) return null;
  const plan = await Plan.findByPaystackCode(planCode);
  return plan ? plan.id : null;
};

/**
 * Apply a Paystack subscription-related event. Idempotent and safe to replay.
 * Returns { handled, action } — handled=false means "not a subscription event
 * we own" so the caller can fall through to its order handling.
 * @param {{ event: string, data: any }} evt
 */
export const processSubscriptionWebhook = async ({ event, data }) => {
  switch (event) {
    case 'charge.success': {
      // Only OUR first subscription charge (correlated by our reference).
      const ref = data?.reference;
      if (!ref) return { handled: false };
      const sub = await VendorSubscription.findByStartReference(ref);
      if (!sub) return { handled: false }; // an ordinary order charge — not ours
      if (sub.status === 'active') return { handled: true, action: 'already_active' };
      await activateSubscription(sub, {
        customerCode: data?.customer?.customer_code,
        authorizationCode: data?.authorization?.authorization_code,
        paidAt: data?.paid_at || data?.paidAt,
      });
      return { handled: true, action: 'activated' };
    }

    case 'subscription.create': {
      const customerCode = data?.customer?.customer_code;
      const planId = await resolvePlanId(data?.plan?.plan_code);
      if (!customerCode || !planId) return { handled: true, action: 'unmatched' };
      const sub = await VendorSubscription.findLatestByCustomerAndPlan(customerCode, planId);
      if (!sub) return { handled: true, action: 'unmatched' };
      await VendorSubscription.update(sub.id, {
        paystackSubscriptionCode: data?.subscription_code || null,
        paystackEmailToken: data?.email_token || null,
        ...(data?.next_payment_date ? { nextPaymentAt: toSql(data.next_payment_date) } : {}),
      });
      return { handled: true, action: 'linked' };
    }

    case 'invoice.create':
    case 'invoice.update': {
      // A recurring charge result. Only act on a paid/success invoice.
      const paid = data?.status === 'success' || data?.paid === true;
      const code = data?.subscription?.subscription_code;
      if (!code || !paid) return { handled: true, action: 'ignored' };
      const sub = await VendorSubscription.findByPaystackCode(code);
      if (!sub) return { handled: true, action: 'unmatched' };
      await VendorSubscription.update(sub.id, {
        status: 'active',
        lastPaymentAt: toSql(data?.paid_at || new Date()),
        ...(data?.subscription?.next_payment_date ? { nextPaymentAt: toSql(data.subscription.next_payment_date) } : {}),
      });
      return { handled: true, action: 'renewed' };
    }

    case 'invoice.payment_failed': {
      const code = data?.subscription?.subscription_code;
      if (!code) return { handled: true, action: 'ignored' };
      const sub = await VendorSubscription.findByPaystackCode(code);
      if (!sub) return { handled: true, action: 'unmatched' };
      await VendorSubscription.update(sub.id, { status: 'past_due' });
      return { handled: true, action: 'past_due' };
    }

    case 'subscription.disable':
    case 'subscription.not_renew': {
      const code = data?.subscription_code;
      if (!code) return { handled: true, action: 'ignored' };
      const sub = await VendorSubscription.findByPaystackCode(code);
      if (!sub) return { handled: true, action: 'unmatched' };
      if (sub.status !== 'cancelled' && sub.status !== 'expired') {
        await VendorSubscription.update(sub.id, {
          status: 'cancelled', cancelAtPeriodEnd: 1, cancelledAt: toSql(new Date()),
        });
      }
      return { handled: true, action: 'cancelled' };
    }

    default:
      return { handled: false };
  }
};
