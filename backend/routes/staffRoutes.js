// routes/staffRoutes.js
import express from 'express';
const router = express.Router();

import { protect, vendor } from '../middleware/authMiddleware.js';
import { staffAuthLimiter, accountAuthLimiter } from '../middleware/rateLimitMiddleware.js';
import {
  staffLogin,
  listStaff,
  createStaff,
  updateStaff,
  deleteStaff,
} from '../controllers/staffController.js';

// Mounted at /api/vendors/staff

// POST /api/vendors/staff/login → staff sign-in (public, brute-force limited)
// `staffAuthLimiter` bounds email+IP; `accountAuthLimiter` bounds the target
// account alone, so rotating X-Forwarded-For (which invalidates the IP half of
// the first key) still cannot grind one staff account.
router.route('/login').post(staffAuthLimiter, accountAuthLimiter, staffLogin);

// GET/POST /api/vendors/staff → list / create
router.route('/').get(protect, vendor, listStaff);
router.route('/').post(protect, vendor, createStaff);

// PUT/DELETE /api/vendors/staff/:id
router.route('/:id').put(protect, vendor, updateStaff);
router.route('/:id').delete(protect, vendor, deleteStaff);

export default router;