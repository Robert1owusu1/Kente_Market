// routes/vendorRoutes.js
import express from 'express';
const router = express.Router();

import { protect, admin, vendorOrStaff, requireVendorPermission } from '../middleware/authMiddleware.js';
import {
  applyVendor,
  getMyVendorProfile,
  listVendors,
  updateVendorStatus,
  getMyProducts,
  getVendorInventory,
  createVendorProduct,
  updateVendorProduct,
  deleteVendorProduct,
  getVendorAnalytics,
  getVendorReviews,
  getVendorReturns,
  getVendorCoupons,
  createVendorCoupon,
  updateVendorCoupon,
  deleteVendorCoupon,
  updateVendorProfile,
  withdrawVendorBalance,
  getPublicStorefront,
  getVendorDirectory,
  updateVendorVerification,
} from '../controllers/vendorController.js';
import {
  getVendorOrders,
  updateVendorOrderStatus,
} from '../controllers/vendorOrderController.js';
import { getVendorMessages } from '../controllers/messageController.js';

// Public: GET /api/vendors/store/:slugOrId → public storefront
router.route('/store/:slugOrId').get(getPublicStorefront);

// Public: GET /api/vendors/directory → approved vendors list
router.route('/directory').get(getVendorDirectory);

// GET /api/vendors/messages → messages received by the vendor
router.route('/messages').get(protect, vendorOrStaff, getVendorMessages);

// POST /api/vendors/apply → become/update vendor application (any logged-in user)
router.route('/apply').post(protect, applyVendor);

// GET /api/vendors/me → own vendor profile + escrow summary (vendor or admin)
router.route('/me').get(protect, vendorOrStaff, getMyVendorProfile);

// PUT /api/vendors/profile → update business/storefront profile
router.route('/profile').put(protect, vendorOrStaff, updateVendorProfile);

// GET /api/vendors/analytics → vendor analytics
router.route('/analytics').get(protect, vendorOrStaff, getVendorAnalytics);

// GET /api/vendors/inventory → vendor inventory (stock, SKU, alerts)
router.route('/inventory').get(protect, vendorOrStaff, requireVendorPermission('manage_inventory'), getVendorInventory);

// GET /api/vendors/reviews → reviews on vendor's products
router.route('/reviews').get(protect, vendorOrStaff, getVendorReviews);

// GET /api/vendors/returns → returns for vendor's products
router.route('/returns').get(protect, vendorOrStaff, getVendorReturns);

// GET /api/vendors/coupons → vendor's coupons
// POST /api/vendors/coupons → create vendor coupon
router.route('/coupons').get(protect, vendorOrStaff, requireVendorPermission('manage_coupons'), getVendorCoupons);
router.route('/coupons').post(protect, vendorOrStaff, requireVendorPermission('manage_coupons'), createVendorCoupon);
router.route('/coupons/:id').put(protect, vendorOrStaff, requireVendorPermission('manage_coupons'), updateVendorCoupon);
router.route('/coupons/:id').delete(protect, vendorOrStaff, requireVendorPermission('manage_coupons'), deleteVendorCoupon);

// GET /api/vendors/myproducts → vendor's own products
// POST /api/vendors/products → vendor creates a product
router.route('/myproducts').get(protect, vendorOrStaff, requireVendorPermission('manage_products'), getMyProducts);
router.route('/products').post(protect, vendorOrStaff, requireVendorPermission('manage_products'), createVendorProduct);

// PUT /api/vendors/products/:id → vendor updates own product
// DELETE /api/vendors/products/:id → vendor deletes own product
router.route('/products/:id').put(protect, vendorOrStaff, requireVendorPermission('manage_products'), updateVendorProduct);
router.route('/products/:id').delete(protect, vendorOrStaff, requireVendorPermission('manage_products'), deleteVendorProduct);

// POST /api/vendors/withdraw → vendor withdraws from available wallet balance
router.route('/withdraw').post(protect, vendorOrStaff, requireVendorPermission('view_earnings'), withdrawVendorBalance);

// GET /api/vendors/orders → orders containing this vendor's products
// POST /api/vendors/orders/:id/status → advance fulfilment / post progress
router.route('/orders').get(protect, vendorOrStaff, getVendorOrders);
router.route('/orders/:id/status').post(protect, vendorOrStaff, requireVendorPermission('manage_orders'), updateVendorOrderStatus);

// GET /api/vendors → list all vendors (admin only)
router.route('/').get(protect, admin, listVendors);

// PUT /api/vendors/:id/status → approve/suspend (admin only)
router.route('/:id/status').put(protect, admin, updateVendorStatus);

// PUT /api/vendors/:id/verification → set verification level + badges (admin only)
router.route('/:id/verification').put(protect, admin, updateVendorVerification);

export default router;