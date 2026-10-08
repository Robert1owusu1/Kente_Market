// FILE LOCATION: backend/controllers/couponController.js
// DESCRIPTION: Coupon CRUD and public validation
import Coupon from "../models/couponModel.js";
import pool from "../config/db.js";
import isValidId from "../utils/isValidId.js";
import { auditFromRequest } from "../utils/auditLog.js";

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
    // C2: vendors are capped at 50% (createVendorCoupon), but the admin path
    // had no ceiling at all. >100% is not a discount, it is a negative total —
    // see shared/pricing.js calcCouponDiscount. Mirror the vendor rule so the
    // two create paths agree on what "valid" means.
    if (discountType === "percentage" && parseFloat(discountValue) > 100) {
      return res.status(400).json({ message: "Percentage discounts cannot exceed 100%" });
    }

    const coupon = await Coupon.create({ code, discountType, discountValue, minPurchase, maxUses, expiresAt, isActive });

    await auditFromRequest(req, {
      action: 'coupon.create',
      entityType: 'coupon',
      entityId: coupon?.id,
      after: { code, discountType, discountValue, minPurchase, maxUses },
    });

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

    // C2: this path called `Coupon.update(req.params.id, req.body)` with no
    // validation whatsoever, so an admin PUT could turn an existing 10% coupon
    // into 500% — bypassing the cap createCoupon enforces. Evaluate the
    // EFFECTIVE values (same shape as updateVendorCoupon), so sending only one
    // of discountType/discountValue cannot sneak a >100% coupon through.
    const body = req.body || {};
    const nextType = body.discountType !== undefined ? body.discountType : existing.discountType;
    const nextValue =
      body.discountValue !== undefined
        ? parseFloat(body.discountValue)
        : parseFloat(existing.discountValue);

    if (body.discountType !== undefined && !["percentage", "fixed"].includes(body.discountType)) {
      return res.status(400).json({ message: "Discount type must be 'percentage' or 'fixed'" });
    }
    if (!Number.isFinite(nextValue) || nextValue <= 0) {
      return res.status(400).json({ message: "Discount value must be greater than 0" });
    }
    if (nextType === "percentage" && nextValue > 100) {
      return res.status(400).json({ message: "Percentage discounts cannot exceed 100%" });
    }

    const coupon = await Coupon.update(req.params.id, req.body);
    await auditFromRequest(req, {
      action: 'coupon.update',
      entityType: 'coupon',
      entityId: coupon?.id ?? req.params.id,
      before: existing,
      after: coupon,
    });
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
    await auditFromRequest(req, {
      action: 'coupon.delete',
      entityType: 'coupon',
      entityId: req.params.id,
      before: existing,
    });
    res.json({ message: "Coupon deleted successfully" });
  } catch (error) {
    console.error("deleteCoupon error:", error.message);
    res.status(500).json({ message: "Failed to delete coupon" });
  }
};

// X1: the body every refused code gets. Coupon.validate knows WHY a code was
// refused, and on this endpoint — public, unauthenticated, the one an attacker
// points at a wordlist — that knowledge is exactly what must not leave the
// building. The reason is chosen here rather than passed through.
const REFUSED = 'This coupon cannot be applied to this order';

export const validateCoupon = async (req, res) => {
  try {
    const { code, cartTotal, items } = req.body || {};

    if (!code || !code.trim()) {
      return res.status(400).json({ message: "Coupon code is required" });
    }
    if (cartTotal === undefined || isNaN(cartTotal) || parseFloat(cartTotal) < 0) {
      return res.status(400).json({ message: "A valid cart total is required" });
    }

    // P0-4: optional cart lines let the pre-checkout validator enforce vendor
    // scope early (authoritative check still runs at order placement).
    // Bounded + server-resolved: product ids come from the client but ownership
    // always comes from DB rows.
    let vendorIds;
    if (Array.isArray(items) && items.length > 0) {
      const pids = [...new Set(
        items.slice(0, 50).map((it) => parseInt(it?.product ?? it?.productId ?? it?.id, 10)).filter((v) => Number.isFinite(v))
      )];
      if (pids.length > 0) {
        const placeholders = pids.map(() => "?").join(", ");
        const [rows] = await pool.execute(
          `SELECT id, vendorId FROM product WHERE id IN (${placeholders})`,
          pids
        );
        vendorIds = rows.map((r) => r.vendorId);
      }
    }

    const result = await Coupon.validate(code.trim(), parseFloat(cartTotal), { vendorIds });
    const safeCoupon = Coupon.toPublic(result.coupon);
    if (!result.valid) {
      // X1: one response for all six refusals — unknown, inactive, expired,
      // exhausted, below the minimum, wrong store.
      //
      // Each used to arrive as its own sentence, which let a wordlist probe
      // sort the whole coupon namespace from the text alone: "Coupon not
      // found" against "Coupon has expired" is a binary search over every
      // code an admin ever minted, including ones that have since died —
      // information no caller needs, because the only decision this endpoint
      // informs is whether to attempt the order. Two reasons volunteered more
      // than existence while they were at it: the minimum-purchase figure and
      // the issuing store's id, read straight off the response.
      //
      // The `coupon` field was the quieter half of the same leak: null when
      // the code matched nothing, a populated row when it did, so a caller
      // who ignored the words entirely still had the answer. It goes too.
      //
      // What survives is the one distinction the feature cannot drop — a code
      // supplied correctly still returns 200 with its discount, so a USABLE
      // code remains separable from every other answer. That residual is the
      // product working rather than a channel, and couponValidateLimiter
      // (IP-keyed, both outcomes counted) is what caps how fast it can be
      // farmed. Both answers cost the same single findByCode lookup, so there
      // is no cheaper version of this channel running underneath.
      return res.status(400).json({ message: REFUSED, coupon: null });
    }

    res.json({ message: result.message, coupon: safeCoupon });
  } catch (error) {
    console.error("validateCoupon error:", error.message);
    res.status(500).json({ message: "Failed to validate coupon" });
  }
};
