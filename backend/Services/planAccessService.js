// @ts-check
// FILE LOCATION: backend/Services/planAccessService.js
// DESCRIPTION: Resolve what a vendor's current plan unlocks (Phase 2, Step 5).
//   Feature gating is only ENFORCED for vendors on a plan. When the plan system
//   is not being enforced (vendorPlans.required off) and the vendor has no
//   subscription, everything is allowed — so existing stores keep working
//   exactly as before the plan system shipped.
import Plan from '../models/planModel.js';
import VendorSubscription from '../models/vendorSubscriptionModel.js';
import Setting from '../models/settingModel.js';
import { ALL_PLAN_FEATURES } from '../../shared/plans.js';

/**
 * @typedef {Object} PlanAccess
 * @property {boolean} enforced   when false, every feature is allowed (legacy mode)
 * @property {boolean} hasPlan    the vendor has an active subscription
 * @property {string[]} features  feature keys the vendor's plan grants
 * @property {number|null} productLimit  max active products (null = unlimited)
 * @property {string|null} planName
 */

/**
 * @param {number} vendorUserId users.id of the vendor
 * @returns {Promise<PlanAccess>}
 */
export const getPlanAccess = async (vendorUserId) => {
  const sub = await VendorSubscription.findCurrent(vendorUserId);
  if (sub) {
    const plan = await Plan.findById(sub.planId);
    return {
      enforced: true,
      hasPlan: true,
      features: plan ? plan.features : [],
      productLimit: plan ? plan.productLimit : null,
      planName: plan ? plan.name : null,
    };
  }

  // No active subscription: enforce only if the gate is on.
  let required = false;
  try {
    const s = await Setting.get('vendorPlans.required');
    required = s === true || s === 'true';
  } catch { /* default off */ }

  if (!required) {
    // Legacy / plan system off — allow everything.
    return { enforced: false, hasPlan: false, features: [...ALL_PLAN_FEATURES], productLimit: null, planName: null };
  }
  // Plans required but none active — nothing is unlocked (dashboard is locked too).
  return { enforced: true, hasPlan: false, features: [], productLimit: 0, planName: null };
};

/**
 * @param {PlanAccess} access
 * @param {string} featureKey
 * @returns {boolean}
 */
export const hasFeature = (access, featureKey) =>
  !access.enforced || access.features.includes(featureKey);
