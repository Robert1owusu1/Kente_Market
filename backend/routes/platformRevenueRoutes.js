// FILE LOCATION: backend/routes/platformRevenueRoutes.js
// DESCRIPTION: Admin platform-earnings reporting routes.
import express from "express";
import { protect, admin } from "../middleware/authMiddleware.js";
import { getPlatformRevenue } from "../controllers/platformRevenueController.js";

const router = express.Router();

// GET /api/admin/platform-revenue → platform earnings summary + daily series
router.route("/").get(protect, admin, getPlatformRevenue);

export default router;
