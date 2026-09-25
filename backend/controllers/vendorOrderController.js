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
import { sendOrderStatusEmail } from "../utils/orderEmailService.js";

import isValidId from "../utils/isValidId.js";

// True if the given order contains at least one item owned by the vendor user.
// Line items are stored on the order WITHOUT a vendorId, so ownership is derived
// from the product's vendorId (an explicitly stored item.vendorId wins as a
// fast path for any orders that do carry it).
const orderHasVendorItem = async (order, vendorUserId, productVendor = null) => {
  const items = Array.isArray(order.items) ? order.items : [];
  const vendorId = parseInt(vendorUserId, 10);

  const productIds = [...new Set(
    items.map((it) => it.product ?? it.productId ?? it.id).filter((x) => x != null)
  )];

  let vendorByProduct = productVendor;
  if (!vendorByProduct && productIds.length > 0) {
    const placeholders = productIds.map(() => '?').join(', ');
    const [prodRows] = await pool.execute(
      `SELECT id, vendorId FROM product WHERE id IN (${placeholders})`,
      productIds
    );
    vendorByProduct = new Map(prodRows.map((pr) => [String(pr.id), parseInt(pr.vendorId, 10)]));
  }

  return items.some((it) => {
    if (it.vendorId != null && parseInt(it.vendorId, 10) === vendorId) return true;
    const productId = String(it.product ?? it.productId ?? it.id);
    return vendorByProduct != null && vendorByProduct.get(productId) === vendorId;
  });
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
    const vendorUserId = parseInt(req.user.id, 10);

    // Prefilter in SQL: an order belongs to this vendor iff some item carries
    // their inline vendorId, or some item references one of their products.
    // The old query loaded EVERY order (with a users PII join) and filtered in
    // JS — an unbounded full-table scan any vendor could trigger. The JSON
    // LIKE prefilter narrows the rows + join; the JS filter below remains the
    // source of truth (LIKE can over-match, never under-match).
    let where = '';
    const params = [];
    const clauses = [];
    if (Number.isFinite(vendorUserId)) {
      clauses.push(`o.items LIKE ?`, `o.items LIKE ?`);
      params.push(`%"vendorId":${vendorUserId}%`, `%"vendorId":"${vendorUserId}"%`);
      try {
        const [owned] = await pool.execute(
          `SELECT id FROM product WHERE vendorId = ? LIMIT 300`,
          [vendorUserId]
        );
        if (owned.length > 0) {
          for (const p of owned) {
            clauses.push(`o.items LIKE ?`, `o.items LIKE ?`);
            params.push(`%"product":${p.id}%`, `%"productId":${p.id}%`);
          }
        }
      } catch {
        // product table unavailable — fall back to the inline vendorId match
      }
      // Too many products to inline safely: skip the prefilter entirely
      // (behaves exactly like the old full scan; JS filter still decides).
      if (clauses.length > 601) {
        where = '';
        params.length = 0;
      } else {
        where = `WHERE (${clauses.join(' OR ')})`;
      }
    }

    const [rows] = await pool.execute(
      `SELECT o.*, u.firstName, u.lastName, u.email
       FROM orders o
       LEFT JOIN users u ON o.userId = u.id
       ${where}
       ORDER BY o.created_at DESC`,
      params
    );
    const orders = rows.map((row) => new Order(row));

    // Resolve product -> vendor ownership for every candidate order in one
    // query so the list works even though line items don't persist a vendorId.
    const productIds = [...new Set(
      orders.flatMap((o) => (Array.isArray(o.items) ? o.items : []))
        .map((it) => it.product ?? it.productId ?? it.id)
        .filter((x) => x != null)
    )];
    const productVendor = new Map();
    if (productIds.length > 0) {
      const placeholders = productIds.map(() => '?').join(', ');
      const [prodRows] = await pool.execute(
        `SELECT id, vendorId FROM product WHERE id IN (${placeholders})`,
        productIds
      );
      for (const pr of prodRows) productVendor.set(String(pr.id), parseInt(pr.vendorId, 10));
    }

    const vendorOrders = orders.filter((o) => {
      const items = Array.isArray(o.items) ? o.items : [];
      return items.some((it) => {
        if (it.vendorId != null && parseInt(it.vendorId, 10) === vendorUserId) return true;
        const productId = String(it.product ?? it.productId ?? it.id);
        return productVendor.get(productId) === vendorUserId;
      });
    });
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
    if (req.user.role !== 'admin' && !(await orderHasVendorItem(order, req.user.id))) {
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
      ...(orderStatus === 'delivered' ? { deliveredAt: new Date() } : {}),
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
      if (customerEmail) {
      try {
        await sendOrderStatusEmail(order.id, {
          statusLabel: orderStatus,
          note: productionNote,
        });
      } catch (emailErr) {
        console.warn(`⚠️ Could not email customer order update: ${emailErr.message}`);
      }
    }
    } catch (notifyErr) {
      console.warn(`⚠️ Could not notify customer: ${notifyErr.message}`);
    }

    res.json({ message: "Order status updated", order: updated });
  } catch (error) {
    console.error("Error updating vendor order status:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
