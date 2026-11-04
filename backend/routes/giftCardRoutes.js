// FILE LOCATION: backend/routes/giftCardRoutes.js
// DESCRIPTION: Gift card + store credit routes (Phase 3, Step 7).
import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { referralMoneyLimiter as moneyLimiter } from '../middleware/rateLimitMiddleware.js';
import {
  purchaseGiftCard, redeemGiftCardController, getStoreCredit, payOrderWithStoreCreditController,
  applyStoreCreditToOrderController,
} from '../controllers/giftCardController.js';

const router = express.Router();

router.get('/balance', protect, getStoreCredit);
router.post('/purchase', protect, moneyLimiter, purchaseGiftCard);
router.post('/redeem', protect, moneyLimiter, redeemGiftCardController);
router.post('/pay-order', protect, moneyLimiter, payOrderWithStoreCreditController);
router.post('/apply-to-order', protect, moneyLimiter, applyStoreCreditToOrderController);

export default router;
