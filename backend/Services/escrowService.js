// @ts-check
// SERVICES/escrowService.js
// Multi-vendor escrow: funds are captured to the platform's Paystack balance and
// held until the customer confirms receipt (or the release deadline passes), then
// paid out to each vendor via Paystack Transfers minus the platform commission.
import pool from '../config/db.js';
import paystackServices from './paystackservices.js';
import { creditVendorBalance } from './walletService.js';
import { PLATFORM_FEE_RATE, ESCROW_RELEASE_DAYS } from '../config/businessConfig.js';
import { resolveCommissionRate } from './commissionService.js';
import Notification from '../models/notificationModel.js';
import { round2, calcEscrowFees } from '../../shared/pricing.js';

/**
 * @typedef {Object} Allocation
 * @property {number | string} id escrow allocation id
 * @property {number | string} orderId order id
 * @property {number | string} vendorId vendor user id
 * @property {number | string} amount gross vendor amount (GHS)
 * @property {number | string} platformFeeRate effective commission fraction (0..1)
 * @property {number | string} [platformFee] computed platform fee
 * @property {number | string} [payoutAmount] net amount owed to vendor
 * @property {string} status pending | held | available | releasing | released | failed
 * @property {string | null} [payoutReference] Paystack transfer reference
 * @property {string | null} [recipientCode] vendor Paystack recipient code
 * @property {string} [reason] last-change reason
 */

/**
 * @typedef {Object} OrderLine
 * @property {number} [product] legacy product field (product id)
 * @property {number} [productId] product id
 * @property {number} [id] product id fallback
 * @property {number | string} [vendorId] owning vendor user id (absent = platform-owned)
 * @property {number | string} [quantity] purchased quantity
 * @property {number | string} [price] unit price (GHS)
 * @property {number | string} [qty] quantity fallback name
 */

/**
 * Load escrow allocations for an order (joined with vendor payout info).
 * @param {number | string} orderId
 * @returns {Promise<Allocation[]>}
 */
export const getOrderAllocations = async (orderId) => {
  const [rows] = await pool.execute(
    `SELECT ea.*, v.businessName, v.recipientCode, v.status AS vendorStatus
     FROM escrow_allocations ea
     JOIN vendors v ON v.userId = ea.vendorId
     WHERE ea.orderId = ?
     ORDER BY ea.id ASC`,
    [orderId]
  );
  return rows;
};

/**
 * Load a vendor's allocations that are in the 'available' state (released to
 * their balance, awaiting withdrawal), joined with their payout recipient.
 * @param {number | string} vendorId
 * @returns {Promise<Allocation[]>}
 */
export const getAvailableAllocationsForVendor = async (vendorId) => {
  const [rows] = await pool.execute(
    `SELECT ea.*, v.businessName, v.recipientCode, v.status AS vendorStatus
     FROM escrow_allocations ea
     JOIN vendors v ON v.userId = ea.vendorId
     WHERE ea.vendorId = ? AND ea.status = 'available'
     ORDER BY ea.id ASC`,
    [vendorId]
  );
  return rows;
};

/**
 * Recompute the order-level escrowStatus from its allocations.
 * Priority:
 *   1. no allocations -> none
 *   2. all released/available -> released (funds have left escrow either to a
 *      vendor bank/momo or into their available balance; the orders table enum
 *      only holds 'released' since allocation-level 'available' is not a valid
 *      order-level status)
 *   3. any pending     -> releasing (not yet held/finalized)
 *   4. any releasing   -> releasing (transfers in flight)
 *   5. any held        -> held (still awaiting release)
 *   6. else any failed -> failed (nothing held/in-flight/pending)
 * @param {number | string} orderId
 * @returns {Promise<string>}
 */
export const recomputeOrderEscrowStatus = async (orderId) => {
  const rows = await getOrderAllocations(orderId);
  if (rows.length === 0) return 'none';

  const statuses = new Set(rows.map((r) => r.status));

  if (statuses.size === 1 && (statuses.has('released') || statuses.has('available'))) return 'released';
  if (statuses.has('pending')) return 'releasing';
  if (statuses.has('releasing')) return 'releasing';
  if (statuses.has('held')) return 'held';
  if (statuses.has('failed')) return 'failed';
  // Any mix of released/available allocations: escrow funds have already left
  // the platform's escrow into vendor hands, so the order is effectively released.
  if (statuses.has('available') || statuses.has('released')) return 'released';
  return 'held';
};

/**
 * Create per-vendor escrow allocations from order items at order placement.
 * Items with a vendor-owned product produce an allocation keyed by vendorId.
 *
 * Custom orders may pass `options.advanceRatio` (0..1) to split each vendor's
 * escrow into an up-front "advance" allocation (released to the vendor's
 * balance at payment) and a "balance" allocation held until delivery —
 * the 50/50 advance-escrow model. Both rows are created as 'pending' so they
 * are held together by the usual payment-verification flow.
 * @param {number | string} orderId
 * @param {OrderLine[]} items
 * @param {{ advanceRatio?: number }} [options]
 * @returns {Promise<number>} number of allocations created
 */
export const createEscrowAllocations = async (orderId, items, { advanceRatio = 0 } = {}) => {
  if (!Array.isArray(items) || items.length === 0) return 0;

  // Idempotency guard: never double-create escrow for an order (replaces the
  // removed uq_escrow_order_vendor unique key, which also blocked splitting a
  // custom order into advance + balance rows).
  const [[existing]] = await pool.execute(
    `SELECT COUNT(*) AS c FROM escrow_allocations WHERE orderId = ?`,
    [parseInt(orderId)]
  );
  if ((existing?.c || 0) > 0) return 0;

  const productIds = items
    .map((it) => it?.product || it?.productId || it?.id)
    .filter((id) => id !== undefined && id !== null);

  if (productIds.length === 0) return 0;

  const placeholders = productIds.map(() => '?').join(', ');
  const [products] = await pool.execute(
    `SELECT id, vendorId, price FROM product WHERE id IN (${placeholders})`,
    productIds
  );
  /** @type {Array<{ id: number, vendorId: number | string, price: number | string, category?: string }>} */
  const productRows = products;
  const productMap = new Map(productRows.map((p) => [p.id, p]));

  // vendorId -> total amount owed to that vendor
  const vendorTotals = new Map();
  for (const it of items) {
    const pid = /** @type {any} */ (it?.product || it?.productId || it?.id);
    const product = productMap.get(pid);
    const vendorId = product?.vendorId || it?.vendorId || null;
    if (!vendorId) continue; // platform-owned items skip escrow
    const qty = parseFloat(String(it?.quantity)) || 1;
    const price = parseFloat(String(it?.price ?? product?.price)) || 0;
    vendorTotals.set(vendorId, (vendorTotals.get(vendorId) || 0) + qty * price);
  }

  const ratio = Math.max(0, Math.min(1, parseFloat(advanceRatio) || 0));

  let created = 0;
  for (const [vendorId] of vendorTotals) {
    // Resolve the effective commission via the commission engine:
    // product > vendor > category > global, then vendor override, then default.
    const productForVendor = [...productRows].find((p) => p.vendorId === vendorId);
    const feeRate = await resolveCommissionRate({
      productId: productForVendor?.id,
      vendorId,
      category: productForVendor?.category,
    });
    const totalAmount = vendorTotals.get(vendorId) || 0;

    if (ratio > 0 && totalAmount > 0) {
      // 50/50 (or configured) advance escrow: split into advance + balance.
      const advanceAmount = round2(totalAmount * ratio);
      const balanceAmount = round2(totalAmount - advanceAmount);
      const { platformFee: advanceFee } = calcEscrowFees(advanceAmount, feeRate, PLATFORM_FEE_RATE);
      const { platformFee: balanceFee } = calcEscrowFees(balanceAmount, feeRate, PLATFORM_FEE_RATE);
      if (advanceAmount > 0) {
        await pool.execute(
          `INSERT IGNORE INTO escrow_allocations
             (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', 'advance')`,
          [orderId, vendorId, advanceAmount, feeRate, advanceFee, round2(advanceAmount - advanceFee)]
        );
        created += 1;
      }
      if (balanceAmount > 0) {
        await pool.execute(
          `INSERT IGNORE INTO escrow_allocations
             (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', 'balance')`,
          [orderId, vendorId, balanceAmount, feeRate, balanceFee, round2(balanceAmount - balanceFee)]
        );
        created += 1;
      }
      continue;
    }

    const { platformFee, payoutAmount } = calcEscrowFees(totalAmount, feeRate, PLATFORM_FEE_RATE);
    await pool.execute(
      `INSERT IGNORE INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [orderId, vendorId, round2(totalAmount), feeRate, platformFee, payoutAmount]
    );
    created += 1;
  }
  return created;
};

/**
 * Release a single held allocation into the vendor's wallet balance.
 * On delivery confirmation the funds are NOT transferred to the vendor's
 * MoMo/bank automatically. Instead they are credited to the vendor's available
 * balance, and the vendor withdraws them manually via the Withdraw button.
 * Idempotent: only held -> available transitions.
 * @param {Allocation} allocation
 * @returns {Promise<Allocation>}
 */
export const releaseAllocation = async (allocation) => {
  const updated = { ...allocation };

  if (allocation.status !== 'held') {
    updated.reason = 'not held';
    return updated;
  }

  const { platformFee, payoutAmount } = calcEscrowFees(
    allocation.amount,
    allocation.platformFeeRate,
    PLATFORM_FEE_RATE
  );

  await pool.execute(
    `UPDATE escrow_allocations
     SET status = 'available', platformFee = ?, payoutAmount = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'held'`,
    [platformFee, payoutAmount, allocation.id]
  );

  // Credit the vendor's wallet balance (durable, shown on dashboard).
  const [orderRows] = await pool.execute(
    `SELECT orderNumber FROM orders WHERE id = ?`,
    [allocation.orderId]
  );
  const orderNumber = orderRows.length > 0 ? orderRows[0].orderNumber : null;
  await creditVendorBalance(allocation.vendorId, allocation.id, payoutAmount, orderNumber);

  updated.status = 'available';
  updated.platformFee = platformFee;
  updated.payoutAmount = payoutAmount;
  updated.reason = 'credited to vendor balance (pending withdrawal)';
  return updated;
};

/**
 * Pay out an allocation to the vendor's Paystack recipient (MoMo/bank).
 * Called by the vendor's Withdraw action. Supports both whole-allocation
 * withdrawals and partial withdrawals of any amount up to the remaining
 * balance: a full payout moves available -> releasing; a partial one transfers
 * just the requested amount and keeps the allocation available so the vendor
 * can withdraw the rest later.
 * @param {Allocation} allocation
 * @param {number | string} [requestedAmount] amount to withdraw from this
 *   allocation (defaults to the full remaining payoutAmount)
 * @returns {Promise<Allocation>}
 */
export const payoutAllocation = async (allocation, requestedAmount) => {
  const updated = { ...allocation, paid: false };

  if (allocation.status !== 'available') {
    updated.reason = `not available (status='${allocation.status}')`;
    return updated;
  }

  if (!allocation.recipientCode) {
    // No recipient yet — leave the allocation 'available' so the vendor can
    // add payout details and retry. Never burn the allocation here.
    updated.reason = 'vendor has no payout recipient';
    return updated;
  }

  // The stored remainder is the source of truth: fees were fixed at release
  // time, so never recompute them here or we'd drift from the wallet ledger.
  const available = parseFloat(String(allocation.payoutAmount ?? 0)) || 0;
  const requested = parseFloat(String(requestedAmount)) || available;
  const amount = Math.min(available, Math.max(0, requested));
  if (amount <= 0) {
    updated.reason = 'invalid withdrawal amount';
    return updated;
  }
  const fullPayout = round2(available) - round2(amount) < 0.01;

  try {
    const result = await paystackServices.initiateTransfer(
      amount,
      allocation.recipientCode,
      `Escrow payout for order #${allocation.orderId}`
    );
    const reference = result?.data?.data?.reference || result?.data?.reference || null;
    if (!reference) {
      throw new Error('Paystack transfer returned no reference');
    }

    if (fullPayout) {
      await pool.execute(
        `UPDATE escrow_allocations
         SET status = 'releasing', payoutReference = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [reference, allocation.id]
      );
      updated.status = 'releasing';
    } else {
      const remainingGross = Math.max(0, round2((parseFloat(String(allocation.amount ?? 0)) || 0) - amount));
      const remainingNet = Math.max(0, round2(available - amount));
      await pool.execute(
        `UPDATE escrow_allocations
         SET amount = ?, payoutAmount = ?, payoutReference = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'available'`,
        [remainingGross, remainingNet, reference, allocation.id]
      );
      updated.amount = remainingGross;
      updated.payoutAmount = remainingNet;
      updated.status = 'available';
      updated.reason = `partial withdrawal of GHS ${round2(amount).toFixed(2)} (${round2(remainingNet).toFixed(2)} remaining)`;
    }
    updated.paid = true;
    updated.platformFee = allocation.platformFee;
    updated.payoutReference = reference;
  } catch (error) {
    // Transient failure (bad recipient, Paystack declined, no balance in the
    // payout account, etc). Keep the allocation 'available' so the vendor can
    // fix their payout details and try again — money is NOT lost or orphaned.
    console.error(`❌ Escrow payout failed for allocation ${allocation.id}:`, error.message);
    updated.status = 'available';
    updated.reason = error.message;
  }
  return updated;
};

/**
 * Release ALL escrow for an order that has been delivered and confirmed
 * (or auto-released after the deadline). Idempotent per allocation.
 * @param {number | string} orderId
 * @returns {Promise<{ released: number, available: number, failed: number }>}
 */
export const releaseEscrowForOrder = async (orderId) => {
  const allocations = await getOrderAllocations(orderId);
  if (allocations.length === 0) return { released: 0, available: 0, failed: 0 };

  let available = 0;
  let failed = 0;

  for (const allocation of allocations) {
    if (allocation.status === 'held') {
      const updated = await releaseAllocation(allocation);
      if (updated.status === 'available') available += 1;
      else if (updated.status === 'failed') failed += 1;
    }
  }

  const escrowStatus = await recomputeOrderEscrowStatus(orderId);
  await pool.execute(
    `UPDATE orders SET escrowStatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [escrowStatus, orderId]
  );

  return { released: available, available, failed };
};

/**
 * Place an order's allocations into escrow ("held") once payment succeeds.
 * Idempotent: safe to call multiple times (double-webhook race).
 * @param {number | string} orderId
 * @returns {Promise<number>} number of affected allocation rows
 */
export const holdEscrowForOrder = async (orderId) => {
  const [result] = await pool.execute(
    `UPDATE escrow_allocations
     SET status = 'held', updated_at = CURRENT_TIMESTAMP
     WHERE orderId = ? AND status = 'pending'`,
    [orderId]
  );
  if (result.affectedRows > 0) {
    await pool.execute(
      `UPDATE orders SET escrowStatus = 'held', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND escrowStatus IN ('none', 'held')`,
      [orderId]
    );
  }
  return result.affectedRows;
};

/**
 * Set the auto-release deadline (delivered + escrow held).
 * @param {number | string} orderId
 * @returns {Promise<number>} the configured release window in days
 */
export const setEscrowReleaseDeadline = async (orderId) => {
  await pool.execute(
    `UPDATE orders
     SET escrowReleaseDeadline = DATE_ADD(NOW(), INTERVAL ? DAY), updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND escrowStatus = 'held'`,
    [ESCROW_RELEASE_DAYS, orderId]
  );
  return ESCROW_RELEASE_DAYS;
};

/**
 * Auto-release any delivered escrow orders whose confirmation deadline has passed.
 * Called by the cleanup scheduler.
 */
export const autoReleaseExpiredEscrows = async () => {
  const [rows] = await pool.execute(
    `SELECT id FROM orders
     WHERE orderStatus = 'delivered'
       AND escrowStatus = 'held'
       AND escrowReleaseDeadline IS NOT NULL
       AND escrowReleaseDeadline < NOW()`
  );

  for (const row of rows) {
    const result = await releaseEscrowForOrder(row.id);
    console.log(
      `⏰ Auto-released expired escrow for order ${row.id} (` +
        `${result.released} released, ${result.failed} failed)`
    );
  }
  if (rows.length > 0) {
    console.log(`⏰ Escrow auto-release pass complete (${rows.length} order(s))`);
  }
};

/**
 * Void (cancel) all escrow allocations for an order when the order is cancelled.
 * Only pending/held allocations are voided; releasing/released ones are left as-is.
 * @param {number | string} orderId
 * @returns {Promise<void>}
 */
export const cancelEscrowForOrder = async (orderId) => {
  await pool.execute(
    `UPDATE escrow_allocations
     SET status = 'failed', updated_at = CURRENT_TIMESTAMP
     WHERE orderId = ? AND status IN ('pending', 'held')`,
    [orderId]
  );
  const escrowStatus = await recomputeOrderEscrowStatus(orderId);
  await pool.execute(
    `UPDATE orders SET escrowStatus = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [escrowStatus, orderId]
  );
};

/**
 * Void escrow for an order when a return is approved (full refund scenario).
 * Voids held allocations so funds are returned to the platform balance.
 * @param {number | string} orderId
 * @returns {Promise<void>}
 */
export const voidEscrowForOrder = async (orderId) => {
  await pool.execute(
    `UPDATE escrow_allocations
     SET status = 'failed', updated_at = CURRENT_TIMESTAMP
     WHERE orderId = ? AND status IN ('pending', 'held')`,
    [orderId]
  );
  const escrowStatus = await recomputeOrderEscrowStatus(orderId);
  await pool.execute(
    `UPDATE orders SET escrowStatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [escrowStatus, orderId]
  );
};

/**
 * Retry payouts for all failed escrow allocations of an order.
 * Admin endpoint: allows retrying vendor payouts that failed.
 * @param {number | string} orderId
 * @returns {Promise<{ retried: number, failed: number }>}
 */
export const retryFailedAllocations = async (orderId) => {
  const [rows] = await pool.execute(
    `SELECT ea.*, v.businessName, v.recipientCode, v.status AS vendorStatus
     FROM escrow_allocations ea
     JOIN vendors v ON v.userId = ea.vendorId
     WHERE ea.orderId = ? AND ea.status = 'failed'
     ORDER BY ea.id ASC`,
    [orderId]
  );

  let retried = 0;
  let failed = 0;

  for (const allocation of rows) {
    await pool.execute(
      `UPDATE escrow_allocations
       SET status = 'pending', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [allocation.id]
    );
    allocation.status = 'held';
    const updated = await releaseAllocation(allocation);
    if (updated.status === 'releasing') retried += 1;
    else if (updated.status === 'failed') failed += 1;
  }

  const escrowStatus = await recomputeOrderEscrowStatus(orderId);
  await pool.execute(
    `UPDATE orders SET escrowStatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [escrowStatus, orderId]
  );

  return { retried, failed };
};

/**
 * Track platform revenue from platform-owned products (no vendorId).
 * Called after order creation. Inserts into a platform_revenue table if it
 * exists, otherwise logs to console.
 * @param {number | string} orderId
 * @param {OrderLine[]} items
 * @returns {Promise<void>}
 */
export const trackPlatformRevenue = async (orderId, items) => {
  if (!Array.isArray(items) || items.length === 0) return;

  const platformItems = items.filter((it) => !it.vendorId);
  if (platformItems.length === 0) return;

  const total = platformItems.reduce(
    (sum, it) => sum + (parseFloat(String(it.price)) || 0) * (parseInt(String(it.qty)) || 1),
    0
  );
  if (total <= 0) return;

  try {
    await pool.execute(
      `INSERT INTO platform_revenue (orderId, amount, created_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE amount = VALUES(amount)`,
      [orderId, round2(total)]
    );
  } catch (err) {
    console.warn(`⚠️ Could not track platform revenue for order ${orderId}: ${err.message}`);
  }
};

/**
 * Notify vendors about failed payouts for their escrow allocations.
 * @param {number | string} orderId
 * @param {(number | string)[]} allocationIds
 * @returns {Promise<void>}
 */
export const notifyVendorPayoutFailure = async (orderId, allocationIds) => {
  for (const allocId of allocationIds) {
    try {
      const [rows] = await pool.execute(
        `SELECT ea.vendorId, ea.amount, v.businessName, o.orderNumber
         FROM escrow_allocations ea
         JOIN vendors v ON v.userId = ea.vendorId
         JOIN orders o ON o.id = ea.orderId
         WHERE ea.id = ?`,
        [allocId]
      );
      if (rows.length > 0) {
        const { vendorId, amount, orderNumber } = rows[0];
        await Notification.create({
          userId: vendorId,
          type: 'system',
          title: 'Payout Failed',
          message: `Your payout of GHS ${parseFloat(amount).toFixed(2)} for order ${orderNumber} failed. Please update your payment details or contact support.`,
          link: `/vendor/payouts`,
        });
      }
    } catch (err) {
      console.warn(`⚠️ Could not notify vendor for allocation ${allocId}: ${err.message}`);
    }
  }
};

export { ESCROW_RELEASE_DAYS };

/**
 * Safety net: find orders stuck in paymentStatus='pending' for more than 1 hour
 * (have a paymentReference) and verify them directly with Paystack. This catches
 * the case where both the webhook and the verify-paystack fallback failed.
 * Called periodically by the cleanup scheduler.
 */
export const recoverStuckPendingOrders = async () => {
  const [rows] = await pool.execute(
    `SELECT id, paymentReference, items FROM orders
     WHERE paymentStatus = 'pending'
       AND paymentReference IS NOT NULL
       AND paymentReference != ''
       AND created_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)`
  );

  if (rows.length === 0) return 0;

  let recovered = 0;
  for (const order of rows) {
    try {
      const { default: axios } = await import('axios');
      const resp = await axios.get(
        `https://api.paystack.co/transaction/verify/${order.paymentReference}`,
        { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
      );
      if (resp.data?.data?.status === 'success') {
        // Flip-guard: only run side effects if THIS call actually moved the
        // order from pending to paid, so a recovery racing with the webhook or
        // verify-paystack fallback can never double-hold escrow or
        // double-decrement stock.
        const [flipResult] = await pool.execute(
          `UPDATE orders SET paymentStatus = 'paid', orderStatus = 'processing', updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND paymentStatus = 'pending'`,
          [order.id]
        );
        if (flipResult.affectedRows === 0) continue;

        await holdEscrowForOrder(order.id);

        // This path acts like the webhook: decrement in-stock inventory now
        // that the order is confirmed paid (guarded so it runs once, and the
        // atomic conditional decrement prevents any oversell), so recovery
        // never leaks stock.
        try {
          const { decrementStockForOrder } = await import('../controllers/orderController.js');
          let items = order.items;
          if (typeof items === 'string') {
            try { items = JSON.parse(items); } catch { items = []; }
          }
          if (Array.isArray(items) && items.length > 0) {
            await decrementStockForOrder(items, order.id);
          }
        } catch (stockErr) {
          console.warn(`⚠️ Could not decrement stock for recovered order ${order.id}: ${stockErr.message}`);
        }

        console.log(`🔧 Recovered stuck order ${order.id} via Paystack verify`);
        recovered += 1;
      }
    } catch (err) {
      console.warn(`⚠️ Could not recover stuck order ${order.id}: ${err.message}`);
    }
  }
  return recovered;
};