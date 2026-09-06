import express from "express";
const router = express.Router();
import { protect, admin } from "../middleware/authMiddleware.js";
import { createReport, getAllReports, updateReportStatus } from "../controllers/reportController.js";

router.route("/").get(protect, admin, getAllReports).post(protect, createReport);
router.route("/:id").put(protect, admin, updateReportStatus);
export default router;
