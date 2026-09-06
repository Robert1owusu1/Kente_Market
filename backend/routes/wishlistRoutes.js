import express from "express";
const router = express.Router();
import { protect } from "../middleware/authMiddleware.js";
import { addToWishlist, removeFromWishlist, getMyWishlist, checkWishlist } from "../controllers/wishlistController.js";

router.route("/").get(protect, getMyWishlist).post(protect, addToWishlist);
router.route("/check/:productId").get(protect, checkWishlist);
router.route("/:productId").delete(protect, removeFromWishlist);
export default router;
