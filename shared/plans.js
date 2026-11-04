// FILE LOCATION: shared/plans.js
// DESCRIPTION: Single source of truth for the vendor PLAN system — the canonical
//   feature keys a plan can unlock, billing intervals, subscription statuses and
//   the draft plan catalogue seeded by backend/migratePlans.js.
//
//   Imported by:
//     - Backend  (models/planModel.js, models/vendorSubscriptionModel.js,
//                 the plan controller + the pay-for-plan gate)
//     - Frontend (src/constant.ts / plan-selection UI — re-export as needed)
//     - Migration (backend/migratePlans.js seeds DEFAULT_PLAN_DRAFTS)
//
//   Never hard-code a plan slug, feature key or status string anywhere else.
//   Pricing (the plan FEE) is NOT set here — the admin sets each plan's price in
//   the dashboard; the drafts below seed price 0 + inactive so nothing goes live
//   until an admin fills in a price and activates it.

/**
 * Canonical feature keys a plan can grant a vendor. Feature gating (what the
 * vendor dashboard exposes) is driven ENTIRELY by these keys — add a capability
 * here once and every tier can reference it.
 * @type {Readonly<Record<string, string>>}
 */
export const PLAN_FEATURES = Object.freeze({
  STOREFRONT: 'storefront',                 // public storefront page
  ANALYTICS: 'analytics',                   // sales/traffic analytics
  CUSTOM_REQUESTS: 'custom_requests',       // accept bespoke/custom orders
  PROMOTIONS: 'promotions',                 // create coupons / run promotions
  FEATURED_ELIGIBLE: 'featured_eligible',   // eligible for featured/sponsored placement
  INTERNATIONAL_SHIPPING: 'international_shipping', // ship outside Ghana
  BULK_WHOLESALE: 'bulk_wholesale',         // B2B wholesale pricing (Phase 3)
  PRIORITY_SUPPORT: 'priority_support',     // priority support queue
});

/** Every valid feature key, for validation. @type {readonly string[]} */
export const ALL_PLAN_FEATURES = Object.freeze(Object.values(PLAN_FEATURES));

/**
 * @param {unknown} features list to validate
 * @returns {boolean} true when every entry is a known feature key
 */
export const isValidFeatureList = (features) =>
  Array.isArray(features) && features.every((f) => ALL_PLAN_FEATURES.includes(f));

/** Billing cadence for the recurring plan fee. @type {readonly string[]} */
export const BILLING_INTERVALS = Object.freeze(['monthly', 'annually']);

/**
 * Vendor subscription lifecycle:
 *   pending   — created, awaiting first successful payment (portal still locked)
 *   active    — paid and current (dashboard unlocked)
 *   past_due  — a renewal failed; grace before it locks (portal re-locks)
 *   cancelled — vendor/admin cancelled; runs until currentPeriodEnd
 *   expired   — period ended without renewal
 * @type {readonly string[]}
 */
export const SUBSCRIPTION_STATUSES = Object.freeze([
  'pending', 'active', 'past_due', 'cancelled', 'expired',
]);

/** Statuses that keep the vendor dashboard unlocked. @type {readonly string[]} */
export const ACTIVE_SUBSCRIPTION_STATUSES = Object.freeze(['active', 'past_due']);

/**
 * Draft plan catalogue seeded on migration. Higher tier => lower commission
 * (bigger fee, smaller %), per the agreed model. Seeded with price = 0 and
 * isActive = 0 so an admin must set a price before a plan can go live.
 * @type {ReadonlyArray<{slug:string,name:string,description:string,commissionRate:number,features:string[],productLimit:number|null,sortOrder:number}>}
 */
export const DEFAULT_PLAN_DRAFTS = Object.freeze([
  {
    slug: 'starter',
    name: 'Starter',
    description: 'For new Bonwire weavers getting started. Higher commission, core selling tools.',
    commissionRate: 0.12,
    features: [PLAN_FEATURES.STOREFRONT, PLAN_FEATURES.ANALYTICS],
    productLimit: 20,
    sortOrder: 1,
  },
  {
    slug: 'pro',
    name: 'Pro',
    description: 'For established weavers. Lower commission, custom orders, promotions and featured eligibility.',
    commissionRate: 0.10,
    features: [
      PLAN_FEATURES.STOREFRONT,
      PLAN_FEATURES.ANALYTICS,
      PLAN_FEATURES.CUSTOM_REQUESTS,
      PLAN_FEATURES.PROMOTIONS,
      PLAN_FEATURES.FEATURED_ELIGIBLE,
    ],
    productLimit: 100,
    sortOrder: 2,
  },
  {
    slug: 'master',
    name: 'Master Weaver',
    description: 'For top workshops. Lowest commission, unlimited products, international shipping, wholesale and priority support.',
    commissionRate: 0.08,
    features: [...ALL_PLAN_FEATURES],
    productLimit: null,
    sortOrder: 3,
  },
]);
