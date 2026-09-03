// FILE: backend/routes/tryOnRoutes.js
// DESCRIPTION: AI Virtual Try-On API routes

import express from "express";
import { generateTryOn, getTryOnStatus } from "../controllers/tryOnController.js";
import { protect } from "../midleware/authMiddleware.js";
import { apiLimiter } from "../midleware/rateLimitMiddleware.js";

const router = express.Router();

// Generate a new AI try-on (requires auth + rate limiting)
router.post("/generate", protect, apiLimiter, generateTryOn);

// Get status of a try-on prediction (requires auth)
router.get("/status/:id", protect, getTryOnStatus);

export default router;
