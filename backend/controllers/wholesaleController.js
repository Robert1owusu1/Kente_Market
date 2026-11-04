// FILE LOCATION: backend/controllers/wholesaleController.js
// DESCRIPTION: B2B wholesale bulk quotes (Phase 3, Step 9). Buyers (any logged-in
//   customer) request a bulk quote on a wholesale-enabled product; the product's
//   vendor (plan: bulk_wholesale) responds with a unit price. Converting an
//   accepted quote to a paid order is the follow-up phase.
import pool from '../config/db.js';
import BulkQuote from '../models/bulkQuoteModel.js';
import { getPlanAccess, hasFeature } from '../Services/planAccessService.js';
import { PLAN_FEATURES } from '../../shared/plans.js';
import { buildEscrowAllocationRows } from '../Services/commissionService.js';
import PaystackService from '../Services/paystackservices.js';
import { CHARGED_CURRENCY } from '../Services/paymentCurrency.js';
import { newOrderNumber } from '../utils/orderNumber.js';
import { round2, calcTax } from '../../shared/pricing.js';
import { getVatRate } from '../Services/pricingConfig.js';

/** Compute the payable total for an accepted quote (goods + VAT; bulk delivery
 *  is arranged in the quote so shipping is 0 here). */
const priceQuote = async (quote) => {
  const subtotal = round2(Number(quote.quotedUnitPrice) * Number(quote.quantity));
  const tax = calcTax(subtotal, await getVatRate());
  return { subtotal, tax, shipping: 0, total: round2(subtotal + tax) };
};

// @desc    Buyer: request a bulk quote
// @route   POST /api/wholesale/quotes   { productId, quantity, companyName?, contactPhone?, message? }
// @access  Private
export const createQuoteRequest = async (req, res) => {
  try {
    const { productId, quantity, companyName, contactPhone, message } = req.body || {};
    const pid = Number(productId);
    const qty = Math.floor(Number(quantity));
    if (!pid) return res.status(400).json({ message: 'productId is required' });
    if (!Number.isInteger(qty) || qty < 1) return res.status(400).json({ message: 'Enter a valid quantity' });

    const [[product]] = await pool.execute(
      `SELECT id, vendorId, wholesaleEnabled, wholesaleMinQty, approvalStatus FROM product WHERE id = ?`, [pid]
    );
    if (!product || product.approvalStatus !== 'approved') return res.status(404).json({ message: 'Product not found' });
    if (!product.wholesaleEnabled) return res.status(409).json({ message: 'This product is not available for wholesale' });
    if (product.wholesaleMinQty && qty < product.wholesaleMinQty) {
      return res.status(400).json({ message: `Minimum wholesale quantity for this product is ${product.wholesaleMinQty}` });
    }

    const quote = await BulkQuote.create({
      buyerUserId: req.user.id,
      vendorId: product.vendorId ?? null,
      productId: pid,
      quantity: qty,
      companyName: companyName ? String(companyName).slice(0, 200) : null,
      contactPhone: contactPhone ? String(contactPhone).slice(0, 50) : null,
      message: message ? String(message).slice(0, 2000) : null,
    });
    res.status(201).json({ message: 'Bulk quote request sent', quote });
  } catch (error) {
    console.error('createQuoteRequest error:', error.message);
    res.status(500).json({ message: 'Failed to send quote request' });
  }
};

// @desc    Buyer: my quote requests
// @route   GET /api/wholesale/quotes/mine
// @access  Private
export const getMyQuoteRequests = async (req, res) => {
  try {
    res.json(await BulkQuote.findByBuyer(req.user.id));
  } catch (error) {
    console.error('getMyQuoteRequests error:', error.message);
    res.status(500).json({ message: 'Failed to load quote requests' });
  }
};

// @desc    Buyer: accept / decline a quote
// @route   POST /api/wholesale/quotes/:id/accept  |  /decline
// @access  Private
export const respondToQuote = (decision) => async (req, res) => {
  try {
    const quote = await BulkQuote.findById(req.params.id);
    if (!quote || Number(quote.buyerUserId) !== Number(req.user.id)) {
      return res.status(404).json({ message: 'Quote not found' });
    }
    if (quote.status !== 'quoted') {
      return res.status(409).json({ message: 'This quote cannot be updated' });
    }
    if (decision === 'accept' && quote.validUntil && new Date(quote.validUntil) < new Date()) {
      return res.status(409).json({ message: 'This quote has expired' });
    }
    const updated = await BulkQuote.setStatus(quote.id, decision === 'accept' ? 'accepted' : 'declined');
    res.json({ message: decision === 'accept' ? 'Quote accepted' : 'Quote declined', quote: updated });
  } catch (error) {
    console.error('respondToQuote error:', error.message);
    res.status(500).json({ message: 'Failed to update quote' });
  }
};

// @desc    Vendor: quote requests on my products
// @route   GET /api/vendors/wholesale/quotes
// @access  Private (vendor)
export const getVendorQuoteRequests = async (req, res) => {
  try {
    res.json(await BulkQuote.findByVendor(req.user.id));
  } catch (error) {
    console.error('getVendorQuoteRequests error:', error.message);
    res.status(500).json({ message: 'Failed to load quote requests' });
  }
};

// @desc    Vendor: respond with a quote (unit price)
// @route   POST /api/vendors/wholesale/quotes/:id/quote  { unitPrice, note?, validDays? }
// @access  Private (vendor; plan: bulk_wholesale)
export const vendorQuote = async (req, res) => {
  try {
    const quote = await BulkQuote.findById(req.params.id);
    if (!quote || Number(quote.vendorId) !== Number(req.user.id)) {
      return res.status(404).json({ message: 'Quote not found' });
    }
    // Plan gate: only vendors whose plan includes wholesale can answer.
    const access = await getPlanAccess(req.user.id);
    if (!hasFeature(access, PLAN_FEATURES.BULK_WHOLESALE)) {
      return res.status(403).json({ message: 'Your plan does not include wholesale. Upgrade to answer bulk quotes.', code: 'PLAN_FEATURE_REQUIRED' });
    }
    if (!['pending', 'quoted'].includes(quote.status)) {
      return res.status(409).json({ message: 'This request can no longer be quoted' });
    }
    const unitPrice = Number(req.body?.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return res.status(400).json({ message: 'Enter a valid unit price' });
    const validDays = req.body?.validDays != null ? Math.floor(Number(req.body.validDays)) : null;
    const validUntil = validDays && validDays > 0
      ? new Date(Date.now() + validDays * 86400000).toISOString().slice(0, 19).replace('T', ' ')
      : null;

    const updated = await BulkQuote.quote(quote.id, {
      quotedUnitPrice: unitPrice,
      quoteNote: req.body?.note ? String(req.body.note).slice(0, 1000) : null,
      quotedBy: req.user.id,
      validUntil,
    });
    res.json({ message: 'Quote sent to buyer', quote: updated });
  } catch (error) {
    console.error('vendorQuote error:', error.message);
    res.status(500).json({ message: 'Failed to send quote' });
  }
};

// --- Phase B: pay for an accepted quote (on-platform order + escrow) ---

// @desc    Payable total for an accepted quote (for the Paystack popup amount)
// @route   GET /api/wholesale/quotes/:id/checkout-total
// @access  Private
export const getBulkQuoteCheckoutTotal = async (req, res) => {
  try {
    const quote = await BulkQuote.findById(req.params.id);
    if (!quote || Number(quote.buyerUserId) !== Number(req.user.id)) return res.status(404).json({ message: 'Quote not found' });
    if (quote.status !== 'accepted') return res.status(409).json({ message: 'Accept the quote before paying' });
    if (!(quote.quotedUnitPrice > 0)) return res.status(400).json({ message: 'This quote has no price' });
    const priced = await priceQuote(quote);
    res.json({ ...priced, currency: CHARGED_CURRENCY, quantity: quote.quantity, unitPrice: quote.quotedUnitPrice });
  } catch (error) {
    console.error('getBulkQuoteCheckoutTotal error:', error.message);
    res.status(500).json({ message: 'Failed to price the quote' });
  }
};

// @desc    Convert an accepted quote into a paid on-platform order (+ escrow).
// @route   POST /api/wholesale/quotes/:id/checkout   { paymentReference, shippingAddress }
// @access  Private
export const checkoutBulkQuote = async (req, res) => {
  // Phase 1: validate + verify Paystack OUTSIDE the transaction.
  let quote, priced, items, shippingAddress, paymentReference;
  try {
    ({ paymentReference, shippingAddress } = req.body || {});
    quote = await BulkQuote.findById(req.params.id);
    if (!quote || Number(quote.buyerUserId) !== Number(req.user.id)) return res.status(404).json({ message: 'Quote not found' });
    if (quote.status !== 'accepted') return res.status(409).json({ message: 'This quote cannot be paid' });
    if (!(quote.quotedUnitPrice > 0)) return res.status(400).json({ message: 'This quote has no price' });
    if (!paymentReference) return res.status(400).json({ message: 'Payment reference is missing' });
    if (quote.validUntil && new Date(quote.validUntil) < new Date()) return res.status(409).json({ message: 'This quote has expired' });

    // Vendor must still be approved (platform products have vendorId NULL).
    if (quote.vendorId != null) {
      const [[vrow]] = await pool.execute(`SELECT status FROM vendors WHERE userId = ?`, [quote.vendorId]);
      if (!vrow || vrow.status !== 'approved') return res.status(400).json({ message: 'This vendor is not available for new orders.' });
    }

    priced = await priceQuote(quote);

    const verification = await PaystackService.verifyTransaction(paymentReference);
    const tx = verification?.data;
    if (!tx || tx.status !== 'success') return res.status(400).json({ message: 'Payment has not been completed. Please try again.' });
    const paidKobo = parseInt(tx.amount, 10);
    if (tx.currency !== CHARGED_CURRENCY || !Number.isFinite(paidKobo) || paidKobo !== Math.round(priced.total * 100)) {
      return res.status(400).json({ message: 'Payment amount does not match the order total.' });
    }
    const [[existingRef]] = await pool.execute('SELECT id FROM orders WHERE paymentReference = ? LIMIT 1', [paymentReference]);
    if (existingRef) return res.status(400).json({ message: 'This payment reference has already been used.' });

    const [[product]] = await pool.execute(`SELECT id, title, img FROM product WHERE id = ?`, [quote.productId]);
    items = [{
      product: quote.productId, name: product?.title || 'Wholesale order', title: product?.title || 'Wholesale order',
      qty: quote.quantity, quantity: quote.quantity, price: round2(Number(quote.quotedUnitPrice)),
      vendorId: quote.vendorId ?? null, image: product?.img || null,
    }];
  } catch (error) {
    console.error('checkoutBulkQuote validation error:', error.message);
    return res.status(500).json({ message: 'Failed to validate wholesale payment' });
  }

  // Phase 2: single transaction — create order, claim quote, build + hold escrow.
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const orderNumber = newOrderNumber('WHL');
    const [orderResult] = await connection.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
         paymentMethod, paymentStatus, orderStatus, shippingCost, tax, discount, notes, paymentReference, couponUseState)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', 'processing', ?, ?, 0, ?, ?, 0)`,
      [
        quote.buyerUserId, orderNumber, JSON.stringify(items), priced.total,
        JSON.stringify(shippingAddress || {}), JSON.stringify(shippingAddress || {}),
        'paystack', priced.shipping, priced.tax,
        `Wholesale order from bulk quote #${quote.id} (${quote.quantity} units)`, paymentReference,
      ]
    );
    const orderId = orderResult.insertId;

    await connection.execute(
      `INSERT INTO order_items (orderId, vendorId, productId, name, qty, price, image, reserved, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
      [orderId, items[0].vendorId, items[0].product, items[0].name, items[0].qty, items[0].price, items[0].image]
    );

    // Atomic claim: only one checkout converts the quote.
    const [claim] = await connection.execute(
      `UPDATE bulk_quote_requests SET status = 'closed', orderId = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'accepted'`,
      [orderId, quote.id]
    );
    if (claim.affectedRows !== 1) throw new Error('QUOTE_ALREADY_CONVERTED');

    // Standard escrow (no advance split). Platform-owned lines (vendorId NULL)
    // get no allocation → platform keeps 100% (same as normal checkout).
    const { rows, snapshot } = await buildEscrowAllocationRows(connection, items, { advanceRatio: 0, discount: 0 });
    await connection.execute(`UPDATE orders SET commissionSnapshot = ? WHERE id = ?`, [JSON.stringify(snapshot), orderId]);
    for (const r of rows) {
      await connection.execute(
        `INSERT IGNORE INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [orderId, r.vendorId, r.amount, r.platformFeeRate, r.platformFee, r.payoutAmount, r.allocationType]
      );
    }
    await connection.execute(`UPDATE escrow_allocations SET status = 'held', updated_at = CURRENT_TIMESTAMP WHERE orderId = ? AND status = 'pending'`, [orderId]);
    await connection.execute(`UPDATE orders SET escrowStatus = 'held', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND escrowStatus IN ('none','held')`, [orderId]);

    await connection.commit();
    res.status(201).json({ message: 'Wholesale order placed', orderId, orderNumber, total: priced.total });
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('checkoutBulkQuote error:', error.message,
      `(payment ${paymentReference} may need reconciliation)`);
    const msg = error.message === 'QUOTE_ALREADY_CONVERTED' ? 'This quote has already been paid.' : 'Failed to place the wholesale order';
    res.status(error.message === 'QUOTE_ALREADY_CONVERTED' ? 409 : 500).json({ message: msg });
  } finally {
    connection.release();
  }
};
