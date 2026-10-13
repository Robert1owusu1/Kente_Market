// FILE LOCATION: backend/controllers/customRequestController.js
// DESCRIPTION: Customization request workflow:
//   customer submit -> vendor quote/decline -> customer accept/pay or cancel
//   -> admin oversight + stats (conversation-complete flag for callbacks).
import pool from "../config/db.js";
import CustomRequest from "../models/customRequestModel.js";
import Order from "../models/orderModel.js";
import Notification from "../models/notificationModel.js";
import { buildEscrowAllocationRows, allocationFees } from "../Services/commissionService.js";
import { recordFinancialEvent } from "../Services/ledgerService.js";
import { CUSTOM_ADVANCE_RATIO } from "../config/businessConfig.js";
import { issueCertificateForOrder } from "../Services/certificateService.js";
import PaystackService from "../Services/paystackservices.js";
import { CHARGED_CURRENCY } from "../Services/paymentCurrency.js";
import { newOrderNumber } from "../utils/orderNumber.js";
import { round2 } from "../../shared/pricing.js";

// Combine needed-for date + time into a contractually visible completion date.
const completionFromRequest = (request) => {
  if (!request.neededForDate) return null;
  try {
    // The driver hands back DATE columns as JS Date objects — normalise first.
    const day = request.neededForDate instanceof Date
      ? request.neededForDate.toISOString().slice(0, 10)
      : String(request.neededForDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const d = new Date(`${day}T${request.neededForTime || '23:59'}:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
};

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

// Get the logged-in user's vendor row id (null if not a vendor).
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

// POST /api/custom-requests — create (customer)
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
    // A vendor must not be able to place a custom request against their own
    // store: they could quote/accept it themselves and immediately withdraw the
    // 50% advance. Self-dealing is never a legitimate customer flow.
    if (parseInt(vendorId, 10) === req.user.id) {
      return res.status(400).json({ message: "You cannot send a custom request to your own store" });
    }

    const yardNum = parseFloat(yards);
    if (isNaN(yardNum) || yardNum <= 0) {
      return res.status(400).json({ message: "Please state how many yards you need" });
    }
    // Kente is woven in even yards only (2, 4, 6, 8, 10, 12, …).
    if (!Number.isInteger(yardNum) || yardNum % 2 !== 0) {
      return res.status(400).json({ message: "Kente is woven in even yards — choose 2, 4, 6, 8, 10, 12 …" });
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
        "SELECT id, title, vendorId, isCustomizable FROM product WHERE id = ?",
        [parseInt(refProductId)]
      );
      if (!product) {
        return res.status(400).json({ message: "Base product not found" });
      }
      // Customisation is opt-in per cloth: the vendor must flag the product.
      if (!product.isCustomizable) {
        return res.status(400).json({ message: "This piece isn't open for customisation" });
      }
      // The request must go to the product's own vendor, never one the client claims.
      if (parseInt(vendorId, 10) !== product.vendorId) {
        return res.status(400).json({ message: "This product belongs to a different vendor" });
      }
      resolvedBaseProductId = product.id;
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

    // Tell the vendor a request just landed so the 48h SLA clock is loud.
    try {
      await Notification.create({
        userId: parseInt(vendorId),
        type: "custom",
        title: `New custom request #${request.id}`,
        message: `A customer needs ${request.yards} yd of custom Kente${request.baseProductTitle ? ` inspired by "${request.baseProductTitle}"` : ""}. ${request.neededForDate || ""} ${request.neededForTime || ""}.`,
        link: "/vendor/custom-requests",
      });
    } catch {
      /* non-fatal */
    }

    res.status(201).json({
      message: "Customization request sent to the vendor. You'll see it in your portal.",
      request,
    });
  } catch (error) {
 console.error(" createRequest error:", error.message);
    res.status(500).json({ message: "Failed to create customization request" });
  }
};

// GET /api/custom-requests/my — customer's own requests
export const getMyRequests = async (req, res) => {
  try {
    const requests = await CustomRequest.findByCustomer(req.user.id, { limit: req.query.limit });
    res.json(requests);
  } catch (error) {
 console.error(" getMyRequests error:", error.message);
    res.status(500).json({ message: "Failed to fetch your customization requests" });
  }
};

// POST /api/custom-requests/:id/accept — customer accepts the vendor quote
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
    try {
      await Notification.create({
        userId: request.vendorId,
        type: "custom",
        title: `Quote accepted — request #${request.id}`,
        message: "Your quote was accepted and the customer paid. Start weaving once funds are held.",
        link: "/vendor/custom-requests",
      });
    } catch {
      /* non-fatal */
    }
    res.json({ message: "Quote accepted — proceed to payment.", request: updated });
  } catch (error) {
 console.error(" acceptRequest error:", error.message);
    res.status(500).json({ message: "Failed to accept request" });
  }
};

// POST /api/custom-requests/:id/cancel — customer cancels with a reason
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
    try {
      await Notification.create({
        userId: request.vendorId,
        type: "custom",
        title: `Request #${request.id} cancelled by customer`,
        message: customerCancelReason ? `Reason: ${customerCancelReason.trim().slice(0, 300)}` : "The customer cancelled this request.",
        link: "/vendor/custom-requests",
      });
    } catch {
      /* non-fatal */
    }
    res.json({ message: "Request cancelled. Your reason helps us improve.", request: updated });
  } catch (error) {
 console.error(" cancelRequest error:", error.message);
    res.status(500).json({ message: "Failed to cancel request" });
  }
};

// POST /api/custom-requests/:id/checkout — customer pays (Paystack) and the
//    custom order is created + escrow held.
// FIX: Entire checkout flow is now protected by a single database transaction
// with an atomic claim on the custom request (UPDATE ... WHERE status='accepted').
// This prevents:
// - Orphan paid orders disconnected from their custom request
// - Duplicate orders from concurrent checkouts or retries
// - Inconsistent intermediate states if any step fails
export const checkoutRequest = async (req, res) => {
  // Phase 1: Validate input and verify Paystack payment (OUTSIDE transaction).
  // We cannot roll back an external Paystack charge, so verification happens first.
  // If the DB transaction later fails, the verified payment is logged for reconciliation.
  let request;
  let price;
  let paymentReference;
  let items;
  let completionDate;
  let notes;
  // Read from the request in Phase 1 but written by the Phase 2 transaction,
  // so they must live at function scope (a block-scoped destructure here made
  // Phase 2 throw ReferenceError after Paystack had already been verified).
  let paymentMethod;
  let shippingAddress;

  try {
    const { paymentReference: ref, notes: userNotes } = req.body || {};
    ({ paymentMethod, shippingAddress } = req.body || {});
    paymentReference = ref;
    request = await CustomRequest.findById(parseInt(req.params.id));
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

    price = parseFloat(request.vendorQuotePrice);
    if (!price || price <= 0) {
      return res.status(400).json({ message: "Vendor quote price is invalid" });
    }

    // SECURITY: Verify Paystack server-side that the charge succeeded, settled
    // the full quote amount in GHS, and that the reference hasn't been consumed.
    const verification = await PaystackService.verifyTransaction(paymentReference);
    const tx = verification?.data;
    if (!tx || tx.status !== 'success') {
      return res.status(400).json({ message: "Payment has not been completed. Please try again." });
    }
    const expectedKobo = Math.round(price * 100);
    const paidKobo = parseInt(tx.amount, 10);
    if (tx.currency !== CHARGED_CURRENCY || !Number.isFinite(paidKobo) || paidKobo !== expectedKobo) {
      return res.status(400).json({ message: "Payment amount does not match the quoted price." });
    }

    // Check paymentReference uniqueness (race with other checkouts handled by
    // DB unique key uq_orders_paymentReference inside the transaction).
    const [[existingRef]] = await pool.execute(
      "SELECT id FROM orders WHERE paymentReference = ? LIMIT 1",
      [paymentReference]
    );
    if (existingRef) {
      return res.status(400).json({ message: "This payment reference has already been used." });
    }

    // Suspended-vendor re-check: status may have changed since quote/accept.
    const [[vrow]] = await pool.execute(`SELECT status FROM vendors WHERE userId = ?`, [request.vendorId]);
    if (!vrow || vrow.status !== 'approved') {
      return res.status(400).json({ message: "This vendor is not available for new orders." });
    }

    items = [
      {
        product: request.baseProductId || null,
        name: `Custom Kente (${request.yards} yd)`,
        title: request.baseProductTitle || "Custom Kente",
        qty: 1,
        quantity: 1,
        price,
        vendorId: request.vendorId,
        image: request.referenceImage || null,
        customRequestId: request.id,
        selectedColor: request.dominantColour || null,
        selectedSize: String(request.yards),
        yards: String(request.yards),
        dominantThread: request.dominantThread || null,
        threadTypes: request.threadTypes || [],
      },
    ];

    completionDate = completionFromRequest(request);
    notes = userNotes || `Custom kente request #${request.id} — vendor: ${request.vendorBusinessName}. Needed by: ${request.neededForDate} ${request.neededForTime}`;
  } catch (error) {
    console.error(" checkoutRequest validation error:", error.message);
    return res.status(500).json({ message: "Failed to validate custom order payment" });
  }

  // Phase 2: Execute all database mutations in a SINGLE transaction.
  // Atomic claim: UPDATE custom_requests SET status='paid', orderId=? WHERE id=? AND status='accepted'
  // Only ONE checkout can win this claim. The loser gets 0 affected rows and fails cleanly.
  const connection = await pool.getConnection();
  let orderId = null;
  let orderNumber = null;
  let advancesReleased = 0;

  try {
    await connection.beginTransaction();

    // 1. ATOMIC CLAIM: Try to transition the custom request from 'accepted' to 'paid'
    //    and reserve the orderId slot in one conditional UPDATE.
    //    We don't know the orderId yet, so we use a two-step within the transaction:
    //    - First, create the order (which generates the orderId)
    //    - Then, atomically claim the custom request with that orderId
    //    If another checkout already claimed it, affectedRows === 0 and we roll back.

    // 1a. Create the order within this transaction (inlined from Order.create).
    orderNumber = newOrderNumber("CUS");

    const [orderResult] = await connection.execute(
      `INSERT INTO orders
        (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
         paymentMethod, paymentStatus, orderStatus, shippingCost, tax, discount, notes, paymentReference,
         couponId, expectedCompletionDate, productionNote, couponUseState)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        request.customerId,
        orderNumber,
        JSON.stringify(items),
        price,
        JSON.stringify(shippingAddress || {}),
        JSON.stringify(shippingAddress || {}),
        paymentMethod || "Card Payment",
        "paid",
        "processing",
        0,
        0,
        0,
        notes,
        paymentReference,
        null,
        completionDate,
        null,
        0,
      ]
    );

    orderId = orderResult.insertId;

    // 1b. Create order_items rows (dual-write for vendor-scoped queries).
    for (const item of items) {
      await connection.execute(
        `INSERT INTO order_items
         (orderId, vendorId, productId, name, qty, price, image, selectedColor, selectedSize, yards,
          isCustomizable, productionTime, reserved, customRequestId, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          orderId,
          item.vendorId,
          item.product || null,
          item.name || item.title || 'Custom Kente',
          1,
          price,
          item.image || null,
          item.selectedColor || null,
          item.selectedSize || null,
          item.yards || null,
          1, // isCustomizable
          1, // productionTime
          0,
          item.customRequestId || null,
        ]
      );
    }

    // 2. ATOMIC CLAIM: Now link the custom request to this order.
    //    Only succeeds if the request is still 'accepted' (not already claimed by another checkout).
    const [claimResult] = await connection.execute(
      `UPDATE custom_requests
       SET status = 'paid', orderId = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'accepted'`,
      [orderId, request.id]
    );

    if (claimResult.affectedRows !== 1) {
      // Another concurrent checkout already claimed this request.
      // Roll back the order we just created and fail cleanly.
      throw new Error('CUSTOM_REQUEST_ALREADY_CLAIMED');
    }

    // 3. Create escrow allocations (advance + balance for custom orders),
    //    inside this transaction, through the same commission builder as
    //    standard checkout. A request with no base product is still escrowed
    //    for its vendor (rated by vendor > global rules) — previously it was
    //    skipped, so the weaver could never be paid for a paid order (D-2).
    const { rows: allocationRows, snapshot } = await buildEscrowAllocationRows(connection, items, {
      advanceRatio: CUSTOM_ADVANCE_RATIO,
      discount: 0, // custom orders have no coupon discount
    });
    await connection.execute(`UPDATE orders SET commissionSnapshot = ? WHERE id = ?`, [JSON.stringify(snapshot), orderId]);
    for (const r of allocationRows) {
      await connection.execute(
        `INSERT IGNORE INTO escrow_allocations
           (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [orderId, r.vendorId, r.amount, r.platformFeeRate, r.platformFee, r.payoutAmount, r.allocationType]
      );
    }

    // 4. Hold escrow (pending -> held).
    await connection.execute(
      `UPDATE escrow_allocations
       SET status = 'held', updated_at = CURRENT_TIMESTAMP
       WHERE orderId = ? AND status = 'pending'`,
      [orderId]
    );
    await connection.execute(
      `UPDATE orders SET escrowStatus = 'held', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND escrowStatus IN ('none', 'held')`,
      [orderId]
    );

    // 5. Release advance allocations (held -> available + wallet credit).
    //    Inlined from releaseAllocation to run within this transaction.
    const [advanceAllocations] = await connection.execute(
      `SELECT ea.*, v.businessName, v.recipientCode
       FROM escrow_allocations ea
       JOIN vendors v ON v.userId = ea.vendorId
       WHERE ea.orderId = ? AND ea.allocationType = 'advance' AND ea.status = 'held'`,
      [orderId]
    );

    for (const allocation of advanceAllocations) {
      const { platformFee, payoutAmount } = allocationFees(allocation);

      // Lock the allocation row and re-check order eligibility atomically.
      const [transition] = await connection.execute(
        `UPDATE escrow_allocations ea
           SET ea.status = 'available', ea.platformFee = ?, ea.payoutAmount = ?,
               ea.updated_at = CURRENT_TIMESTAMP
         WHERE ea.id = ? AND ea.status = 'held'
           AND NOT EXISTS (
             SELECT 1 FROM orders o
              WHERE o.id = ea.orderId
                AND (o.orderStatus = 'cancelled' OR o.paymentStatus = 'refunded' OR o.paymentStatus != 'paid')
           )`,
        [platformFee, payoutAmount, allocation.id]
      );

      if (transition.affectedRows === 1) {
        // Credit vendor wallet in the same transaction.
        const amount = round2(parseFloat(String(payoutAmount)) || 0);
        if (amount > 0) {
          await connection.execute(`INSERT IGNORE INTO vendor_wallets (vendorId) VALUES (?)`, [allocation.vendorId]);
          const [ledger] = await connection.execute(
            `INSERT IGNORE INTO wallet_transactions (vendorId, type, amount, allocationId, note, status)
             VALUES (?, 'credit', ?, ?, ?, 'succeeded')`,
            [allocation.vendorId, amount, allocation.id, `Escrow advance release for order ${orderNumber}`.trim()]
          );
          if (ledger.affectedRows === 1) {
            await connection.execute(
              `UPDATE vendor_wallets
               SET available_balance = available_balance + ?, total_earned = total_earned + ?,
                   updated_at = CURRENT_TIMESTAMP WHERE vendorId = ?`,
              [amount, amount, allocation.vendorId]
            );
            // Record financial event (best-effort, non-fatal if it fails)
            try {
              await recordFinancialEvent({
                eventType: 'escrow.release',
                direction: 'info',
                amount,
                vendorId: allocation.vendorId,
                allocationId: allocation.id,
                reference: `escrow.release:${allocation.id}`,
                dedupeKey: `escrow.release:${allocation.id}`,
                payload: { orderNumber: orderNumber || null },
                connection,
              });
            } catch { /* journal is best-effort */ }
            advancesReleased += 1;
          }
        }
      }
    }

    await connection.commit();

    // Phase 3: Post-commit operations (non-critical, best-effort).
    // These can fail without leaving the database in an inconsistent state.
    if (request.baseProductId) {
      try {
        await issueCertificateForOrder(orderId, {
          productId: request.baseProductId,
          issuedTo: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Verified Customer',
        });
      } catch (certErr) {
        console.warn(` Auto-certificate for order ${orderId} skipped: ${certErr.message}`);
      }
    }

    try {
      await Notification.create({
        userId: request.vendorId,
        type: "custom",
        title: `Custom order received — request #${request.id}`,
        message: `Payment of GHS ${price.toFixed(2)} confirmed. ${Math.round((CUSTOM_ADVANCE_RATIO || 0) * 100)}% released to you as an advance; the rest is held until delivery is confirmed.`,
        link: "/vendor/custom-requests",
      });
    } catch { /* non-fatal */ }

    // Build response objects (refetch to include all relations).
    const order = await Order.findById(orderId);
    const updatedRequest = await CustomRequest.findById(request.id);

    if (advancesReleased > 0) {
      console.log(` Released ${advancesReleased} advance allocation(s) for custom order ${orderId}`);
    }

    res.status(201).json({
      message: "Payment received. Your custom order is now with the vendor.",
      order,
      request: updatedRequest,
    });

  } catch (error) {
    await connection.rollback().catch(() => {});

    // If the failure was due to concurrent claim, return a clear 409.
    if (error.message === 'CUSTOM_REQUEST_ALREADY_CLAIMED') {
      return res.status(409).json({
        message: "This request has already been paid for. Please refresh the page.",
      });
    }

    // If we created an order but rolled back, the paymentReference is now free
    // (the order row was deleted by rollback). However, the Paystack charge
    // has ALREADY succeeded and cannot be rolled back. Log for reconciliation.
    if (orderId) {
      console.error(
        `CRITICAL: Custom request checkout failed after Paystack verification. ` +
        `Payment reference=${paymentReference}, customer=${request.customerId}, ` +
        `request=${request.id}, vendor=${request.vendorId}, amount=${price}. ` +
        `Order creation was rolled back. This charge requires manual reconciliation. ` +
        `Error: ${error.message}`
      );
    }

    console.error(" checkoutRequest error:", error.message);
    res.status(500).json({ message: "Failed to complete custom order payment" });
  } finally {
    connection.release();
  }
};

// ============================================
// VENDOR SLICE
// ============================================

// GET /api/custom-requests/vendor — requests received by the vendor
export const listVendorRequests = async (req, res) => {
  try {
    const vendorId = await getVendorUserId(req.user.id);
    if (!vendorId) {
      return res.status(400).json({ message: "No vendor account linked to this user" });
    }
    const requests = await CustomRequest.findByVendor(vendorId, { status: req.query.status });
    res.json(requests);
  } catch (error) {
 console.error(" listVendorRequests error:", error.message);
    res.status(500).json({ message: "Failed to fetch custom requests" });
  }
};

// POST /api/custom-requests/:id/quote — vendor quotes & commits to timeline
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
    try {
      await Notification.create({
        userId: request.customerId,
        type: "custom",
        title: `Quote received for request #${request.id}`,
        message: `${request.vendorBusinessName || "Your weaver"} quoted GHS ${quoteTotal.toFixed(2)}${canMeetFlag ? "" : " and can't meet your requested time"} — review and accept or cancel.`,
        link: "/custom-requests",
      });
    } catch {
      /* non-fatal */
    }
  } catch (error) {
 console.error(" quoteRequest error:", error.message);
    res.status(500).json({ message: "Failed to submit quote" });
  }
};

// POST /api/custom-requests/:id/decline — vendor cannot take the order
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
    try {
      await Notification.create({
        userId: request.customerId,
        type: "custom",
        title: `Request #${request.id} declined`,
        message: vendorMessage ? `The weaver said: "${vendorMessage.trim().slice(0, 300)}". Try another weaver or tweak your spec.` : "The weaver couldn't take this order. Try another weaver.",
        link: "/custom-requests",
      });
    } catch {
      /* non-fatal */
    }
    res.json({ message: "Request declined. The customer has been notified.", request: updated });
  } catch (error) {
 console.error(" declineRequest error:", error.message);
    res.status(500).json({ message: "Failed to decline request" });
  }
};

// POST /api/custom-requests/:id/in-progress — vendor starts weaving (paid)
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
    try {
      await Notification.create({
        userId: request.customerId,
        type: "custom",
        title: `Weaving started — request #${request.id}`,
        message: "Your weaver has started on your custom Kente. We'll keep you posted.",
        link: "/custom-requests",
      });
    } catch {
      /* non-fatal */
    }
    res.json({ message: "Marked as in progress.", request: updated });
  } catch (error) {
 console.error(" startRequest error:", error.message);
    res.status(500).json({ message: "Failed to update request" });
  }
};

// ============================================
// ADMIN SLICE
// ============================================

// GET /api/custom-requests/admin — all requests
export const listAllRequests = async (req, res) => {
  try {
    const requests = await CustomRequest.findAllAdmin({ status: req.query.status });
    res.json(requests);
  } catch (error) {
 console.error(" listAllRequests error:", error.message);
    res.status(500).json({ message: "Failed to fetch custom requests" });
  }
};

// GET /api/custom-requests/admin/stats — stats for analysis/prediction
export const getAdminStats = async (req, res) => {
  try {
    const stats = await CustomRequest.adminStats();
    res.json(stats);
  } catch (error) {
 console.error(" getAdminStats error:", error.message);
    res.status(500).json({ message: "Failed to fetch custom request stats" });
  }
};

// POST /api/custom-requests/:id/reviewed — mark conversation as complete
//    so customer support can call the customer.
export const markReviewed = async (req, res) => {
  try {
    const request = await CustomRequest.findById(parseInt(req.params.id));
    if (!request) return res.status(404).json({ message: "Request not found" });
    const updated = await CustomRequest.update(request.id, { adminReviewed: 1 });
    res.json({ message: "Marked as reviewed.", request: updated });
  } catch (error) {
 console.error(" markReviewed error:", error.message);
    res.status(500).json({ message: "Failed to update request" });
  }
};