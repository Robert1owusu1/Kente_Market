// FILE: backend/routes/productRoutes.js
// ⭐ GUARANTEED WORKING VERSION - Use individual .get(), .post(), etc.

import express from "express";
const router = express.Router();
import { protect, admin } from "../middleware/authMiddleware.js";
import { cacheMiddleware } from "../middleware/cacheMiddleware.js";
import {
  getProducts,
  getProductById,
  getProductsByCategory,
  getFeaturedProducts,
  getTrendingProducts,
  getMuseumPieces,
  createProduct,
  updateProduct,
  deleteProduct,
  getCategories,
} from "../controllers/productController.js";

// ========================================
// PUBLIC GET ROUTES (cached - read-heavy)
// ========================================

// ⭐ CRITICAL: Order matters! Specific routes MUST come BEFORE parameterized routes

// 1. Root route - Get all products (cached 60s)
router.get('/', cacheMiddleware(60), getProducts);

// 2. Specific named routes (BEFORE /:id)
router.get('/categories/list', cacheMiddleware(300), getCategories);
router.get('/featured', cacheMiddleware(60), getFeaturedProducts);
router.get('/trending', cacheMiddleware(60), getTrendingProducts);
router.get('/museum', cacheMiddleware(60), getMuseumPieces);

// 3. Category route (has parameter but specific path)
router.get('/category/:category', cacheMiddleware(60), getProductsByCategory);

// 4. ID route (MUST BE LAST among GET routes)
router.get('/:id', cacheMiddleware(60), getProductById);

// ========================================
// ADMIN ROUTES (POST, PUT, DELETE)
// ========================================

// Create product (admin only)
router.post('/', protect, admin, createProduct);

// Update product (admin only)
router.put('/:id', protect, admin, updateProduct);

// Delete product (admin only)
router.delete('/:id', protect, admin, deleteProduct);

// ========================================
// EXPORT
// ========================================
export default router;

// ========================================
// ROUTE ORDER EXPLANATION
// ========================================
/*
WHY ORDER MATTERS:

Express matches routes top-to-bottom. When it sees a request like:
  GET /api/products/featured

It checks routes in order:
  1. '/' - No match (looking for /featured)
  2. '/categories/list' - No match
  3. '/featured' - ✅ MATCH! Calls getFeaturedProducts()
  4. ... (never reaches here)

If you put '/:id' BEFORE '/featured':
  GET /api/products/featured
  
  1. '/' - No match
  2. '/:id' - ✅ MATCH! Calls getProductById('featured') ❌ WRONG!
  3. '/featured' - Never reached

So ALWAYS put specific routes before parameterized routes!
*/