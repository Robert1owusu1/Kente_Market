// routes/messageRoutes.js
// Buyer <-> vendor enquiries.
import express from 'express';
const router = express.Router();

import { protect, admin, vendor } from '../middleware/authMiddleware.js';
import {
  createMessage,
  replyToMessage,
  customerReply,
  getMyMessages,
  getAllMessages,
  closeMessage,
} from '../controllers/messageController.js';

// POST /api/messages → customer opens a message to a vendor
router.route('/').post(protect, createMessage);

// GET /api/messages/all → admin sees every buyer <-> vendor thread
router.route('/all').get(protect, admin, getAllMessages);

// GET /api/messages/me → messages the customer sent
router.route('/me').get(protect, getMyMessages);

// PUT /api/messages/:id/reply → vendor replies
router.route('/:id/reply').put(protect, vendor, replyToMessage);

// PUT /api/messages/:id/customer-reply → customer follows up on a thread
router.route('/:id/customer-reply').put(protect, customerReply);

// PUT /api/messages/:id/close → vendor closes thread
router.route('/:id/close').put(protect, vendor, closeMessage);

export default router;