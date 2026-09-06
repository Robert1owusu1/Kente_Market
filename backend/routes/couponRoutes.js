import express from "express";
const router = express.Router();
import { protect, admin } from "../middleware/authMiddleware.js";
import { createCoupon, getCoupons, getCouponById, updateCoupon, deleteCoupon, validateCoupon } from "../controllers/couponController.js";

router.route("/").get(protect, admin, getCoupons).post(protect, admin, createCoupon);
router.route("/validate").post(validateCoupon); // PUBLIC
router.route("/:id").get(protect, admin, getCouponById).put(protect, admin, updateCoupon).delete(protect, admin, deleteCoupon);
export default router;
