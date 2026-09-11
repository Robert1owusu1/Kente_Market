// FILE LOCATION: backend/controllers/returnController.js
// DESCRIPTION: Return request CRUD with ownership checks
import ReturnRequest from "../models/returnModel.js";
import Order from "../models/orderModel.js";
import { voidEscrowForOrder } from "../Services/escrowService.js";
import paystackServices from "../Services/paystackservices.js";
import isValidId from "../utils/isValidId.js";

const VALID_STATUSES = ["pending", "approved", "rejected", "completed"];
const VALID_REASONS = ["damaged", "wrong_item", "not_as_described", "changed_mind", "other"];

export const createReturnRequest = async (req, res) => {
  try {
    const { orderId, reason, description } = req.body || {};

    if (!isValidId(orderId)) {
      return res.status(400).json({ message: "Valid order id is required" });
    }
    if (!reason || !VALID_REASONS.includes(reason)) {
      return res.status(400).json({ message: `Reason must be one of: ${VALID_REASONS.join(", ")}` });
    }

    const order = await Order.findById(parseInt(orderId));
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (order.userId !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ message: "You can only return your own orders" });
    }

    // Returns only make sense for orders that were actually paid for.
    if (order.paymentStatus !== "paid") {
      return res.status(400).json({ message: "You can only request a return on a paid order" });
    }

    // Prevent duplicate open return requests against the same order (avoids an
    // unlimited pile-up of pending approvals / escrow voids for one order).
    const existingReturns = await ReturnRequest.findByOrder(parseInt(orderId));
    const hasOpenReturn = existingReturns.some((r) =>
      ["pending", "approved", "completed"].includes(r.status)
    );
    if (hasOpenReturn) {
      return res.status(400).json({
        message: "A return request is already in progress for this order",
      });
    }

    const returnRequest = await ReturnRequest.create({
      orderId: parseInt(orderId),
      userId: req.user.id,
      reason: reason.trim(),
      description: description || null,
    });

    res.status(201).json({ message: "Return request submitted successfully", returnRequest });
  } catch (error) {
    console.error("createReturnRequest error:", error.message);
    res.status(500).json({ message: "Failed to create return request" });
  }
};

export const getMyReturns = async (req, res) => {
  try {
    const returns = await ReturnRequest.findByUser(req.user.id);
    res.json(returns);
  } catch (error) {
    console.error("getMyReturns error:", error.message);
    res.status(500).json({ message: "Failed to fetch return requests" });
  }
};

export const getReturnById = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid return request id" });
    }

    const returnRequest = await ReturnRequest.findById(req.params.id);
    if (!returnRequest) {
      return res.status(404).json({ message: "Return request not found" });
    }

    if (returnRequest.userId !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json(returnRequest);
  } catch (error) {
    console.error("getReturnById error:", error.message);
    res.status(500).json({ message: "Failed to fetch return request" });
  }
};

export const getAllReturns = async (req, res) => {
  try {
    const returns = await ReturnRequest.findAll();
    res.json(returns);
  } catch (error) {
    console.error("getAllReturns error:", error.message);
    res.status(500).json({ message: "Failed to fetch return requests" });
  }
};

export const updateReturnStatus = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid return request id" });
    }

    const { status, adminNotes } = req.body || {};
    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ message: `Status must be one of: ${VALID_STATUSES.join(", ")}` });
    }

    const existing = await ReturnRequest.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "Return request not found" });
    }

    const returnRequest = await ReturnRequest.updateStatus(req.params.id, status, adminNotes);

    // When a return is approved, void the escrow so funds are not paid to the
    // vendor. Held allocations are voided and the order escrowStatus recomputed.
    if (status === 'approved' && existing.orderId) {
      try {
        await voidEscrowForOrder(existing.orderId);
      } catch (err) {
        console.warn(`⚠️ Could not void escrow for return ${req.params.id}: ${err.message}`);
      }

      // Money integrity: voiding escrow returns funds to the platform, but the
      // customer has already been charged. Push a real Paystack refund so the
      // money actually goes back to the customer, not just the platform.
      try {
        const order = await Order.findById(existing.orderId);
        if (order && order.paymentStatus === 'paid' && order.paymentReference) {
          const refund = await paystackServices.refundTransaction(
            order.paymentReference,
            undefined,
            `Return ${req.params.id} approved`
          );
          if (!refund?.status) {
            console.warn(`⚠️ Return ${req.params.id}: Paystack refund rejected (${refund?.message || 'unknown'}) — manual refund required`);
          } else {
            console.log(`✅ Return ${req.params.id}: customer refunded via Paystack`);
          }
        }
      } catch (refundErr) {
        console.warn(`⚠️ Return ${req.params.id}: refund error (${refundErr.message}) — manual refund required`);
      }
    }

    res.json({ message: "Return request status updated", returnRequest });
  } catch (error) {
    console.error("updateReturnStatus error:", error.message);
    res.status(500).json({ message: "Failed to update return request" });
  }
};
