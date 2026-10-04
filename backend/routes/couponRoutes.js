import express from "express";
const router = express.Router();
import { protect, admin } from "../middleware/authMiddleware.js";
import { createCoupon, getCoupons, getCouponById, updateCoupon, deleteCoupon, validateCoupon } from "../controllers/couponController.js";
import { couponValidateLimiter } from "../middleware/rateLimitMiddleware.js";

router.route("/").get(protect, admin, getCoupons).post(protect, admin, createCoupon);
// PUBLIC. Codes may be as short as 3 characters and the validator returns
// distinct messages for not-found / inactive / expired / limit-reached /
// minimum-not-met, so without its own limiter this endpoint is an enumeration
// oracle: a caller could walk the code space and learn each coupon's
// configuration. Tight per-IP limiter closes that.
router.route("/validate").post(couponValidateLimiter, validateCoupon);
router.route("/:id").get(protect, admin, getCouponById).put(protect, admin, updateCoupon).delete(protect, admin, deleteCoupon);
export default router;
