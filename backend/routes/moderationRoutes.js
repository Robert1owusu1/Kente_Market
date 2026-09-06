// routes/moderationRoutes.js
import express from 'express';
const router = express.Router();

import { protect, admin } from '../middleware/authMiddleware.js';
import {
  listProductsForModeration,
  moderateProduct,
  getModerationStats,
} from '../controllers/productModerationController.js';

// GET /api/admin/moderation/products → pending/any products
router.route('/products').get(protect, admin, listProductsForModeration);
// PUT /api/admin/moderation/products/:id → approve/reject/request changes
router.route('/products/:id').put(protect, admin, moderateProduct);
// GET /api/admin/moderation/stats → moderation queue counts
router.route('/stats').get(protect, admin, getModerationStats);

export default router;