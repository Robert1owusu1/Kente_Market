// FILE LOCATION: backend/routes/membershipRoutes.js
// DESCRIPTION: Kente Club routes (Phase 3, Step 10) — customer + admin.
import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import { referralMoneyLimiter as moneyLimiter } from '../middleware/rateLimitMiddleware.js';
import {
  getMembershipTiers, getMyMembership, subscribeToMembership, cancelMyMembership,
  adminListMembershipPlans, adminCreateMembershipPlan, adminUpdateMembershipPlan, adminSetMembershipActive,
} from '../controllers/membershipController.js';

export const membershipRouter = express.Router();
membershipRouter.get('/tiers', getMembershipTiers);
membershipRouter.get('/me', protect, getMyMembership);
membershipRouter.post('/subscribe', protect, moneyLimiter, subscribeToMembership);
membershipRouter.delete('/me', protect, cancelMyMembership);

export const adminMembershipRouter = express.Router();
adminMembershipRouter.use(protect, admin);
adminMembershipRouter.route('/plans').get(adminListMembershipPlans).post(adminCreateMembershipPlan);
adminMembershipRouter.route('/plans/:id').put(adminUpdateMembershipPlan);
adminMembershipRouter.route('/plans/:id/activate').put(adminSetMembershipActive);
