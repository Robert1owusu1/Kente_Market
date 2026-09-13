// FILE LOCATION: backend/controllers/customRequestController.js
// DESCRIPTION: Customization request workflow:
//   customer submit -> vendor quote/decline -> customer accept/pay or cancel
//   -> admin oversight + stats (conversation-complete flag for callbacks).
import pool from "../config/db.js";
import CustomRequest from "../models/customRequestModel.js";
import Order from "../models/orderModel.js";
import { createEscrowAllocations } from "../Services/escrowService.js";

// Converts colours/threadTypes from either JSON arrays or CSV strings sent by forms.
const toArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [value];
    } catch {
      return value.split(",").map((v) => v.trim()).filter(Boolean);
    }
  }
  return [String(value)];
};

// ✅ Get the logged-in user's vendor row id (null if not a vendor).
const getVendorUserId = async (userId) => {
  const [[row]] = await pool.execute(
    "SELECT userId FROM vendors WHERE userId = ?",
    [parseInt(userId)]
  );
  return row ? row.userId : null;
};

// ============================================
// CUSTOMER SLICE
// ============================================

// ✅ POST /api/custom-requests — create (customer)
export const createRequest = async (req, res) => {
  try {
    const {
      vendorId, baseProductId, productId, description, yards, colours, dominantColour,
      threadTypes, dominantThread, referenceImage, neededForDate, neededForTime,
    } = req.body || {};

    if (!vendorId || isNaN(vendorId)) {
      return res.status(400).json({ message: "A valid vendor is required" });
    }
    // Vendor must exist and be approved.
    const [[vendor]] = await pool.execute(
      "SELECT id, status FROM vendors WHERE userId = ?",
      [parseInt(vendorId)]
    );
    if (!vendor) {
      return res.status(400).json({ message: "Vendor not found" });
    }
    if (vendor.status !== 'approved') {
      return res.status(400).json({ message: "This vendor is not approved to take custom orders yet" });
    }

    const yardNum = parseFloat(yards);
    if (isNaN(yardNum) || yardNum <= 0) {
      return res.status(400).json({ message: "Please state how many yards you need" });
    }
    if (!neededForDate) {
      return res.status(400).json({ message: "Please state the date you need it by" });
    }
    if (!neededForTime) {
      return res.status(400).json({ message: "Please state the time you need it by" });
    }

    const refProductId = baseProductId || productId;
    let resolvedBaseProductId = null;
    if (refProductId && !isNaN(refProductId)) {
      const [[product]] = await pool.execute(
        "SELECT id, title, vendorId FROM product WHERE id = ?",
        [parseInt(refProductId)]
      );
      resolvedBaseProductId = product ? product.id : null;
    }

    const request = await CustomRequest.create({
      customerId: req.user.id,
      vendorId: parseInt(vendorId),
      baseProductId: resolvedBaseProductId,
      description: description ? String(description).trim().slice(0, 4000) : null,
      yards: yardNum,
      colours: toArray(colours),
      dominantColour: dominantColour ? String(dominantColour).trim() : null,
      threadTypes: toArray(threadTypes),
      dominantThread: dominantThread ? String(dominantThread).trim() : null,
      referenceImage: referenceImage || null,
      neededForDate,
      neededForTime,
    });

    res.status(201).json({
      message: "Customization request sent to the vendor. You'll see it in your portal.",
      request,
    });
  } catch (error) {
    console.error("❌ createRequest error:", error.message);
    res.status(500).json({ message: "Failed to create customization request" });
  }
};

// ✅ GET /api/custom-requests/my — customer's own requests
export const getMyRequests = async (req, res) => {
  try {
    const requests = await CustomRequest.findByCustomer(req.user.id, { limit: req.query.limit });
    res.json(requests);
  } catch (error) {
    console.error("❌ getMyRequests error:", error.message);
    res.status(500).json({ message: "Failed to fetch your customization requests" });
  }
};

// ✅ POST /api/custom-requests/:id/accept — customer accepts the vendor quote
export const acceptRequest = async (req, res) => {
  try {
    const request = await CustomRequest.findById(parseInt(req.params.id));
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.customerId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Not authorized" });
    }
    if (request.status !== 'quoted') {
      return res.status(400).json({ message: `Cannot accept a request in '${request.status}' status` });
    }
    const updated = await CustomRequest.update(request.id, { status: 'accepted' });
    res.json({ message: "Quote accepted — proceed to payment.", request: updated });
  } catch (error) {
    console.error("❌ acceptRequest error:", error.message);
    res.status(500).json({ message: "Failed to accept request" });
  }
};

// ✅ POST /api/custom-requests/:id/cancel — customer cancels with a reason
export const cancelRequest = async (req, res) => {
  try {
    const { customerCancelReason } = req.body || {};
    const request = await CustomRequest.findById(parseInt(req.params.id));
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.customerId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Not authorized" });
    }
    if (!['pending', 'quoted', 'accepted'].includes(request.status)) {
      return res.status(400).json({ message: `Cannot cancel a request in '${request.status}' status` });
    }
    const updated = await CustomRequest.update(request.id, {
      status: 'cancelled',
      customerCancelReason: customerCancelReason ? String(customerCancelReason).trim() : null,
    });
    res.json({ message: "Request cancelled. Your reason helps us improve.", request: updated });
  } catch (error) {
    console.error("❌ cancelRequest error:", error.message);
    res.status(500).json({ message: "Failed to cancel request" });
  }
};

// ✅ POST /api/custom-requests/:id/checkout — customer pays (Paystack) and the
//    custom order is created + escrow held.
export const checkoutRequest = async (req, res) => {
  try {
    const { paymentReference, paymentMethod, shippingAddress, notes } = req.body || {};
    const request = await CustomRequest.findById(parseInt(req.params.id));
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.customerId !== req.user.id) {
      return res.status(403).json({ message: "Not authorized" });
    }
    if (request.status !== 'accepted') {
      return res.status(400).json({ message: `Request must be accepted before payment (currently '${request.status}')` });
    }
    if (!paymentReference) {
      return res.status(400).json({ message: "Payment reference is missing" });
    }

    const price = parseFloat(request.vendorQuotePrice);
    if (!price || price <= 0) {
      return res.status(400).json({ message: "Vendor quote price is invalid" });
    }

    const items = [
      {
        product: request.baseProductId || null,
        name: `Custom Kente (${request.yards} yd)`,
        title: request.baseProductTitle || "Custom Kente",
        qty: 1,
        quantity: 1,
        price,
        image: request.referenceImage || null,
        customRequestId: request.id,
        selectedColor: request.dominantColour || null,
        selectedSize: String(request.yards),
        yards: String(request.yards),
        dominantThread: request.dominantThread || null,
        threadTypes: request.threadTypes || [],
      },
    ];

    const order = await Order.create({
      userId: req.user.id,
      orderNumber: `CUS-${Date.now()}`,
      items,
      totalAmount: price,
      shippingAddress: shippingAddress || {},
      billingAddress: shippingAddress || {},
      paymentMethod: paymentMethod || "Card Payment",
      paymentStatus: "paid",
      orderStatus: "processing",
      shippingCost: 0,
      tax: 0,
      discount: 0,
      notes: notes || `Custom kente request #${request.id} — vendor: ${request.vendorBusinessName}. Needed by: ${request.neededForDate} ${request.neededForTime}`,
      paymentReference,
    });

    // Hold escrow immediately (custom orders are pre-paid).
    await createEscrowAllocations(order.id, items);

    const updated = await CustomRequest.update(request.id, {
      status: 'paid',
      orderId: order.id,
    });

    res.status(201).json({
      message: "Payment received. Your custom order is now with the vendor.",
      order,
      request: updated,
    });
  } catch (error) {
    console.error("❌ checkoutRequest error:", error.message);
    res.status(500).json({ message: "Failed to complete custom order payment" });
  }
};

// ============================================
// VENDOR SLICE
// ============================================

// ✅ GET /api/custom-requests/vendor — requests received by the vendor
export const listVendorRequests = async (req, res) => {
  try {
    const vendorId = await getVendorUserId(req.user.id);
    if (!vendorId) {
      return res.status(400).json({ message: "No vendor account linked to this user" });
    }
    const requests = await CustomRequest.findByVendor(vendorId, { status: req.query.status });
    res.json(requests);
  } catch (error) {
    console.error("❌ listVendorRequests error:", error.message);
    res.status(500).json({ message: "Failed to fetch custom requests" });
  }
};

// ✅ POST /api/custom-requests/:id/quote — vendor quotes & commits to timeline
export const quoteRequest = async (req, res) => {
  try {
    const { vendorQuotePrice, price, vendorCanMeet, canMeet, vendorMessage } = req.body || {};
    const request = await CustomRequest.findById(parseInt(req.params.id));
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.vendorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Not authorized" });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ message: `Only pending requests can be quoted (currently '${request.status}')` });
    }
    const quoteTotal = vendorQuotePrice !== undefined ? parseFloat(vendorQuotePrice) : parseFloat(price);
    if (isNaN(quoteTotal) || quoteTotal <= 0) {
      return res.status(400).json({ message: "Please provide a valid quote price" });
    }

    const canMeetFlag = vendorCanMeet !== undefined ? vendorCanMeet : canMeet;
    const updated = await CustomRequest.update(request.id, {
      status: 'quoted',
      vendorQuotePrice: quoteTotal,
      vendorCanMeet: canMeetFlag ? 1 : 0,
      vendorMessage: vendorMessage ? String(vendorMessage).trim().slice(0, 2000) : null,
    });
    res.json({
      message: canMeetFlag
        ? "Quote sent to the customer."
        : "Quote sent — the customer will see you can't meet their requested time.",
      request: updated,
    });
  } catch (error) {
    console.error("❌ quoteRequest error:", error.message);
    res.status(500).json({ message: "Failed to submit quote" });
  }
};

// ✅ POST /api/custom-requests/:id/decline — vendor cannot take the order
export const declineRequest = async (req, res) => {
  try {
    const { vendorMessage } = req.body || {};
    const request = await CustomRequest.findById(parseInt(req.params.id));
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.vendorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Not authorized" });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ message: `Only pending requests can be declined (currently '${request.status}')` });
    }
    const updated = await CustomRequest.update(request.id, {
      status: 'declined',
      vendorMessage: vendorMessage ? String(vendorMessage).trim().slice(0, 2000) : null,
    });
    res.json({ message: "Request declined. The customer has been notified.", request: updated });
  } catch (error) {
    console.error("❌ declineRequest error:", error.message);
    res.status(500).json({ message: "Failed to decline request" });
  }
};

// ✅ POST /api/custom-requests/:id/in-progress — vendor starts weaving (paid)
export const startRequest = async (req, res) => {
  try {
    const request = await CustomRequest.findById(parseInt(req.params.id));
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.vendorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Not authorized" });
    }
    if (request.status !== 'paid') {
      return res.status(400).json({ message: `Request must be paid before weaving starts (currently '${request.status}')` });
    }
    const updated = await CustomRequest.update(request.id, { status: 'in_progress' });
    res.json({ message: "Marked as in progress.", request: updated });
  } catch (error) {
    console.error("❌ startRequest error:", error.message);
    res.status(500).json({ message: "Failed to update request" });
  }
};

// ============================================
// ADMIN SLICE
// ============================================

// ✅ GET /api/custom-requests/admin — all requests
export const listAllRequests = async (req, res) => {
  try {
    const requests = await CustomRequest.findAllAdmin({ status: req.query.status });
    res.json(requests);
  } catch (error) {
    console.error("❌ listAllRequests error:", error.message);
    res.status(500).json({ message: "Failed to fetch custom requests" });
  }
};

// ✅ GET /api/custom-requests/admin/stats — stats for analysis/prediction
export const getAdminStats = async (req, res) => {
  try {
    const stats = await CustomRequest.adminStats();
    res.json(stats);
  } catch (error) {
    console.error("❌ getAdminStats error:", error.message);
    res.status(500).json({ message: "Failed to fetch custom request stats" });
  }
};

// ✅ POST /api/custom-requests/:id/reviewed — mark conversation as complete
//    so customer support can call the customer.
export const markReviewed = async (req, res) => {
  try {
    const request = await CustomRequest.findById(parseInt(req.params.id));
    if (!request) return res.status(404).json({ message: "Request not found" });
    const updated = await CustomRequest.update(request.id, { adminReviewed: 1 });
    res.json({ message: "Marked as reviewed.", request: updated });
  } catch (error) {
    console.error("❌ markReviewed error:", error.message);
    res.status(500).json({ message: "Failed to update request" });
  }
};