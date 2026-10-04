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
import { round2 } from "../../shared/pricing.js";

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

/**
 * Per-vendor projection of an order (P0-2 tenant isolation).
 * Own lines only; operational fields kept; buyer PII minimized to first
 * name + fulfilment routing. Stock conflicts filtered to the caller's own
 * products (entries carry vendorId from flagStockShortfall).
 */
const projectVendorOrder = (order, vendorUserId, productVendor) => {
  const items = Array.isArray(order.items) ? order.items : [];
  const ownsLine = (it) => {
    if (it.vendorId != null && parseInt(it.vendorId, 10) === vendorUserId) return true;
    const productId = String(it.product ?? it.productId ?? it.id);
    return productVendor.get(productId) === vendorUserId;
  };
  const ownItems = items.filter(ownsLine).map((it) => ({
    product: it.product ?? it.productId ?? it.id ?? null,
    name: it.name || it.title || 'Product',
    qty: parseInt(it.qty ?? it.quantity, 10) || 1,
    price: Number(it.price) || 0,
    image: typeof it.image === 'string' ? it.image.slice(0, 500) : null,
    selectedColor: it.selectedColor || it.color || null,
    selectedSize: it.selectedSize || it.size || null,
    isCustomizable: !!it.isCustomizable,
    productionTime: parseInt(it.productionTime, 10) || null,
  }));
  const sa = order.shippingAddress && typeof order.shippingAddress === 'object' ? order.shippingAddress : {};
  const ownConflicts = (Array.isArray(order.stockConflicts) ? order.stockConflicts : [])
    .filter((c) => c && parseInt(c.vendorId, 10) === vendorUserId);
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    escrowStatus: order.escrowStatus,
    created_at: order.created_at,
    firstName: order.firstName || null,
    items: ownItems,
    itemCount: ownItems.length,
    ownSubtotal: round2(ownItems.reduce((sum, it) => sum + it.price * it.qty, 0)),
    shipping: {
      city: sa.city || null,
      deliveryMethod: sa.deliveryMethod || null,
      pickupStation: sa.pickupStation || null,
      phone: sa.phone || null,
    },
    productionNote: order.productionNote || null,
    expectedCompletionDate: order.expectedCompletionDate || null,
    deliveredAt: order.deliveredAt || null,
    stockShortfall: ownConflicts.reduce((sum, c) => sum + (parseInt(c.missing, 10) || 0), 0),
    stockConflicts: ownConflicts,
  };
};

const PIPELINE = ['processing', 'packaging', 'shipped', 'arrived', 'delivered'];

// All distinct vendor user-ids with lines on the order (P0-3 consensus set).
// Inline item.vendorId wins; legacy lines resolve via the product row.
export const getOrderVendorIds = async (order) => {
  const items = Array.isArray(order.items) ? order.items : [];
  const ids = new Set(
    items.map((it) => parseInt(it?.vendorId, 10)).filter((v) => Number.isFinite(v))
  );
  const pids = [...new Set(
    items
      .filter((it) => it?.vendorId == null)
      .map((it) => it?.product ?? it?.productId ?? it?.id)
      .filter((v) => v != null)
  )];
  if (pids.length > 0) {
    const placeholders = pids.map(() => '?').join(', ');
    const [rows] = await pool.execute(
      `SELECT id, vendorId FROM product WHERE id IN (${placeholders})`,
      pids
    );
    for (const r of rows) {
      if (r.vendorId != null && Number.isFinite(parseInt(r.vendorId, 10))) {
        ids.add(parseInt(r.vendorId, 10));
      }
    }
  }
  return [...ids];
};

const getVendorMark = async (orderId, vendorUserId) => {
  const [[row]] = await pool.execute(
    `SELECT status, note, expectedCompletionDate, trackingNumber FROM order_vendor_marks WHERE orderId = ? AND vendorId = ?`,
    [parseInt(orderId, 10), parseInt(vendorUserId, 10)]
  );
  return row || null;
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
    //
    // IMPORTANT: `orders.items` is a JSON column, and MySQL re-renders stored
    // documents with a space after the colon (`"vendorId": 240001`) no matter
    // how the row was stringified, while a TEXT/plain-JSON row stays compact
    // (`"vendorId":240001`). Matching only one spelling UNDER-matches and
    // silently empties this list (the vendor's Orders tab showed "No orders
    // found" while the dashboard counted the same orders), so push BOTH the
    // compact and spaced forms of every key — numeric and quoted-string.
    const jsonLikes = (key, value) => [
      `%"${key}":${value}%`,
      `%"${key}": ${value}%`,
      `%"${key}":"${value}"%`,
      `%"${key}": "${value}"%`,
    ];
    let where = '';
    const params = [];
    const clauses = [];
    const pushLikes = (key, value) => {
      for (const pattern of jsonLikes(key, value)) {
        clauses.push(`o.items LIKE ?`);
        params.push(pattern);
      }
    };
    if (Number.isFinite(vendorUserId)) {
      pushLikes('vendorId', vendorUserId);
      try {
        const [owned] = await pool.execute(
          `SELECT id FROM product WHERE vendorId = ? LIMIT 300`,
          [vendorUserId]
        );
        if (owned.length > 0) {
          for (const p of owned) {
            pushLikes('product', p.id);
            pushLikes('productId', p.id);
          }
        }
      } catch {
        // product table unavailable — fall back to the inline vendorId match
      }
      // Too many products to inline safely: skip the prefilter entirely
      // (behaves exactly like the old full scan; JS filter still decides).
      // Budget: 4 vendorId clauses + 300 products x 8 clauses = 2404.
      if (clauses.length > 2404) {
        where = '';
        params.length = 0;
      } else {
        where = `WHERE (${clauses.join(' OR ')})`;
      }
    }

    const [rows] = await pool.execute(
      `SELECT o.*, u.firstName
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
    // P0-2: never ship sibling-tenant data to a vendor. Each row carries only
    // the caller's own lines, their subtotal, and the minimal fulfilment
    // routing (city/delivery method/pickup/phone) — no other vendor's items
    // or prices, no order total, no payment reference, no billing address,
    // no buyer surname/email/full address.
    // P0-3: attach the caller's own mark + anonymized progress counts (no
    // sibling vendor ids leak through the marks).
    let marksByOrder = new Map();
    if (vendorOrders.length > 0) {
      try {
        const oids = vendorOrders.map((o) => o.id);
        const placeholders = oids.map(() => '?').join(', ');
        const [mrows] = await pool.execute(
          `SELECT orderId, vendorId, status, trackingNumber, updated_at FROM order_vendor_marks WHERE orderId IN (${placeholders})`,
          oids
        );
        for (const m of mrows) {
          const list = marksByOrder.get(m.orderId) || [];
          list.push(m);
          marksByOrder.set(m.orderId, list);
        }
      } catch { /* marks table missing or unreadable: rows ship without progress */ }
    }
    res.json(vendorOrders.map((o) => {
      const projected = projectVendorOrder(o, vendorUserId, productVendor);
      const marks = marksByOrder.get(o.id) || [];
      const mine = marks.find((m) => parseInt(m.vendorId, 10) === vendorUserId);
      const ahead = marks.filter((m) => PIPELINE.indexOf(m.status) > 0).length;
      const done = marks.filter((m) => m.status === 'delivered').length;
      return {
        ...projected,
        myStatus: mine ? mine.status : 'processing',
        myTracking: mine?.trackingNumber || null,
        vendorProgress: { advanced: ahead, delivered: done, total: marks.length },
      };
    }));
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
    // P1 tracking: parcel number for the vendor's own shipment. Trimmed to the
    // column width; key-absent means "leave unchanged" (COALESCE below).
    const trackingProvided = req.body.trackingNumber !== undefined;
    const trackingNumber = trackingProvided ? String(req.body.trackingNumber || '').trim().slice(0, 191) || null : null;

    if (!activeStatuses.includes(orderStatus)) {
      return res.status(400).json({
        message: `Invalid status. One of: ${activeStatuses.join(', ')}`,
      });
    }

    // P0-3 consensus: vendors progress INDEPENDENTLY. Forward-only is
    // enforced against the caller's OWN mark — never the global status — so a
    // vendor who is behind can still advance while a vendor who is ahead
    // cannot drag the shared order (or the escrow clock) forward alone.
    // Admins act for the whole order (legacy global write, same as the admin
    // deliver endpoint).
    const vendorUserId = parseInt(req.user.id, 10);
    const vendorIds = await getOrderVendorIds(order);
    const isAdmin = req.user.role === 'admin';
    let ownStatus = 'processing';
    if (!isAdmin) {
      try {
        const ownMark = await getVendorMark(req.params.id, vendorUserId);
        ownStatus = ownMark?.status || 'processing';
      } catch (markErr) {
        if (markErr.code === 'ER_NO_SUCH_TABLE') {
          return res.status(500).json({ message: 'Fulfilment tables not migrated — run db:migrate (migrateVendorMarks)' });
        }
        throw markErr;
      }
      const ownIdx = PIPELINE.indexOf(ownStatus);
      const nextIdx = PIPELINE.indexOf(orderStatus);
      if (nextIdx < ownIdx) {
        return res.status(400).json({
          message: `Cannot move backwards from '${ownStatus}' to '${orderStatus}'.`,
        });
      }
      // SECURITY FIX (V-11): Enforce state adjacency — vendors may only advance
      // one stage at a time (processing → packaging → shipped → arrived → delivered).
      // This prevents a vendor from jumping directly to 'delivered' and arming the
      // escrow release clock without shipment evidence. Admin override is allowed.
      if (!isAdmin && nextIdx > ownIdx + 1) {
        return res.status(400).json({
          message: `Invalid transition: must advance one stage at a time. Next allowed: '${PIPELINE[ownIdx + 1]}'`,
        });
      }
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

    // Advance only the caller's mark; the GLOBAL status follows the SLOWEST
    // vendor (missing mark = processing). A single vendor reaching 'delivered'
    // no longer flips the whole multi-vendor order.
    let consensus = order.orderStatus;
    if (isAdmin) {
      consensus = orderStatus;
      // Mirror to marks so a later vendor write recomputes from the admin's
      // position instead of dragging consensus back to 'processing'. Skip when
      // the order has no vendor lines (platform-only order: no marks to set).
      if (vendorIds.length > 0) {
        await pool.execute(
          `INSERT INTO order_vendor_marks (orderId, vendorId, status)
           VALUES ${vendorIds.map(() => '(?, ?)').join(', ')}
           ON DUPLICATE KEY UPDATE status = ?`,
          [...vendorIds.flatMap((v) => [parseInt(req.params.id, 10), v]), consensus]
        ).catch(() => { /* marks mirror is best-effort for admin writes */ });
      }
    } else {
      await pool.execute(
        `INSERT INTO order_vendor_marks (orderId, vendorId, status, note, expectedCompletionDate, trackingNumber)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = ?, note = COALESCE(?, note),
           expectedCompletionDate = COALESCE(?, expectedCompletionDate),
           trackingNumber = COALESCE(?, trackingNumber)`,
        [parseInt(req.params.id, 10), vendorUserId, orderStatus, productionNote || null, finalCompletion, trackingNumber,
         orderStatus, productionNote || null, finalCompletion, trackingNumber]
      );
      const [markRows] = await pool.execute(
        `SELECT vendorId, status FROM order_vendor_marks WHERE orderId = ?`,
        [parseInt(req.params.id, 10)]
      );
      const byVendor = new Map(markRows.map((m) => [parseInt(m.vendorId, 10), m.status]));
      let consensusIdx = PIPELINE.length - 1;
      let known = false;
      for (const vid of vendorIds) {
        known = true;
        consensusIdx = Math.min(consensusIdx, PIPELINE.indexOf(byVendor.get(vid) || 'processing'));
      }
      if (known) consensus = PIPELINE[consensusIdx];
    }

    const advanced = consensus !== order.orderStatus;
    let updated = order;
    const patch = {};
    if (advanced) {
      patch.orderStatus = consensus;
      if (consensus === 'delivered') patch.deliveredAt = new Date();
    }
    // SECURITY FIX (N-4): Do NOT write productionNote/expectedCompletionDate to
    // the shared order row. Vendor A's note would overwrite Vendor B's, changing
    // what the customer sees ("Action A changes Resource B"). Per-vendor notes
    // and dates already live in order_vendor_marks and vendor_order_fulfillment.
    // The customer-facing note can be derived from the marks at render time.
    if (Object.keys(patch).length > 0) {
      updated = await Order.update(req.params.id, patch);
    }

    // Arm the escrow release window only when the CONSENSUS reaches delivered
    // (same behaviour as updateOrderToDelivered, now all-vendors-delivered).
    if (consensus === 'delivered' && advanced) {
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
 console.warn(` Could not arm escrow release deadline: ${escrowErr.message}`);
      }
    }

    // Notify the customer only when the visible order status actually moved.
    // (A vendor advancing their own mark ahead of the consensus must not
    // send the customer a status the order has not reached.)
    if (!advanced) {
      return res.json({ message: 'Progress saved', order: updated, myStatus: isAdmin ? consensus : orderStatus, consensus });
    }
    try {
      const customerEmail = await getCustomerEmail(order.userId);
      const statusLabel = consensus.charAt(0).toUpperCase() + consensus.slice(1);
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
          statusLabel: consensus,
          note: productionNote,
        });
      } catch (emailErr) {
 console.warn(` Could not email customer order update: ${emailErr.message}`);
      }
    }
    } catch (notifyErr) {
 console.warn(` Could not notify customer: ${notifyErr.message}`);
    }

    res.json({ message: "Order status updated", order: updated, myStatus: isAdmin ? consensus : orderStatus, consensus });
  } catch (error) {
    console.error("Error updating vendor order status:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
