// FILE LOCATION: backend/controllers/couponController.js
// DESCRIPTION: Coupon CRUD and public validation
import Coupon from "../models/couponModel.js";
import isValidId from "../utils/isValidId.js";

export const createCoupon = async (req, res) => {
  try {
    const { code, discountType, discountValue, minPurchase, maxUses, expiresAt, isActive } = req.body || {};

    if (!code || !/^[a-zA-Z0-9]{3,50}$/.test(code.trim())) {
      return res.status(400).json({ message: "Code must be 3-50 alphanumeric characters" });
    }
    if (!discountType || !["percentage", "fixed"].includes(discountType)) {
      return res.status(400).json({ message: "Discount type must be 'percentage' or 'fixed'" });
    }
    if (discountValue === undefined || isNaN(discountValue) || parseFloat(discountValue) <= 0) {
      return res.status(400).json({ message: "Discount value must be greater than 0" });
    }

    const coupon = await Coupon.create({ code, discountType, discountValue, minPurchase, maxUses, expiresAt, isActive });

    res.status(201).json({ message: "Coupon created successfully", coupon });
  } catch (error) {
    console.error("createCoupon error:", error.message);
    res.status(500).json({ message: "Failed to create coupon" });
  }
};

export const getCoupons = async (req, res) => {
  try {
    const coupons = await Coupon.findAll();
    res.json(coupons);
  } catch (error) {
    console.error("getCoupons error:", error.message);
    res.status(500).json({ message: "Failed to fetch coupons" });
  }
};

export const getCouponById = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid coupon id" });
    }
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) {
      return res.status(404).json({ message: "Coupon not found" });
    }
    res.json(coupon);
  } catch (error) {
    console.error("getCouponById error:", error.message);
    res.status(500).json({ message: "Failed to fetch coupon" });
  }
};

export const updateCoupon = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid coupon id" });
    }
    const existing = await Coupon.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "Coupon not found" });
    }

    const coupon = await Coupon.update(req.params.id, req.body);
    res.json({ message: "Coupon updated successfully", coupon });
  } catch (error) {
    console.error("updateCoupon error:", error.message);
    res.status(500).json({ message: "Failed to update coupon" });
  }
};

export const deleteCoupon = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid coupon id" });
    }
    const existing = await Coupon.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "Coupon not found" });
    }
    await Coupon.delete(req.params.id);
    res.json({ message: "Coupon deleted successfully" });
  } catch (error) {
    console.error("deleteCoupon error:", error.message);
    res.status(500).json({ message: "Failed to delete coupon" });
  }
};

export const validateCoupon = async (req, res) => {
  try {
    const { code, cartTotal } = req.body || {};

    if (!code || !code.trim()) {
      return res.status(400).json({ message: "Coupon code is required" });
    }
    if (cartTotal === undefined || isNaN(cartTotal) || parseFloat(cartTotal) < 0) {
      return res.status(400).json({ message: "A valid cart total is required" });
    }

    const result = await Coupon.validate(code.trim(), parseFloat(cartTotal));
    const safeCoupon = Coupon.toPublic(result.coupon);
    if (!result.valid) {
      return res.status(400).json({ message: result.message, coupon: safeCoupon });
    }

    res.json({ message: result.message, coupon: safeCoupon });
  } catch (error) {
    console.error("validateCoupon error:", error.message);
    res.status(500).json({ message: "Failed to validate coupon" });
  }
};
