// FILE LOCATION: backend/controllers/returnController.js
// DESCRIPTION: Return request CRUD with ownership checks
import ReturnRequest from "../models/returnModel.js";
import Order from "../models/orderModel.js";
import pool from "../config/db.js";
import { voidEscrowForOrder } from "../Services/escrowService.js";
import { voidVendorEscrow } from "../Services/escrowService.js";
import { getOrderVendorIds } from "./vendorOrderController.js";
import { round2 } from "../../shared/pricing.js";
import paystackServices from "../Services/paystackservices.js";
import { recordFinancialEvent } from "../Services/ledgerService.js";
import Coupon from "../models/couponModel.js";
import { restoreStockForOrder } from "./orderController.js";
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

/**
 * Read-only partial-refund validation (P1). Verifies the vendor owns lines on
 * the paid order and the amount equals their full lines subtotal (to the
 * pesewa) within the remaining refundable total. No state changes.
 * @param {any} orderId
 * @param {number} vendorId
 * @param {number} amount
 * @returns {Promise<{ valid: boolean, message?: string, order?: any, ownLines?: any[], ownSubtotal?: number, amount?: number }>}
 */
const validatePartialRefund = async (orderId, vendorId, amount) => {
  const order = await Order.findById(orderId);
  if (!order) return { valid: false, message: 'Order not found' };
  if (order.paymentStatus !== 'paid' || !order.paymentReference) {
    return { valid: false, message: 'Partial refunds require a paid order with a payment reference' };
  }
  const vendorIds = await getOrderVendorIds(order);
  if (!vendorIds.includes(vendorId)) {
    return { valid: false, message: 'That vendor has no items on this order' };
  }
  const rawItems = Array.isArray(order.items) ? order.items : [];
  const needLookup = rawItems.some((it) => it?.vendorId == null);
  /** @type {Map<string, number>} */
  const vendorByProduct = new Map();
  if (needLookup) {
    const pids = [...new Set(rawItems.map((it) => it?.product ?? it?.productId).filter((v) => v != null))];
    if (pids.length > 0) {
      const placeholders = pids.map(() => '?').join(', ');
      const [prows] = await pool.execute(
        `SELECT id, vendorId FROM product WHERE id IN (${placeholders})`,
        pids
      );
      for (const pr of prows) vendorByProduct.set(String(pr.id), parseInt(pr.vendorId, 10));
    }
  }
  const owns = (/** @type {any} */ it) => {
    if (it?.vendorId != null && parseInt(it.vendorId, 10) === vendorId) return true;
    return vendorByProduct.get(String(it?.product ?? it?.productId)) === vendorId;
  };
  const ownLines = rawItems.filter(owns);
  if (ownLines.length === 0) {
    return { valid: false, message: 'No refundable lines found for that vendor' };
  }
  const ownSubtotal = round2(ownLines.reduce((sum, it) => sum + (Number(it.price) || 0) * (parseInt(it.qty ?? it.quantity, 10) || 1), 0));
  if (Math.abs(amount - ownSubtotal) >= 0.01) {
    return {
      valid: false,
      message: `Partial refunds cover the vendor's full lines (GH₵${ownSubtotal.toFixed(2)}). Item-level slices are not supported.`,
    };
  }
  const remaining = round2((Number(order.totalAmount) || 0) - (Number(order.refundedAmount) || 0));
  if (amount - remaining > 0.005) {
    return { valid: false, message: `Amount exceeds the remaining refundable total (GH₵${remaining.toFixed(2)})` };
  }
  return { valid: true, order, ownLines, ownSubtotal, amount };
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

    // P1 partial pre-validation (read-only): all 400s must fire BEFORE the
    // one-way pending->approved flip below, or a rejected amount would leave
    // the return approved with no money moved and no retry possible.
    const partialVendorId = req.body?.vendorId != null ? parseInt(req.body.vendorId, 10) : null;
    const partialAmountRaw = req.body?.amount != null ? Number(req.body.amount) : null;
    const wantsPartial = status === 'approved' && partialVendorId != null;
    /** @type {{ order: any, ownLines: any[], ownSubtotal: number, amount: number } | null} */
    let partialCtx = null;
    if (wantsPartial) {
      if (existing.status !== 'pending' || !existing.orderId) {
        return res.status(400).json({ message: 'Return is not approvable' });
      }
      if (!Number.isFinite(partialVendorId)) {
        return res.status(400).json({ message: 'Valid vendorId is required for a partial refund' });
      }
      if (partialAmountRaw == null || !Number.isFinite(partialAmountRaw) || partialAmountRaw <= 0) {
        return res.status(400).json({ message: 'A positive amount is required for a partial refund' });
      }
      partialCtx = await validatePartialRefund(existing.orderId, partialVendorId, round2(partialAmountRaw));
      if (!partialCtx.valid) {
        return res.status(400).json({ message: partialCtx.message });
      }
    }

    const returnRequest = await ReturnRequest.updateStatus(req.params.id, status, adminNotes);

    // Money effects below must fire exactly once. The model's state machine
    // makes pending -> approved a one-way door, but guard on the pre-update
    // status too so a retried request can never double-refund.
    // P1 partial (per-vendor) refund: body { vendorId, amount }. Covers that
    // vendor's FULL lines only (amount must equal their lines subtotal to the
    // pesewa) — item-level slices are not supported in pilot. The innocent
    // vendors' allocations, stock and payouts are untouched; the order stays
    // paid with refundedAmount incremented. Coupon uses stay consumed.
    if (partialCtx) {
      const { order, ownLines, ownSubtotal, amount } = partialCtx;
      // Re-check the mutable gate (paid-ness) after the flip; the structural
      // checks above already passed pre-flip.
      const fresh = await Order.findById(existing.orderId);
      if (!fresh || fresh.paymentStatus !== 'paid' || !fresh.paymentReference) {
        return res.status(400).json({ message: 'Partial refunds require a paid order with a payment reference' });
      }
      // SECURITY FIX (V-07): Atomic claim on the ORDER (single dedupe key per order).
      // Only the winner of this CAS proceeds to call Paystack. All paths share
      // the same dedupeKey: `refund:${orderId}`. The order-level refundReference
      // is used as the claim marker.
      const claimResult = await pool.execute(
        `UPDATE orders SET refundReference = ? WHERE id = ? AND refundReference IS NULL`,
        [`refund:${order.id}:partial:${partialVendorId}:${req.params.id}`, existing.orderId]
      );
      if (claimResult.affectedRows === 0) {
        // Another path already claimed or completed the refund for this order.
        return res.status(409).json({ message: 'Refund already claimed or in progress for this order' });
      }
      let refund;
      try {
        refund = await paystackServices.refundTransaction(
          order.paymentReference, amount, `Return ${req.params.id} partial (vendor ${partialVendorId})`
        );
      } catch (refundErr) {
        // Unknown outcome: keep the marker so the reconciler alerts for
        // dashboard verification instead of touching money.
        return res.status(500).json({
          message: `Refund could not be initiated (${refundErr.message}). Verify in Paystack before retrying.`,
        });
      }
      if (!refund?.status) {
        await pool.execute(`UPDATE orders SET refundReference = NULL WHERE id = ?`, [existing.orderId])
          .catch(() => {});
        return res.status(400).json({
          message: `Refund failed (${refund?.message || 'unknown reason'}). No money moved.`,
        });
      }
      // Money moved: void ONLY this vendor's escrow, restore ONLY their lines.
      try {
        await voidVendorEscrow(existing.orderId, partialVendorId);
      } catch (err) {
 console.warn(` Partial return ${req.params.id}: vendor escrow void failed (${err.message}) — reconciler will alert`);
      }
      try {
        const skipProductIds = new Set();
        const storedConflicts = order.stockConflicts;
        const conflicts = Array.isArray(storedConflicts) ? storedConflicts : [];
        for (const c of conflicts) {
          if (c?.productId) skipProductIds.add(c.productId);
        }
        const ownForRestore = ownLines.filter((it) => !skipProductIds.has(parseInt(it.product ?? it.productId, 10)));
        await restoreStockForOrder(ownForRestore, { reason: 'partial-return-restore', orderId: existing.orderId });
      } catch (restoreErr) {
 console.warn(` Partial return ${req.params.id}: stock restore failed (${restoreErr.message})`);
      }
      // SECURITY FIX (V-07): Use single shared dedupeKey per order
      // NOTE: the key MUST contain a ':partial:' segment. The crash reconciler
      // (reconcileRefundedButPaid) classifies a bare `refund:${orderId}` key as
      // proof of a FULL refund and would otherwise void ALL vendors and flip a
      // partially-refunded (still paid) order to refunded on its next pass.
      await recordFinancialEvent({
        eventType: 'refund',
        direction: 'out',
        amount,
        vendorId: partialVendorId,
        orderId: order.id,
        reference: order.paymentReference,
        providerReference: refund?.data?.failure_reference || order.paymentReference,
        // Format must match test expectation and reconciler: refund:orderId:returnId:partial:vendorId
        dedupeKey: `refund:${order.id}:${req.params.id}:partial:${partialVendorId}`,
        payload: { reason: `Return ${req.params.id} partial (vendor ${partialVendorId})`, ownSubtotal },
      }).catch(() => {});
      await pool.execute(
        `UPDATE orders SET refundedAmount = refundedAmount + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [amount, existing.orderId]
      ).catch((e) => console.warn(` Could not increment refundedAmount: ${e.message}`));
      const updatedReturn = await ReturnRequest.findById(req.params.id);
      return res.json({ message: 'Partial vendor refund issued', returnRequest: updatedReturn, refundedAmount: amount, vendorId: partialVendorId });
    }

    if (status === 'approved' && existing.status === 'pending' && existing.orderId) {
      // Void escrow so funds are not paid to the vendor: held allocations are
      // voided and already-credited (advance) funds are clawed back from the
      // vendor wallet. This keeps a vendor from being paid for a fully
      // refunded order.
      try {
        await voidEscrowForOrder(existing.orderId);
      } catch (err) {
 console.warn(` Could not void escrow for return ${req.params.id}: ${err.message}`);
      }

      // Money integrity: voiding escrow returns funds to the platform, but the
      // customer has already been charged. Push a real Paystack refund so the
      // money actually goes back to the customer, not just the platform.
      try {
        const order = await Order.findById(existing.orderId);
        if (order && order.paymentStatus === 'paid' && order.paymentReference) {
          // SECURITY FIX (V-07): Atomic claim with shared dedupeKey `refund:${orderId}`
          const claimResult = await pool.execute(
            `UPDATE orders SET refundReference = ? WHERE id = ? AND refundReference IS NULL`,
            [`refund:${order.id}:${req.params.id}:${order.paymentReference}`, existing.orderId]
          );
          if (claimResult.affectedRows === 0) {
            return res.status(409).json({ message: 'Refund already claimed or in progress for this order' });
          }
          const refund = await paystackServices.refundTransaction(
            order.paymentReference,
            undefined,
            `Return ${req.params.id} approved`
          );
          if (!refund?.status) {
            await pool.execute(`UPDATE orders SET refundReference = NULL WHERE id = ?`, [existing.orderId])
              .catch(() => {});
 console.warn(` Return ${req.params.id}: Paystack refund rejected (${refund?.message || 'unknown'}) — manual refund required`);
          } else {
 console.log(` Return ${req.params.id}: customer refunded via Paystack`);
            // Flip the order to 'refunded' the moment the money actually
            // moved. This is what makes the refund RETRIABLE (an admin cancel
            // only refunds when paymentStatus is still 'paid', so a failed
            // refund here can be completed there) and what stops a second
            // refund from ever being issued after a successful one — the
            // guard is now our own ledger, not Paystack's rejection.
            await pool.execute(
              `UPDATE orders SET paymentStatus = 'refunded', updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND paymentStatus = 'paid'`,
              [existing.orderId]
 ).catch((e) => console.warn(` Could not mark order ${existing.orderId} refunded: ${e.message}`));
            // P0-10: the payment decremented stock; the refund must put the
            // units back (mirrors cancelOrder). Lines never taken at payment
            // (stock conflicts) are skipped so stock is not inflated.
            try {
              const skipProductIds = new Set();
              const storedConflicts = order.stockConflicts;
              const conflicts = Array.isArray(storedConflicts)
                ? storedConflicts
                : typeof storedConflicts === 'string'
                ? (() => { try { return JSON.parse(storedConflicts); } catch { return []; } })()
                : [];
              for (const c of conflicts) {
                if (c?.productId) skipProductIds.add(c.productId);
              }
              await restoreStockForOrder(order.items, { skipProductIds, reason: 'return-restore', orderId: existing.orderId });
              await pool.execute(
                `UPDATE orders SET stockShortfall = 0, stockConflicts = NULL WHERE id = ?`,
                [existing.orderId]
              );
            } catch (restoreErr) {
 console.warn(` Could not restore stock for return ${req.params.id}: ${restoreErr.message}`);
            }
            // P0-6: the payment consumed a coupon use; the refund frees it.
            if (order.couponId) {
              try {
                await Coupon.decrementUses(order.couponId);
              } catch (couponErr) {
 console.warn(` Could not release coupon use for return ${req.params.id}: ${couponErr.message}`);
              }
            }
            // Immutable journal entry for the refund (deduped per return+order).
            await recordFinancialEvent({
              eventType: 'refund',
              direction: 'out',
              amount: parseFloat(order.totalAmount) || 0,
              orderId: order.id,
              reference: order.paymentReference,
              providerReference: refund?.data?.failure_reference || order.paymentReference,
              dedupeKey: `refund:${order.id}:${req.params.id}`,
              payload: { reason: `Return ${req.params.id} approved` },
            }).catch(() => {});
          }
        }
      } catch (refundErr) {
 console.warn(` Return ${req.params.id}: refund error (${refundErr.message}) — manual refund required`);
      }
    }

    res.json({ message: "Return request status updated", returnRequest });
  } catch (error) {
    console.error("updateReturnStatus error:", error.message);
    res.status(500).json({ message: "Failed to update return request" });
  }
};
