// FILE LOCATION: backend/routes/reviewRoutes.js
// DESCRIPTION: Product review routes
import express from 'express';
import { protect } from '../midleware/authMiddleware.js';
import {
  createReview,
  getProductReviews,
  getAllReviews,
} from '../controllers/reviewController.js';

const router = express.Router();

// POST /api/reviews - create/update a review (authenticated)
router.post('/', protect, createReview);

// GET /api/reviews - all reviews (public)
router.get('/', getAllReviews);

// GET /api/reviews/product/:productId - reviews for a product (public)
router.get('/product/:productId', getProductReviews);

export default router;
