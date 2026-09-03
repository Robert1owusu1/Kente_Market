// routes/vendorRoutes.js
import express from 'express';
const router = express.Router();

import { protect, admin, vendor } from '../midleware/authMiddleware.js';
import {
  applyVendor,
  getMyVendorProfile,
  listVendors,
  updateVendorStatus,
  getMyProducts,
  createVendorProduct,
} from '../controllers/vendorController.js';

// POST /api/vendors/apply → become/update vendor application (any logged-in user)
router.route('/apply').post(protect, applyVendor);

// GET /api/vendors/me → own vendor profile + escrow summary (vendor or admin)
router.route('/me').get(protect, vendor, getMyVendorProfile);

// GET /api/vendors/myproducts → vendor's own products
// POST /api/vendors/products → vendor creates a product
router.route('/myproducts').get(protect, vendor, getMyProducts);
router.route('/products').post(protect, vendor, createVendorProduct);

// GET /api/vendors → list all vendors (admin only)
router.route('/').get(protect, admin, listVendors);

// PUT /api/vendors/:id/status → approve/suspend (admin only)
router.route('/:id/status').put(protect, admin, updateVendorStatus);

export default router;