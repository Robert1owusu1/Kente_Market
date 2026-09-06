// routes/messageRoutes.js
// Buyer <-> vendor enquiries.
import express from 'express';
const router = express.Router();

import { protect, vendor } from '../middleware/authMiddleware.js';
import {
  createMessage,
  replyToMessage,
  getMyMessages,
  closeMessage,
} from '../controllers/messageController.js';

// POST /api/messages → customer opens a message to a vendor
router.route('/').post(protect, createMessage);

// GET /api/messages/me → messages the customer sent
router.route('/me').get(protect, getMyMessages);

// PUT /api/messages/:id/reply → vendor replies
router.route('/:id/reply').put(protect, vendor, replyToMessage);

// PUT /api/messages/:id/close → vendor closes thread
router.route('/:id/close').put(protect, vendor, closeMessage);

export default router;