// FILE: backend/routes/tryOnRoutes.js
// DESCRIPTION: AI Virtual Try-On API routes

import express from "express";
import { generateTryOn, getTryOnStatus, status as tryOnStatus } from "../controllers/tryOnController.js";
import { protect } from "../middleware/authMiddleware.js";
import { apiLimiter } from "../middleware/rateLimitMiddleware.js";

const router = express.Router();

// Public capability flag (no auth needed — plain boolean).
router.get("/status", apiLimiter, tryOnStatus);

// Generate a new AI try-on (requires auth + rate limiting)
router.post("/generate", protect, apiLimiter, generateTryOn);

// Get status of a try-on prediction (requires auth)
router.get("/status/:id", protect, getTryOnStatus);

export default router;
