// FILE LOCATION: backend/routes/wholesaleRoutes.js
// DESCRIPTION: Buyer-facing B2B wholesale quote routes (Phase 3, Step 9).
import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  createQuoteRequest, getMyQuoteRequests, respondToQuote,
  getBulkQuoteCheckoutTotal, checkoutBulkQuote,
} from '../controllers/wholesaleController.js';

const router = express.Router();

router.route('/quotes').post(protect, createQuoteRequest);
router.route('/quotes/mine').get(protect, getMyQuoteRequests);
router.route('/quotes/:id/accept').post(protect, respondToQuote('accept'));
router.route('/quotes/:id/decline').post(protect, respondToQuote('decline'));
// Phase B: pay for an accepted quote → on-platform order + escrow.
router.route('/quotes/:id/checkout-total').get(protect, getBulkQuoteCheckoutTotal);
router.route('/quotes/:id/checkout').post(protect, checkoutBulkQuote);

export default router;
