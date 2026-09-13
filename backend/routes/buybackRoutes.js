// FILE LOCATION: backend/routes/buybackRoutes.js
// DESCRIPTION: Sell-back / borrow-back loop. Customers offer delivered items
//              back; admins approve (re-popping stock) or decline.
import express from 'express';
const router = express.Router();
import { protect, admin } from '../middleware/authMiddleware.js';
import {
  createBuybackRequest,
  getMyBuybackRequests,
  listBuybackRequests,
  reviewBuybackRequest,
} from '../controllers/buybackController.js';

// Customer-facing
router.route('/orders/:orderId/buyback').post(protect, createBuybackRequest);
router.route('/orders/my-buyback').get(protect, getMyBuybackRequests);

// Admin oversight
router.route('/admin/buyback').get(protect, admin, listBuybackRequests);
router.route('/admin/buyback/:id').put(protect, admin, reviewBuybackRequest);

export default router;