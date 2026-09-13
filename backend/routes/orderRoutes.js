// FILE LOCATION: routes/orderRoutes.js
// DESCRIPTION: Your existing order routes enhanced with caching and analytics

import express from "express";
const router = express.Router();

// Your existing imports (keeping the typo path for now)
import { protect, admin } from "../middleware/authMiddleware.js";

// Your existing controller functions
import {
  addOrderItems,
  getMyOrders,
  getOrderById,
  updateOrderToPaid,
  updateOrderToDelivered,
  confirmOrderReceived,
  getOrders,
  updateOrder,
  deleteOrder,
  cancelOrder,
  retryEscrowPayouts,
} from "../controllers/orderController.js";

// NEW: Import analytics functions (you'll need to add these to orderController.js)
import {
  getOrderStatistics,
  getSalesAnalytics,
  getTopProducts,
  getTopProductTypes,
} from "../controllers/orderController.js";

// NEW: Import middleware for caching and rate limiting
import { cacheMiddleware } from "../middleware/cacheMiddleware.js";
import { apiLimiter, orderLimiter } from "../middleware/rateLimitMiddleware.js";

// ============================================
// APPLY RATE LIMITING TO ALL ORDER ROUTES
// ============================================
router.use(apiLimiter);

/**
 * ============================================
 * ANALYTICS ENDPOINTS (NEW)
 * ============================================
 * ✅ These must come BEFORE generic routes like /:id
 * ✅ Cached for better performance
 */

// 📊 GET /api/orders/statistics → Get order statistics
// Cache for 1 minute (60 seconds)
router.route("/statistics")
  .get(protect, admin, cacheMiddleware(60), getOrderStatistics);

// 📈 GET /api/orders/analytics → Get sales analytics by date range
// Cache for 5 minutes (300 seconds)
router.route("/analytics")
  .get(protect, admin, cacheMiddleware(300), getSalesAnalytics);

// 🏆 GET /api/orders/top-products → Get top selling products
// Cache for 5 minutes (300 seconds)
router.route("/top-products")
  .get(protect, admin, cacheMiddleware(300), getTopProducts);

// 🧵 GET /api/orders/top-product-types → Top selling kente types (categories)
// Cache for 5 minutes (300 seconds)
router.route("/top-product-types")
  .get(protect, admin, cacheMiddleware(300), getTopProductTypes);

/**
 * ============================================
 * MAIN ORDER ROUTES (YOUR EXISTING ROUTES)
 * ============================================
 * ✅ IMPORTANT: Route order matters!
 * /myorders and analytics routes MUST come BEFORE /:id
 * Otherwise Express matches them as /:id where id='myorders'
 */

// 📌 POST /api/orders → Create new order (rate-limited)
// 📌 GET /api/orders → Get all orders (admin only)
router.route("/")
  .post(protect, orderLimiter, addOrderItems)
  .get(protect, admin, getOrders);

// 📌 GET /api/orders/myorders → Get logged-in user's orders
// ✅ MUST BE BEFORE /:id route
// NEW: Added caching for 30 seconds
router.route("/myorders")
  .get(protect, cacheMiddleware(30), getMyOrders);

// 📌 GET /api/orders/:id → Get order by ID
// 📌 PUT /api/orders/:id → Update order (user must be logged in)
// 📌 DELETE /api/orders/:id → Delete order (admin only)
router.route("/:id")
  .get(protect, getOrderById)
  .put(protect, updateOrder)
  .delete(protect, admin, deleteOrder);

// 📌 PUT /api/orders/:id/pay → Mark order as paid (admin only)
router.route("/:id/pay")
  .put(protect, admin, updateOrderToPaid);

// 📌 PUT /api/orders/:id/deliver → Mark order as delivered (admin only)
router.route("/:id/deliver")
  .put(protect, admin, updateOrderToDelivered);

// 📌 POST /api/orders/:id/confirm-received → Customer confirms receipt → release escrow
router.route("/:id/confirm-received")
  .post(protect, confirmOrderReceived);

// 📌 PUT /api/orders/:id/cancel → Cancel order and void escrow (admin only)
router.route("/:id/cancel")
  .put(protect, admin, cancelOrder);

// 📌 POST /api/orders/:id/retry-escrow → Retry failed escrow payouts (admin only)
router.route("/:id/retry-escrow")
  .post(protect, admin, retryEscrowPayouts);

export default router;