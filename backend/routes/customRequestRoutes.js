// FILE LOCATION: backend/routes/customRequestRoutes.js
// DESCRIPTION: Customer <-> vendor custom kente request workflow.
import express from 'express';
const router = express.Router();
import { protect, admin, vendorOrStaff, requireVendorPermission } from '../middleware/authMiddleware.js';
import {
  createRequest,
  getMyRequests,
  acceptRequest,
  cancelRequest,
  checkoutRequest,
  listVendorRequests,
  quoteRequest,
  declineRequest,
  startRequest,
  listAllRequests,
  getAdminStats,
  markReviewed,
} from '../controllers/customRequestController.js';

// ============================================
// CUSTOMER ROUTES
// ============================================
router.route('/').post(protect, createRequest);
router.route('/my').get(protect, getMyRequests);

// ============================================
// VENDOR ROUTES (guarded with vendorOrStaff)
// ============================================
router.route('/vendor').get(vendorOrStaff, requireVendorPermission('view_customers'), listVendorRequests);

// ============================================
// ADMIN OVERSIGHT
// ============================================
router.route('/admin').get(protect, admin, listAllRequests);
router.route('/admin/stats').get(protect, admin, getAdminStats);

// ============================================
// SHARED RESOURCE ROUTES — /:id must be LAST
// ============================================
router.route('/:id').get(protect, async (req, res, next) => {
  // Delegate ownership checks to the controller instead of middleware.
  next();
}, async (req, res) => {
  // Re-import inline to avoid circular ESM issues.
  const { default: CustomRequest } = await import('../models/customRequestModel.js');
  try {
    const request = await CustomRequest.findById(parseInt(req.params.id));
    if (!request) return res.status(404).json({ message: "Request not found" });
    const isOwner = request.customerId === req.user.id;
    const isVendor = request.vendorId === req.user.id;
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isVendor && !isAdmin) {
      return res.status(403).json({ message: "Not authorized" });
    }
    res.json(request);
  } catch (error) {
    console.error("❌ getRequest error:", error.message);
    res.status(500).json({ message: "Failed to fetch request" });
  }
});

// Customer actions (quoted → accepted or cancelled)
router.route('/:id/accept').post(protect, acceptRequest);
router.route('/:id/cancel').post(protect, cancelRequest);
router.route('/:id/checkout').post(protect, checkoutRequest);

// Vendor actions (pending → quoted or declined; paid → in_progress)
router.route('/:id/quote').post(vendorOrStaff, requireVendorPermission('view_customers'), quoteRequest);
router.route('/:id/decline').post(vendorOrStaff, requireVendorPermission('view_customers'), declineRequest);
router.route('/:id/in-progress').post(vendorOrStaff, requireVendorPermission('view_customers'), startRequest);

// Admin action (mark conversation complete for customer-support follow-up)
router.route('/:id/reviewed').post(protect, admin, markReviewed);

export default router;