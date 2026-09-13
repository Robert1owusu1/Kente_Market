// FILE LOCATION: backend/routes/reviewRoutes.js
// DESCRIPTION: Product review routes
import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import {
  createReview,
  getProductReviews,
  getAllReviews,
  updateReview,
  deleteReview,
  updateReviewStatus,
  addOrderReview,
  getReviewAnalytics,
} from '../controllers/reviewController.js';

const router = express.Router();

// GET /api/reviews - all reviews (public)
router.get('/', getAllReviews);

// GET /api/reviews/product/:productId - reviews for a product (public)
router.get('/product/:productId', getProductReviews);

// POST /api/reviews - create/update a review (authenticated)
router.post('/', protect, createReview);

// POST /api/reviews/order - verified purchase review (after delivery)
router.post('/order', protect, addOrderReview);

// GET /api/reviews/analytics - admin review + satisfaction analytics
router.get('/analytics', protect, admin, getReviewAnalytics);

// PUT /api/reviews/:id - edit review (owner or admin)
router.put('/:id', protect, updateReview);

// PUT /api/reviews/:id/status - admin moderation
router.put('/:id/status', protect, admin, updateReviewStatus);

// DELETE /api/reviews/:id - delete review (owner or admin)
router.delete('/:id', protect, deleteReview);

export default router;
