import express from "express";
const router = express.Router();
import { protect } from "../middleware/authMiddleware.js";
import {
  getSupportedCountries,
  getAddressConfig,
  validateAddress,
  getShippingOptions,
  checkVendorShippingEligibility
} from "../controllers/internationalCheckoutController.js";

// Public endpoints (no auth required for address validation during checkout)
router.get("/countries", getSupportedCountries);
router.get("/countries/:countryCode", getAddressConfig);
router.post("/validate-address", validateAddress);
router.post("/shipping-options", getShippingOptions);

// Protected endpoints
router.post("/vendor-eligibility", protect, checkVendorShippingEligibility);

export default router;
