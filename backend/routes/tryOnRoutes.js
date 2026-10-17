// FILE: backend/routes/tryOnRoutes.js
// DESCRIPTION: AI Virtual Try-On API routes
//
// POST /jobs is the only route here (and one of the few on the platform) that
// spends third-party money per request, so it carries a dedicated per-user
// rate limit IN ADDITION to protect and the generic apiLimiter. The per-user
// daily credit (ai_tryon_usage), the active-job caps and the idempotency key
// in Services/tryOn/tryOnJobService.js are the other layers of the cost bound.
//
// The provider webhook is NOT mounted here: it needs the raw request body for
// its signature, so server.js mounts it before the JSON body parser.

import express from "express";
import {
  createTryOnJob,
  getTryOnJob,
  getTryOnJobResult,
  getProductTryOnEligibility,
  status as tryOnStatus,
} from "../controllers/tryOnController.js";
import { protect } from "../middleware/authMiddleware.js";
import { apiLimiter, tryOnGenerateLimiter } from "../middleware/rateLimitMiddleware.js";

const router = express.Router();

// Public capability flag (no auth needed — plain boolean).
router.get("/status", apiLimiter, tryOnStatus);

// Public per-product eligibility (same visibility rules as the product page;
// no image is read or decoded here).
router.get("/product/:productId", apiLimiter, getProductTryOnEligibility);

// Start a try-on job (requires auth + try-on-specific + general rate limiting)
router.post("/jobs", protect, tryOnGenerateLimiter, apiLimiter, createTryOnJob);

// Owner-only job status and result image
router.get("/jobs/:id", protect, apiLimiter, getTryOnJob);
router.get("/jobs/:id/result", protect, apiLimiter, getTryOnJobResult);

export default router;
