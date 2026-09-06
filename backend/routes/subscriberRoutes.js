// FILE LOCATION: backend/routes/subscriberRoutes.js
// DESCRIPTION: Newsletter subscription routes
import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import { subscribeLimiter } from '../middleware/rateLimitMiddleware.js';
import { subscribe, unsubscribe, listSubscribers, getSubscriberCount, exportSubscribers } from '../controllers/subscriberController.js';

const router = express.Router();

// POST /api/subscribe - subscribe (public, rate-limited)
router.post('/', subscribeLimiter, subscribe);

// POST /api/subscribe/unsubscribe - unsubscribe (public, rate-limited)
router.post('/unsubscribe', subscribeLimiter, unsubscribe);

// GET /api/subscribe/count - subscriber count (admin only)
router.get('/count', protect, admin, getSubscriberCount);

// GET /api/subscribe/export - export subscribers as CSV (admin only)
router.get('/export', protect, admin, exportSubscribers);

// GET /api/subscribe - list subscribers (admin only)
router.get('/', protect, admin, listSubscribers);

export default router;
