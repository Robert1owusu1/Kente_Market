import express from "express";
const router = express.Router();
import { protect } from "../middleware/authMiddleware.js";
import {
  addPaymentMethod,
  getMyPaymentMethods,
  setDefaultPaymentMethod,
  deletePaymentMethod,
} from "../controllers/paymentMethodController.js";

router.route("/").get(protect, getMyPaymentMethods).post(protect, addPaymentMethod);
router.route("/:id").delete(protect, deletePaymentMethod);
router.route("/:id/default").put(protect, setDefaultPaymentMethod);

export default router;
