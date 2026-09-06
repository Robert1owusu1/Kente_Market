import express from "express";
const router = express.Router();
import { protect, admin } from "../middleware/authMiddleware.js";
import { createReturnRequest, getMyReturns, getReturnById, getAllReturns, updateReturnStatus } from "../controllers/returnController.js";

router.route("/").get(protect, admin, getAllReturns).post(protect, createReturnRequest);
router.route("/myreturns").get(protect, getMyReturns); // BEFORE /:id
router.route("/:id").get(protect, getReturnById).put(protect, admin, updateReturnStatus);
export default router;
