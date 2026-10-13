// FILE LOCATION: backend/routes/referralRoutes.js
// DESCRIPTION: Referral (ambassador) API — REFERRAL_SYSTEM_DESIGN.md.
//   POST /api/referrals/visit            public: capture a referral link (first link wins)
//   GET  /api/referrals/me               own link, wallet, masked commissions
//   POST /api/referrals/payout-account   register MoMo/bank recipient (Paystack)
//   POST /api/referrals/withdraw         withdraw earnings (Paystack transfer)
//   POST /api/referrals/pay-order        pay a whole pending order with earnings (final)
//   /api/admin/referrals/*               admin only (settings, ambassadors, review, withdrawals)
import express from 'express';
import { referralVisitLimiter as visitLimiter, referralMoneyLimiter as moneyLimiter } from '../middleware/rateLimitMiddleware.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import {
  captureReferralVisit, getMyReferrals, setPayoutAccount, withdrawReferralEarnings, payOrderWithEarnings,
  adminGetReferralSettings, adminUpdateReferralSettings, adminListAmbassadors, adminUpdateAmbassador,
  adminListCommissions, adminReviewCommission, adminListWithdrawals, adminVerifyWithdrawal,
} from '../controllers/referralController.js';

export const referralRouter = express.Router();
referralRouter.post('/visit', visitLimiter, captureReferralVisit);
referralRouter.get('/me', protect, getMyReferrals);
referralRouter.post('/payout-account', protect, moneyLimiter, setPayoutAccount);
referralRouter.post('/withdraw', protect, moneyLimiter, withdrawReferralEarnings);
referralRouter.post('/pay-order', protect, moneyLimiter, payOrderWithEarnings);

export const adminReferralRouter = express.Router();
adminReferralRouter.use(protect, admin);
adminReferralRouter.get('/settings', adminGetReferralSettings);
adminReferralRouter.put('/settings', adminUpdateReferralSettings);
adminReferralRouter.get('/ambassadors', adminListAmbassadors);
adminReferralRouter.put('/ambassadors/:userId', adminUpdateAmbassador);
adminReferralRouter.get('/commissions', adminListCommissions);
adminReferralRouter.post('/commissions/:id/review', adminReviewCommission);
adminReferralRouter.get('/withdrawals', adminListWithdrawals);
adminReferralRouter.post('/withdrawals/:id/verify', adminVerifyWithdrawal);
