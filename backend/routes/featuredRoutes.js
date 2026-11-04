// FILE LOCATION: backend/routes/featuredRoutes.js
// DESCRIPTION: Admin featured-listing pricing/config (Phase 3, Step 8).
import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import { adminGetFeaturedConfig, adminUpdateFeaturedConfig } from '../controllers/featuredController.js';

const router = express.Router();
router.route('/config').get(protect, admin, adminGetFeaturedConfig).put(protect, admin, adminUpdateFeaturedConfig);
export default router;
