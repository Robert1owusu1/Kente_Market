// @ts-check
// FILE LOCATION: controllers/orderController.js
// DESCRIPTION: Complete order controller with all CRUD operations and analytics

import Order from "../models/orderModel.js";
import pool from "../config/db.js";
import Coupon from "../models/couponModel.js";
import isValidId from "../utils/isValidId.js";
import paystackServices from "../Services/paystackservices.js";
import { computeExpectedCompletion } from "../utils/computeExpectedCompletion.js";
import { round2, calcSubtotal, calcTax, calcShipping, calcCouponDiscount, calcOrderTotals } from "../../shared/pricing.js";
import {
  createEscrowAllocations,
  releaseEscrowForOrder,
  setEscrowReleaseDeadline,
  getOrderAllocations,
  holdEscrowForOrder,
  cancelEscrowForOrder,
  retryFailedAllocations,
} from "../Services/escrowService.js";

// Client-supplied order-item images are stored and rendered to other users (e.g.
// in the vendor's order view), so they must not be able to carry javascript: or
// data: URLs (XSS via <img src>). Only http(s) URLs or relative /uploads paths
// are kept; anything else is rejected and the product's own image is used.
const safeOrderImage = (/** @type {string|null|undefined} */ image) => {
  if (!image || typeof image !== "string") return null;
  const trimmed = image.trim();
  if (trimmed.startsWith("/uploads/") || /^https?:\/\//i.test(trimmed)) {
    return trimmed.slice(0, 1000);
  }
  return null;
};

// Decrement in-stock inventory when an order becomes paid. Made-to-order items
// are woven on demand so their (zero) stock is not decremented. This helper is
// fire-and-forget: it must never block the payment confirmation flow, and any
// partial failure is logged for operator review (see audit — stock was never
// decremented on sale, allowing overselling).
/** @param {Array<{product?: any, productId?: any, qty?: any, quantity?: any}>} items */
export const decrementStockForOrder = async (items) => {
  if (!Array.isArray(items) || items.length === 0) return;
  const decrements = new Map();
  for (const item of items) {
    const productId = parseInt(item.product ?? item.productId, 10);
    const qty = parseInt(item.qty ?? item.quantity, 10);
    if (!productId || isNaN(qty) || qty <= 0) continue;
    decrements.set(productId, (decrements.get(productId) || 0) + qty);
  }
  if (decrements.size === 0) return;

  const connection = await pool.getConnection();
  try {
    for (const [productId, qty] of decrements) {
      await connection.execute(
        `UPDATE product
         SET stock = GREATEST(stock - ?, 0)
         WHERE id = ? AND madeToOrder = FALSE AND stock IS NOT NULL`,
        [qty, productId]
      );
    }
  } catch (err) {
    console.warn(`⚠️ Stock decrement failed: ${err.message}`);
  } finally {
    connection.release();
  }
};

/**
 * Express Request augmented with the authenticated user (attached by the
 * `authMiddleware`) and scalar route params/query (validated where needed).
 * @typedef {import("express").Request & {
 *   params: Record<string, any>,
 *   query: Record<string, any>,
 *   user: { id: number | string, name?: string, email?: string, role: string }
 * }} AppRequest
 */

// ============================================
// CRUD OPERATIONS (Your existing functions)
// ============================================

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
/** @param {AppRequest} req @param {import("express").Response} res */
export const addOrderItems = async (req, res) => {
  try {
    const rawItems = /** @type {Array<any>} */ (Array.isArray(req.body.items) ? req.body.items : []);
    if (rawItems.length === 0) {
      return res.status(400).json({ message: "Order must contain at least one item" });
    }

    // Normalize client items into {productId, quantity, ...}. We deliberately do
    // NOT trust any client-supplied price — prices are re-fetched from the DB.
    const requested = rawItems.map((item) => {
      const productId = parseInt(item.product || item.productId || item.id);
      const quantity = parseInt(item.quantity ?? item.qty);
      return {
        productId,
        quantity: quantity > 0 ? quantity : 1,
        image: item.image || null,
        selectedColor: item.selectedColor || item.color || null,
        selectedSize: item.selectedSize || item.size || null,
        name: typeof item.name === "string" ? item.name.slice(0, 200) : null,
      };
    });

    if (requested.some((r) => isNaN(r.productId) || r.productId <= 0)) {
      return res.status(400).json({ message: "Each item needs a valid productId" });
    }

    // Cap per-item quantity to a sane ceiling. Without this, an unbounded
    // quantity (e.g. 999,999,999) multiplied by price produces absurd totals /
    // single-order revenue — see audit finding.
    const MAX_QTY_PER_ITEM = 99;
    for (const r of requested) {
      if (r.quantity > MAX_QTY_PER_ITEM) {
        return res.status(400).json({ message: `Quantity for an item cannot exceed ${MAX_QTY_PER_ITEM}` });
      }
    }

    // ---- Server-side authoritative pricing ----
    const productIds = [...new Set(requested.map((r) => r.productId))];
    const placeholders = productIds.map(() => "?").join(", ");
    const [products] = await pool.execute(
      `SELECT id, title, price, img, vendorId, isCustomizable, productionTime, stock, madeToOrder, approvalStatus FROM product WHERE id IN (${placeholders})`,
      productIds
    );
    const productMap = new Map((/** @type {Array<any>} */ (products)).map((p) => [p.id, p]));
    if (productMap.size !== productIds.length) {
      return res.status(400).json({ message: "One or more products are no longer available" });
    }

    // Stock enforcement: reject quantities that exceed available inventory for
    // in-stock (non made-to-order) items. Made-to-order items are woven on
    // demand, so finite stock does not apply.
    for (const r of requested) {
      const p = productMap.get(r.productId);
      const madeToOrder = !!p.madeToOrder;
      const hasStock = p.stock !== null && p.stock !== undefined;
      if (!madeToOrder && hasStock && r.quantity > parseInt(p.stock, 10)) {
        return res.status(400).json({
          message: `Only ${p.stock} unit(s) of "${p.title}" are available. Please reduce the quantity.`,
        });
      }
    }

    const items = requested.map((r) => {
      const p = productMap.get(r.productId);
      return {
        product: r.productId,
        name: r.name || p.title,
        qty: r.quantity,
        price: round2(parseFloat(p.price) || 0),
        image: safeOrderImage(r.image) || p.img,
        selectedColor: r.selectedColor,
        selectedSize: r.selectedSize,
        vendorId: p.vendorId || null,
        // Customisation metadata: used to compute weaving progress ("days left")
        // for custom orders. The vendor sets productionTime (in days) on the product.
        isCustomizable: !!p.isCustomizable,
        productionTime: parseInt(p.productionTime) || 1,
      };
    });

    // Authoritative totals — single source of truth is shared/pricing.js (the
    // same functions drive the cart page, so price shown == price charged).
    const { subtotal, tax, shipping } = calcOrderTotals(items);

    // Coupon: discount is computed server-side and never trusted from the client.
    // The code is validated against the DB, and the resulting discount is
    // authoritative so a user cannot invent their own totals.
    let discount = 0;
    let appliedCouponId = null;
    const couponCode = (req.body.couponCode || "").trim();
    if (couponCode) {
      const couponResult = await Coupon.validate(couponCode, subtotal);
      if (!couponResult.valid) {
        return res.status(400).json({ message: couponResult.message });
      }
      const c = couponResult.coupon;
      discount = calcCouponDiscount(subtotal, c.discountType, c.discountValue);
      appliedCouponId = c.id;
    }

    const totalAmount = calcOrderTotals(items, { discount }).total;

    // IMPORTANT: paymentStatus is always forced to "pending". A client must NEVER
    // be able to self-assert a payment as paid. Orders are marked paid only by the
    // Paystack webhook or by an admin.
    const orderData = {
      userId: req.user.id,
      orderNumber: "ORD-" + Date.now(),
      items,
      totalAmount,
      shippingAddress: req.body.shippingAddress || {},
      billingAddress: req.body.billingAddress || {},
      paymentMethod: req.body.paymentMethod || "pending",
      paymentStatus: "pending",
      orderStatus: "pending",
      shippingCost: shipping,
      tax,
      discount,
      notes: req.body.notes || null,
      paymentReference: req.body.paymentReference || req.body.paymentResult?.id || null,
      couponId: appliedCouponId,
    };

    const newOrder = await Order.create(orderData);

    // Coupon usage is NOT consumed here. It is deferred until payment is
    // confirmed (Paystack charge.success webhook or admin mark-as-paid), so a
    // coupon is never wasted on an abandoned checkout.

    // Multi-vendor escrow: split the order into per-vendor allocations at placement.
    // Platform-owned items are excluded automatically (no vendorId on the product).
    await createEscrowAllocations(newOrder.id, items);

    res.status(201).json({ message: "Order created successfully", order: newOrder });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Get all orders with pagination
// @route   GET /api/orders
// @access  Private/Admin
/** @param {AppRequest} req @param {import("express").Response} res */
export const getOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status || null;
    // Map legacy "unpaid" filter to the stored value ("pending")
    const paymentStatus = req.query.paymentStatus === 'unpaid' ? 'pending' : (req.query.paymentStatus || null);
    const search = req.query.search || null;
    const sortBy = req.query.sortBy || 'created_at';
    const sortOrder = req.query.sortOrder || 'DESC';

    const result = await Order.findAll({
      page,
      limit,
      status,
      paymentStatus,
      search,
      sortBy,
      sortOrder,
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Get single order by ID
// @route   GET /api/orders/:id
// @access  Private
/** @param {AppRequest} req @param {import("express").Response} res */
export const getOrderById = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    const order = await Order.findById(req.params.id);
    
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Security: Only allow user to see their own orders, or admin
    if (req.user.role !== 'admin' && order.userId !== req.user.id) {
      return res.status(403).json({ message: "Not authorized to view this order" });
    }

    // Attach per-vendor escrow allocations for display
    const allocations = await getOrderAllocations(req.params.id);
    order.escrowAllocations = allocations;

    res.json(order);
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Get logged-in user's orders
// @route   GET /api/orders/myorders
// @access  Private
/** @param {AppRequest} req @param {import("express").Response} res */
export const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.findByUserId(req.user.id);
    res.json(orders);
  } catch (error) {
    console.error('Error fetching user orders:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Update order
// @route   PUT /api/orders/:id
// @access  Private
/** @param {AppRequest} req @param {import("express").Response} res */
export const updateOrder = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    // Check if order exists and user has permission
    const existingOrder = await Order.findById(req.params.id);
    if (!existingOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Only admin or order owner can update
    if (req.user.role !== 'admin' && existingOrder.userId !== req.user.id) {
      return res.status(403).json({ message: "Not authorized to update this order" });
    }

    // Security: Order owners may only update non-payment, non-fulfillment fields.
    // Payment status and order status are reserved for admins (and the webhook).
    // Monetary fields (items, shippingCost, tax, discount, totalAmount) are also
    // reserved so an owner can't tamper with what they pay; only admins may adjust.
    const body = { ...req.body };
    if (req.user.role !== 'admin') {
      delete body.paymentStatus;
      delete body.orderStatus;
      delete body.paymentMethod;
      delete body.items;
      delete body.shippingCost;
      delete body.tax;
      delete body.discount;
      delete body.totalAmount;
    }

    // Secure coupon application on the pre-created order path: recompute the
    // totals from the stored items + a server-validated coupon, never from the
    // client's numbers. Only reachable by the order owner (guarded above).
    const couponCode = (req.body.couponCode || "").trim();
    if (req.user.role !== 'admin' && couponCode) {
      const rawItems = Array.isArray(existingOrder.items) ? existingOrder.items : [];
      const subtotal = calcSubtotal(rawItems);
      const couponResult = await Coupon.validate(couponCode, subtotal);
      if (!couponResult.valid) {
        return res.status(400).json({ message: couponResult.message });
      }
      const c = couponResult.coupon;
      const discount = calcCouponDiscount(subtotal, c.discountType, c.discountValue);
      const shipping = Number(existingOrder.shippingCost ?? calcShipping(subtotal));
      const tax = Number(existingOrder.tax ?? calcTax(subtotal));
      body.discount = discount;
      body.totalAmount = round2(subtotal + shipping + tax - discount);
      body.couponId = c.id;
      // Coupon usage is deferred until payment is confirmed.
    }

    const updatedOrder = await Order.update(req.params.id, body);
    res.json({ message: "Order updated successfully", order: updatedOrder });
  } catch (error) {
    console.error('Error updating order:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Mark order as paid
// @route   PUT /api/orders/:id/pay
// @access  Private/Admin
/** @param {AppRequest} req @param {import("express").Response} res */
export const updateOrderToPaid = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    // Only admins (or the Paystack webhook) may mark an order as paid
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: "Not authorized to mark order as paid" });
    }

    await Order.update(req.params.id, {
      paymentStatus: "paid",
      orderStatus: "processing",
    });

    // For customised orders, seed the expected completion date (order start +
    // longest productionTime among customisable items) so the buyer sees how
    // many days are left to finish weaving. Only set if not already provided.
    const paidOrder = await Order.findById(req.params.id);
    if (!paidOrder || !paidOrder.expectedCompletionDate) {
      const completion = computeExpectedCompletion(paidOrder);
      if (completion) {
        await Order.update(req.params.id, {
          expectedCompletionDate: completion,
        });
      }
    }

    // Hold escrow allocations for the order so vendors can be paid out
    const heldCount = await holdEscrowForOrder(req.params.id);

    // Decrement in-stock inventory now that the sale is confirmed.
    const paidOrderForStock = await Order.findById(req.params.id);
    let paidItems = paidOrderForStock?.items;
    if (typeof paidItems === 'string') {
      try { paidItems = JSON.parse(paidItems); } catch { paidItems = []; }
    }
    if (Array.isArray(paidItems) && paidItems.length > 0) {
      await decrementStockForOrder(paidItems);
    }

    // Consume deferred coupon usage on admin-confirmed payment
    const freshOrder = await Order.findById(req.params.id);
    if (freshOrder?.couponId) {
      try {
        await Coupon.incrementUses(freshOrder.couponId);
      } catch (e) {
        console.warn(`⚠️ Could not increment coupon usage: ${e.message}`);
      }
    }

    const order = await Order.findById(req.params.id);
    res.json({
      message: "Order marked as paid",
      order,
      escrowHeld: heldCount,
    });
  } catch (error) {
    console.error('Error marking order as paid:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Mark order as delivered
// @route   PUT /api/orders/:id/deliver
// @access  Private/Admin
/** @param {AppRequest} req @param {import("express").Response} res */
export const updateOrderToDelivered = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    // Guard: only orders in 'processing' or 'shipped' state may be delivered
    const existingOrder = await Order.findById(req.params.id);
    if (!existingOrder) {
      return res.status(404).json({ message: "Order not found" });
    }
    const deliverableStates = ['processing', 'shipped'];
    if (!deliverableStates.includes(existingOrder.orderStatus)) {
      return res.status(400).json({
        message: `Cannot mark order as delivered from '${existingOrder.orderStatus}' status. Order must be ${deliverableStates.join(' or ')}.`,
      });
    }

    const updatedOrder = /** @type {import('../models/orderModel.js').default & { escrowReleaseDays?: number }} */ (
      // Row was just updated; non-null.
      await Order.update(req.params.id, {
        orderStatus: "delivered",
      })
    );

    // Escrow orders get an auto-release deadline: if the customer does not
    // confirm receipt within the window, funds are released automatically.
    // Handle the race where escrow is not yet held (webhook delayed):
    // attempt to hold escrow first, then set the deadline.
    if (updatedOrder.escrowStatus === 'held') {
      const days = await setEscrowReleaseDeadline(req.params.id);
      updatedOrder.escrowReleaseDeadline = await Order.findById(req.params.id)
        .then((o) => o?.escrowReleaseDeadline);
      updatedOrder.escrowReleaseDays = days;
    } else if (updatedOrder.escrowStatus === 'none') {
      // Webhook may not have fired yet — try to hold escrow now
      const heldCount = await holdEscrowForOrder(req.params.id);
      if (heldCount > 0) {
        const days = await setEscrowReleaseDeadline(req.params.id);
        updatedOrder.escrowReleaseDeadline = await Order.findById(req.params.id)
          .then((o) => o?.escrowReleaseDeadline);
        updatedOrder.escrowReleaseDays = days;
        updatedOrder.escrowStatus = 'held';
      }
    }

    res.json({ message: "Order marked as delivered", order: updatedOrder });
  } catch (error) {
    console.error('Error marking order as delivered:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Customer confirms delivery received → release escrow to vendors
// @route   POST /api/orders/:id/confirm-received
// @access  Private (order owner or admin)
/** @param {AppRequest} req @param {import("express").Response} res */
export const confirmOrderReceived = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (req.user.role !== 'admin' && order.userId !== req.user.id) {
      return res.status(403).json({ message: "Not authorized to confirm this order" });
    }

    if (order.escrowStatus !== 'held') {
      return res.status(400).json({
        message:
          order.escrowStatus === 'released'
            ? "Escrow for this order has already been released"
            : order.escrowStatus === 'none'
            ? "This order is not held in escrow"
            : `Cannot confirm receipt while escrow status is '${order.escrowStatus}'`,
      });
    }

    if (order.orderStatus !== 'delivered') {
      return res.status(400).json({
        message: "Order must be marked as delivered before receipt can be confirmed",
      });
    }

    const result = await releaseEscrowForOrder(req.params.id);
    const updatedOrder = await Order.findById(req.params.id);

    const failed = result.failed > 0;
    res.status(200).json({
      message: failed
        ? "Receipt confirmed. Some vendor payouts failed — admin retry may be needed."
        : "Receipt confirmed. Funds released to vendors.",
      escrowStatus: updatedOrder?.escrowStatus,
      result,
    });
  } catch (error) {
    console.error('Error confirming order received:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Cancel order and void escrow
// @route   PUT /api/orders/:id/cancel
// @access  Private/Admin
/** @param {AppRequest} req @param {import("express").Response} res */
export const cancelOrder = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const cancellableStatuses = ['pending', 'processing'];
    if (!cancellableStatuses.includes(order.orderStatus)) {
      return res.status(400).json({
        message: `Cannot cancel order in '${order.orderStatus}' status. Order must be pending or processing.`,
      });
    }

    // Money integrity: never mark a paid order 'refunded' without actually
    // refunding the customer via Paystack. If payment succeeded, push a real
    // refund through Paystack first and only flip paymentStatus after it is
    // accepted. If the refund fails, the order is left untouched so the money
    // cannot silently disappear from the platform's books.
    if (order.paymentStatus === 'paid') {
      try {
        const refund = await paystackServices.refundTransaction(
          order.paymentReference,
          undefined,
          `Order ${req.params.id} cancelled`
        );
        if (!refund?.status) {
          return res.status(400).json({
            message: `Refund failed (${refund?.message || 'unknown reason'}). Order was not cancelled. Please refund the customer manually.`,
          });
        }
      } catch (refundError) {
        return res.status(500).json({
          message: `Refund could not be initiated (${refundError.message}). Order was not cancelled.`,
        });
      }
    }

    await Order.update(req.params.id, {
      orderStatus: "cancelled",
      paymentStatus: order.paymentStatus === 'paid' ? 'refunded' : order.paymentStatus,
    });

    // Void any held escrow allocations so funds return to the platform
    if (order.escrowStatus === 'held' || order.escrowStatus === 'none') {
      await cancelEscrowForOrder(req.params.id);
    }

    const updatedOrder = await Order.findById(req.params.id);
    res.json({ message: "Order cancelled", order: updatedOrder });
  } catch (error) {
    console.error('Error cancelling order:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Retry failed escrow payouts for an order
// @route   POST /api/orders/:id/retry-escrow
// @access  Private/Admin
/** @param {AppRequest} req @param {import("express").Response} res */
export const retryEscrowPayouts = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (!['failed', 'releasing'].includes(order.escrowStatus)) {
      return res.status(400).json({
        message: `Order escrow status is '${order.escrowStatus}'. Only orders with failed or in-flight payouts can be retried.`,
      });
    }

    const result = await retryFailedAllocations(req.params.id);
    const updatedOrder = await Order.findById(req.params.id);

    res.status(200).json({
      message: `Retry complete: ${result.retried} payouts initiated, ${result.failed} failed.`,
      result,
      escrowStatus: updatedOrder?.escrowStatus,
    });
  } catch (error) {
    console.error('Error retrying escrow payouts:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Delete order
// @route   DELETE /api/orders/:id
// @access  Private/Admin
/** @param {AppRequest} req @param {import("express").Response} res */
export const deleteOrder = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    await Order.delete(req.params.id);
    res.json({ message: "Order deleted successfully" });
  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// ============================================
// ANALYTICS FUNCTIONS (Enhanced)
// ============================================

// @desc    Get order statistics
// @route   GET /api/orders/statistics
// @access  Private/Admin
/** @param {AppRequest} req @param {import("express").Response} res */
export const getOrderStatistics = async (req, res) => {
  try {
    const stats = await Order.getStatistics();
    
    // Calculate additional metrics
    const totalRevenue = parseFloat(stats.totalRevenue) || 0;
    const totalOrders = parseInt(stats.totalOrders) || 0;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    
    // Calculate conversion rate
    const deliveredOrders = parseInt(stats.deliveredOrders) || 0;
    const conversionRate = totalOrders > 0 ? (deliveredOrders / totalOrders) * 100 : 0;

    const response = {
      totalOrders,
      totalRevenue,
      avgOrderValue: parseFloat(avgOrderValue.toFixed(2)),
      conversionRate: parseFloat(conversionRate.toFixed(2)),
      pendingOrders: parseInt(stats.pendingOrders) || 0,
      processingOrders: parseInt(stats.processingOrders) || 0,
      deliveredOrders,
      cancelledOrders: parseInt(stats.cancelledOrders) || 0,
      paidOrders: parseInt(stats.paidOrders) || 0,
      unpaidOrders: parseInt(stats.unpaidOrders) || 0,
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Get sales analytics by date range
// @route   GET /api/orders/analytics
// @access  Private/Admin
/** @param {AppRequest} req @param {import("express").Response} res */
export const getSalesAnalytics = async (req, res) => {
  let connection;
  try {
    const { startDate, endDate, groupBy = 'month' } = req.query;
    
    connection = await pool.getConnection();
    
    let dateFormat;
    switch(groupBy) {
      case 'day':
        dateFormat = '%Y-%m-%d';
        break;
      case 'week':
        dateFormat = '%Y-%u';
        break;
      case 'month':
      default:
        dateFormat = '%Y-%m';
        break;
    }

    let query = `
      SELECT 
        DATE_FORMAT(created_at, ?) as period,
        COUNT(*) as orderCount,
        SUM(totalAmount) as revenue,
        AVG(totalAmount) as avgOrderValue
      FROM orders
      WHERE 1=1
    `;

    const params = [dateFormat];

    if (startDate) {
      query += ' AND created_at >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND created_at <= ?';
      params.push(endDate);
    }

    query += ' GROUP BY period ORDER BY period ASC';

    const [results] = await connection.execute(query, params);

    res.json(results);
  } catch (error) {
    console.error('Error fetching sales analytics:', error);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

// @desc    Get top selling products from orders
// @route   GET /api/orders/top-products
// @access  Private/Admin
/** @param {AppRequest} req @param {import("express").Response} res */
export const getTopProducts = async (req, res) => {
  let connection;
  try {
    const { limit = 10 } = req.query;
    
    connection = await pool.getConnection();
    
    const [orders] = await connection.execute(`
      SELECT id, items
      FROM orders
      WHERE orderStatus != 'cancelled'
      ORDER BY created_at DESC
      LIMIT 1000
    `);

    // Aggregate product sales
    const productSales = /** @type {Record<string, { productId: any, name: any, quantity: number, revenue: number }>} */ ({});

    (/** @type {Array<any>} */ (orders)).forEach(order => {
      try {
        const items = /** @type {Array<any>} */ (JSON.parse(order.items));
        items.forEach(item => {
          const key = item.productId || item.id || item.title;
          if (!productSales[key]) {
            productSales[key] = {
              productId: key,
              name: item.title || item.name || 'Unknown Product',
              quantity: 0,
              revenue: 0
            };
          }
          productSales[key].quantity += item.quantity || 1;
          productSales[key].revenue += (item.price || 0) * (item.quantity || 1);
        });
      } catch (e) {
        console.error('Error parsing order items:', e);
      }
    });

    // Sort by revenue and limit
    const topProducts = Object.values(productSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, parseInt(limit));

    res.json(topProducts);
  } catch (error) {
    console.error('Error fetching top products:', error);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};