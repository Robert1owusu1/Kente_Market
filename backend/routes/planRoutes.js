// FILE LOCATION: backend/routes/planRoutes.js
// DESCRIPTION: Admin vendor-plan management routes (Phase 2, Step 4).
import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import {
  adminListPlans,
  adminCreatePlan,
  adminUpdatePlan,
  adminSetPlanActive,
  getPlanSettings,
  updatePlanSettings,
} from '../controllers/planController.js';

const router = express.Router();

// /settings must precede /:id so it is not captured as an id.
router.route('/settings').get(protect, admin, getPlanSettings).put(protect, admin, updatePlanSettings);
router.route('/').get(protect, admin, adminListPlans).post(protect, admin, adminCreatePlan);
router.route('/:id').put(protect, admin, adminUpdatePlan);
router.route('/:id/activate').put(protect, admin, adminSetPlanActive);

export default router;
