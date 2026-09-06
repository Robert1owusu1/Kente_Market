// FILE LOCATION: controllers/vendorOrderController.js
// DESCRIPTION: Vendor (seller) fulfilment tracking. Lets a vendor:
//   - list the orders that contain their products,
//   - advance the order status along the fulfilment pipeline
//     (processing → packaging → shipped "on its way" → arrived → delivered),
//   - for customised (custom-woven) orders, set an expected completion date and
//     post progress notes; the buyer sees "X days left" counted down from it.
// The customer's final "I received my order" step is handled by the existing
// confirmOrderReceived flow (escrow release).

import Order from "../models/orderModel.js";
import pool from "../config/db.js";
import Notification from "../models/notificationModel.js";
import {
  holdEscrowForOrder,
  setEscrowReleaseDeadline,
} from "../Services/escrowService.js";

import isValidId from "../utils/isValidId.js";

// True if the given order contains at least one item owned by the vendor user.
const orderHasVendorItem = (order, vendorUserId) => {
  const items = Array.isArray(order.items) ? order.items : [];
  return items.some((it) => parseInt(it.vendorId) === parseInt(vendorUserId));
};

const getCustomerEmail = async (userId) => {
  const [[row]] = await pool.execute(
    `SELECT email FROM users WHERE id = ?`,
    [parseInt(userId)]
  );
  return row ? row.email : null;
};

// @desc    List the current vendor's orders (orders that contain their products)
// @route   GET /api/vendors/orders
// @access  Private/Vendor
export const getVendorOrders = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT o.*, u.firstName, u.lastName, u.email
       FROM orders o
       LEFT JOIN users u ON o.userId = u.id
       ORDER BY o.created_at DESC`
    );
    const vendorOrders = rows
      .map((row) => new Order(row))
      .filter((o) => orderHasVendorItem(o, req.user.id));
    res.json(vendorOrders);
  } catch (error) {
    console.error("Error fetching vendor orders:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Vendor updates fulfilment status of their order
// @route   POST /api/vendors/orders/:id/status
// @access  Private/Vendor
// Allowed transitions (non-customised): processing → packaging → shipped → arrived → delivered
// Customised orders may be advanced the same way; the vendor can also set an
// expectedCompletionDate and a productionNote (progress) at any time.
export const updateVendorOrderStatus = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Only the vendor who owns an item in the order (or an admin) may act.
    if (req.user.role !== 'admin' && !orderHasVendorItem(order, req.user.id)) {
      return res.status(403).json({ message: "Not authorized to update this order" });
    }

    // Only active (processing+) orders are on the fulfilment pipeline.
    const activeStatuses = [
      'processing', 'packaging', 'shipped', 'arrived', 'delivered',
    ];
    if (!activeStatuses.includes(order.orderStatus)) {
      return res.status(400).json({
        message: `This order is not on the fulfilment pipeline (current: ${order.orderStatus}).`,
      });
    }

    const orderStatus = (req.body.orderStatus || "").trim();
    const productionNote = (req.body.productionNote || "").trim();
    const expectedCompletionDate = req.body.expectedCompletionDate || null;

    if (!activeStatuses.includes(orderStatus)) {
      return res.status(400).json({
        message: `Invalid status. One of: ${activeStatuses.join(', ')}`,
      });
    }

    // Enforce forward progression along the pipeline.
    const pipeline = ['processing', 'packaging', 'shipped', 'arrived', 'delivered'];
    const currentIdx = pipeline.indexOf(order.orderStatus);
    const nextIdx = pipeline.indexOf(orderStatus);
    if (nextIdx < currentIdx) {
      return res.status(400).json({
        message: `Cannot move backwards from '${order.orderStatus}' to '${orderStatus}'.`,
      });
    }

    // Only meaningful for customised orders, but allow on any to keep flow simple.
    let finalCompletion = null;
    if (expectedCompletionDate) {
      const d = new Date(expectedCompletionDate);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ message: "Invalid expected completion date" });
      }
      finalCompletion = d;
    }

    const updated = await Order.update(req.params.id, {
      orderStatus,
      ...(productionNote ? { productionNote } : {}),
      ...(finalCompletion ? { expectedCompletionDate: finalCompletion } : {}),
    });

    // When marked delivered, start the escrow release window (same behaviour
    // as the admin's updateOrderToDelivered). This arms the "auto-release if
    // the customer doesn't confirm receipt" deadline.
    if (orderStatus === 'delivered') {
      try {
        if (updated.escrowStatus === 'held') {
          await setEscrowReleaseDeadline(req.params.id);
        } else if (updated.escrowStatus === 'none') {
          const heldCount = await holdEscrowForOrder(req.params.id);
          if (heldCount > 0) {
            await setEscrowReleaseDeadline(req.params.id);
          }
        }
      } catch (escrowErr) {
        console.warn(`⚠️ Could not arm escrow release deadline: ${escrowErr.message}`);
      }
    }

    // Notify the customer of the vendor's progress update.
    try {
      const customerEmail = await getCustomerEmail(order.userId);
      const statusLabel = orderStatus.charAt(0).toUpperCase() + orderStatus.slice(1);
      let message = `Your order ${order.orderNumber} is now ${statusLabel}.`;
      if (productionNote) message += ` Note from seller: "${productionNote}"`;
      await Notification.create({
        userId: order.userId,
        type: "order",
        title: `Order ${order.orderNumber} — ${statusLabel}`,
        message,
        link: `/order/${order.id}`,
      });
      if (customerEmail) console.log(`📧 Order update email to ${customerEmail} (mock)`);
    } catch (notifyErr) {
      console.warn(`⚠️ Could not notify customer: ${notifyErr.message}`);
    }

    res.json({ message: "Order status updated", order: updated });
  } catch (error) {
    console.error("Error updating vendor order status:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
