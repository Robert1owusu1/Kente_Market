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
 * Load escrow allocations for an order (joined with vendor payout info).
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
 *   2. all released    -> released
 *   3. any pending     -> releasing (not yet held/finalized)
 *   4. any releasing   -> releasing (transfers in flight)
 *   5. any held        -> held (still awaiting release)
 *   6. else any failed -> failed (nothing held/in-flight/pending)
 */
export const recomputeOrderEscrowStatus = async (orderId) => {
  const rows = await getOrderAllocations(orderId);
  if (rows.length === 0) return 'none';

  const statuses = new Set(rows.map((r) => r.status));

  if (statuses.size === 1 && statuses.has('released')) return 'released';
  if (statuses.has('pending')) return 'releasing';
  if (statuses.has('releasing')) return 'releasing';
  if (statuses.has('held')) return 'held';
  if (statuses.has('available')) return 'available';
  if (statuses.has('failed')) return 'failed';
  return 'held';
};

/**
 * Create per-vendor escrow allocations from order items at order placement.
 * Items with a vendor-owned product produce an allocation keyed by vendorId.
 */
export const createEscrowAllocations = async (orderId, items) => {
  if (!Array.isArray(items) || items.length === 0) return 0;

  const productIds = items
    .map((it) => it?.product || it?.productId || it?.id)
    .filter((id) => id !== undefined && id !== null);

  if (productIds.length === 0) return 0;

  const placeholders = productIds.map(() => '?').join(', ');
  const [products] = await pool.execute(
    `SELECT id, vendorId, price FROM product WHERE id IN (${placeholders})`,
    productIds
  );
  const productMap = new Map(products.map((p) => [p.id, p]));

  // vendorId -> total amount owed to that vendor
  const vendorTotals = new Map();
  for (const it of items) {
    const pid = it?.product || it?.productId || it?.id;
    const product = productMap.get(pid);
    const vendorId = product?.vendorId || it?.vendorId || null;
    if (!vendorId) continue; // platform-owned items skip escrow
    const qty = parseFloat(it?.quantity) || 1;
    const price = parseFloat(it?.price ?? product?.price) || 0;
    vendorTotals.set(vendorId, (vendorTotals.get(vendorId) || 0) + qty * price);
  }

  let created = 0;
  for (const [vendorId, amount] of vendorTotals) {
    // Resolve the effective commission via the commission engine:
    // product > vendor > category > global, then vendor override, then default.
    const productForVendor = [...products].find((p) => p.vendorId === vendorId);
    const feeRate = await resolveCommissionRate({
      productId: productForVendor?.id,
      vendorId,
      category: productForVendor?.category,
    });
    const { platformFee, payoutAmount } = calcEscrowFees(amount, feeRate, PLATFORM_FEE_RATE);
    await pool.execute(
      `INSERT IGNORE INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [orderId, vendorId, round2(amount), feeRate, platformFee, payoutAmount]
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
 * Actually pay out an allocation to the vendor's Paystack recipient (MoMo/bank).
 * Called by the vendor's Withdraw action. Moves available -> releasing -> released
 * or failed depending on the transfer result.
 */
export const payoutAllocation = async (allocation) => {
  const updated = { ...allocation };

  if (allocation.status !== 'available') {
    updated.reason = `not available (status='${allocation.status}')`;
    return updated;
  }

  if (!allocation.recipientCode) {
    await pool.execute(
      `UPDATE escrow_allocations
       SET status = 'failed', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [allocation.id]
    );
    updated.status = 'failed';
    updated.reason = 'vendor has no payout recipient';
    return updated;
  }

  const { platformFee, payoutAmount } = calcEscrowFees(
    allocation.amount,
    allocation.platformFeeRate,
    PLATFORM_FEE_RATE
  );

  try {
    const result = await paystackServices.initiateTransfer(
      payoutAmount,
      allocation.recipientCode,
      `Escrow payout for order #${allocation.orderId}`
    );
    const reference = result?.data?.data?.reference || result?.data?.reference || null;
    if (!reference) {
      throw new Error('Paystack transfer returned no reference');
    }

    await pool.execute(
      `UPDATE escrow_allocations
       SET status = 'releasing', payoutReference = ?, platformFee = ?,
           payoutAmount = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [reference, platformFee, payoutAmount, allocation.id]
    );
    updated.status = 'releasing';
    updated.payoutReference = reference;
    updated.platformFee = platformFee;
    updated.payoutAmount = payoutAmount;
    updated.reason = 'transfer initiated';
  } catch (error) {
    console.error(`❌ Escrow payout failed for allocation ${allocation.id}:`, error.message);
    await pool.execute(
      `UPDATE escrow_allocations
       SET status = 'failed', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [allocation.id]
    );
    updated.status = 'failed';
    updated.reason = error.message;
  }
  return updated;
};

/**
 * Release ALL escrow for an order that has been delivered and confirmed
 * (or auto-released after the deadline). Idempotent per allocation.
 */
export const releaseEscrowForOrder = async (orderId) => {
  const allocations = await getOrderAllocations(orderId);
  if (allocations.length === 0) return { released: 0, failed: 0 };

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
 */
export const trackPlatformRevenue = async (orderId, items) => {
  if (!Array.isArray(items) || items.length === 0) return;

  const platformItems = items.filter((it) => !it.vendorId);
  if (platformItems.length === 0) return;

  const total = platformItems.reduce(
    (sum, it) => sum + (parseFloat(it.price) || 0) * (parseInt(it.qty) || 1),
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
    `SELECT id, paymentReference FROM orders
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
        await pool.execute(
          `UPDATE orders SET paymentStatus = 'paid', orderStatus = 'processing', updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND paymentStatus = 'pending'`,
          [order.id]
        );
        await holdEscrowForOrder(order.id);
        console.log(`🔧 Recovered stuck order ${order.id} via Paystack verify`);
        recovered += 1;
      }
    } catch (err) {
      console.warn(`⚠️ Could not recover stuck order ${order.id}: ${err.message}`);
    }
  }
  return recovered;
};