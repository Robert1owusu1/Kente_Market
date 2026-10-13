// FILE LOCATION: backend/routes/adminPayoutRoutes.js
// DESCRIPTION: Admin payout investigation + safe recovery (verify-only).
//   GET  /api/admin/payouts/unresolved
//   GET  /api/admin/payouts/:id
//   POST /api/admin/payouts/:id/reconcile   — Paystack verify, apply only what it confirms
//   POST /api/admin/payouts/:id/note        — audited note, no money/status change
import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import {
  listUnresolvedPayouts,
  getPayoutAttempt,
  reconcilePayoutNow,
  addPayoutNote,
} from '../controllers/adminPayoutController.js';

const router = express.Router();

router.use(protect, admin);

router.get('/unresolved', listUnresolvedPayouts);
router.get('/:id', getPayoutAttempt);
router.post('/:id/reconcile', reconcilePayoutNow);
router.post('/:id/note', addPayoutNote);

export default router;
