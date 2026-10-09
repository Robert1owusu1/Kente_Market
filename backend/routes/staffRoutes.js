// routes/staffRoutes.js
import express from 'express';
const router = express.Router();

import { vendorOrStaff, requireVendorPermission } from '../middleware/authMiddleware.js';
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

// GET/POST /api/vendors/staff → list / create.
// `manage_staff` is grantable so an owner can delegate staff administration
// to a trusted employee. The wiring is safe only because of the GRANT
// CEILING in staffController.js: a staff caller can never grant a permission
// they do not hold, and can never ADD `manage_staff` — so these routes cannot
// be used to climb privileges or mint another manager. Owners and admins
// pass requireVendorPermission unconditionally: for them this is the same
// owner-only gate as before.
router.route('/').get(vendorOrStaff, requireVendorPermission('manage_staff'), listStaff);
router.route('/').post(vendorOrStaff, requireVendorPermission('manage_staff'), createStaff);

// PUT/DELETE /api/vendors/staff/:id — same ceiling applies on update.
router.route('/:id').put(vendorOrStaff, requireVendorPermission('manage_staff'), updateStaff);
router.route('/:id').delete(vendorOrStaff, requireVendorPermission('manage_staff'), deleteStaff);

export default router;