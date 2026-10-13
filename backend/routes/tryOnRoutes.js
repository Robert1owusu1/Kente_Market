// FILE: backend/routes/tryOnRoutes.js
// DESCRIPTION: AI Virtual Try-On API routes
//
// POST /generate is the only route here (and one of the few on the platform)
// that spends third-party money per request, so it carries a dedicated
// per-user rate limit IN ADDITION to protect and the generic apiLimiter. The
// per-user daily credit (ai_tryon_usage) and the in-flight concurrency caps
// in the controller are the other two layers of the cost bound.

import express from "express";
import { generateTryOn, getTryOnStatus, status as tryOnStatus } from "../controllers/tryOnController.js";
import { protect } from "../middleware/authMiddleware.js";
import { apiLimiter, tryOnGenerateLimiter } from "../middleware/rateLimitMiddleware.js";

const router = express.Router();

// Public capability flag (no auth needed — plain boolean).
router.get("/status", apiLimiter, tryOnStatus);

// Generate a new AI try-on (requires auth + try-on-specific + general rate limiting)
router.post("/generate", protect, tryOnGenerateLimiter, apiLimiter, generateTryOn);

// Get status of a try-on prediction (requires auth + ownership of the id)
router.get("/status/:id", protect, getTryOnStatus);

export default router;
