// routes/staffRoutes.js
import express from 'express';
const router = express.Router();

import { protect, vendor } from '../middleware/authMiddleware.js';
import { authLimiter } from '../middleware/rateLimitMiddleware.js';
import {
  staffLogin,
  listStaff,
  createStaff,
  updateStaff,
  deleteStaff,
} from '../controllers/staffController.js';

// Mounted at /api/vendors/staff

// POST /api/vendors/staff/login → staff sign-in (public, brute-force limited)
router.route('/login').post(authLimiter, staffLogin);

// GET/POST /api/vendors/staff → list / create
router.route('/').get(protect, vendor, listStaff);
router.route('/').post(protect, vendor, createStaff);

// PUT/DELETE /api/vendors/staff/:id
router.route('/:id').put(protect, vendor, updateStaff);
router.route('/:id').delete(protect, vendor, deleteStaff);

export default router;