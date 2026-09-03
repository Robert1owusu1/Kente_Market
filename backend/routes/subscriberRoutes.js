// FILE LOCATION: backend/routes/subscriberRoutes.js
// DESCRIPTION: Newsletter subscription routes
import express from 'express';
import { protect, admin } from '../midleware/authMiddleware.js';
import { subscribeLimiter } from '../midleware/rateLimitMiddleware.js';
import { subscribe, unsubscribe, listSubscribers } from '../controllers/subscriberController.js';

const router = express.Router();

// POST /api/subscribe - subscribe (public, rate-limited)
router.post('/', subscribeLimiter, subscribe);

// POST /api/subscribe/unsubscribe - unsubscribe (public, rate-limited)
router.post('/unsubscribe', subscribeLimiter, unsubscribe);

// GET /api/subscribe - list subscribers (admin only)
router.get('/', protect, admin, listSubscribers);

export default router;
