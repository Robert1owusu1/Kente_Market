// FILE LOCATION: backend/middleware/planGate.js
// DESCRIPTION: Plan-based feature gating (Phase 2, Step 5). Blocks a vendor
//   action when the vendor's current plan does not include the required
//   feature. Admins bypass. Must run after `vendorOrStaff` (which sets
//   req.user.id to the vendor owner's users.id for both owners and staff).
import { getPlanAccess, hasFeature } from '../Services/planAccessService.js';

/** @param {string} featureKey one of shared/plans.js PLAN_FEATURES */
export const requirePlanFeature = (featureKey) => async (req, res, next) => {
  try {
    if (req.user?.role === 'admin') return next();
    const access = await getPlanAccess(req.user.id);
    if (hasFeature(access, featureKey)) return next();
    return res.status(403).json({
      message: access.hasPlan
        ? 'Your current plan does not include this feature. Upgrade your plan to use it.'
        : 'Choose and pay for a plan to use this feature.',
      code: 'PLAN_FEATURE_REQUIRED',
      feature: featureKey,
    });
  } catch (error) {
    console.error('requirePlanFeature error:', error.message);
    return res.status(500).json({ message: 'Could not verify your plan' });
  }
};
