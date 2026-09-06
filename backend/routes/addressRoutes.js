import express from "express";
const router = express.Router();
import { protect } from "../middleware/authMiddleware.js";
import { createAddress, getMyAddresses, updateAddress, deleteAddress } from "../controllers/addressController.js";

router.route("/").get(protect, getMyAddresses).post(protect, createAddress);
router.route("/:id").put(protect, updateAddress).delete(protect, deleteAddress);

export default router;
