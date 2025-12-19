// FILE: backend/routes/productRoutes.js
// ⭐ GUARANTEED WORKING VERSION - Use individual .get(), .post(), etc.

import express from "express";
const router = express.Router();
import {
  getProducts,
  getProductById,
  getProductsByCategory,
  getFeaturedProducts,
  getTrendingProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getCategories,
} from "../controllers/productController.js";

// ========================================
// DEBUG LOGGING (remove after testing)
// ========================================
router.use((req, res, next) => {
  console.log('🔍 [ROUTE DEBUG] Method:', req.method, '| Path:', req.path, '| Full URL:', req.originalUrl);
  next();
});

// ========================================
// PUBLIC GET ROUTES
// ========================================

// ⭐ CRITICAL: Order matters! Specific routes MUST come BEFORE parameterized routes

// 1. Root route - Get all products
router.get('/', getProducts);

// 2. Specific named routes (BEFORE /:id)
router.get('/categories/list', getCategories);
router.get('/featured', getFeaturedProducts);
router.get('/trending', getTrendingProducts);

// 3. Category route (has parameter but specific path)
router.get('/category/:category', getProductsByCategory);

// 4. ID route (MUST BE LAST among GET routes)
router.get('/:id', getProductById);

// ========================================
// ADMIN ROUTES (POST, PUT, DELETE)
// ========================================

// Create product
router.post('/', createProduct);

// Update product
router.put('/:id', updateProduct);

// Delete product
router.delete('/:id', deleteProduct);

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