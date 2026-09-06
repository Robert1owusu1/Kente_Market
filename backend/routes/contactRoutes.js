// FILE LOCATION: backend/routes/contactRoutes.js
// DESCRIPTION: Contact/messages routes
import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import { contactLimiter } from '../middleware/rateLimitMiddleware.js';
import { submitContact, listContacts } from '../controllers/contactController.js';

const router = express.Router();

// POST /api/contact - submit a message (public, rate-limited)
router.post('/', contactLimiter, submitContact);

// GET /api/contact - list all messages (admin only)
router.get('/', protect, admin, listContacts);

export default router;
