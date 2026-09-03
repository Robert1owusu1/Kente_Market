// SERVICES/escrowService.js
// Multi-vendor escrow: funds are captured to the platform's Paystack balance and
// held until the customer confirms receipt (or the release deadline passes), then
// paid out to each vendor via Paystack Transfers minus the platform commission.
import pool from '../config/db.js';
import paystackServices from './paystackservices.js';
import { PLATFORM_FEE_RATE, ESCROW_RELEASE_DAYS } from '../config/businessConfig.js';

// Round to 2 decimals (GHS)
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

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
 * Recompute the order-level escrowStatus from its allocations.
 * released when ALL are released; failed when any failed (none releasing/held);
 * releasing while transfers are in flight; otherwise held.
 */
export const recomputeOrderEscrowStatus = async (orderId) => {
  const rows = await getOrderAllocations(orderId);
  if (rows.length === 0) return 'none';

  const statuses = new Set(rows.map((r) => r.status));
  if (statuses.has('releasing') || statuses.has('pending')) return 'releasing';
  if (statuses.has('failed')) return 'failed';
  if (statuses.size === 1 && statuses.has('released')) return 'released';
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
    const [feeRows] = await pool.execute(
      `SELECT platformFeeRate FROM vendors WHERE userId = ?`,
      [vendorId]
    );
    const feeRate = feeRows.length > 0 ? parseFloat(feeRows[0].platformFeeRate) || PLATFORM_FEE_RATE : PLATFORM_FEE_RATE;
    await pool.execute(
      `INSERT IGNORE INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [orderId, vendorId, round2(amount), feeRate]
    );
    created += 1;
  }
  return created;
};

/**
 * Release a single held allocation to its vendor via a Paystack transfer.
 * Returns the allocation row with the new status stamped on it.
 */
export const releaseAllocation = async (allocation) => {
  const updated = { ...allocation };

  if (allocation.status !== 'held') {
    updated.reason = 'not held';
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

  const platformFee = round2(allocation.amount * (parseFloat(allocation.platformFeeRate) || PLATFORM_FEE_RATE));
  const payoutAmount = round2(allocation.amount - platformFee);

  try {
    const result = await paystackServices.initiateTransfer(
      payoutAmount,
      allocation.recipientCode,
      `Escrow release for order #${allocation.orderId}`
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

  let releasing = 0;
  let failed = 0;

  for (const allocation of allocations) {
    if (allocation.status === 'held') {
      const updated = await releaseAllocation(allocation);
      if (updated.status === 'releasing') releasing += 1;
      else if (updated.status === 'failed') failed += 1;
    }
  }

  const escrowStatus = await recomputeOrderEscrowStatus(orderId);
  await pool.execute(
    `UPDATE orders SET escrowStatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [escrowStatus, orderId]
  );

  return { released: releasing, failed };
};

/**
 * Place an order's allocations into escrow ("held") once payment succeeds.
 */
export const holdEscrowForOrder = async (orderId) => {
  await pool.execute(
    `UPDATE escrow_allocations
     SET status = 'held', updated_at = CURRENT_TIMESTAMP
     WHERE orderId = ? AND status = 'pending'`,
    [orderId]
  );
  await pool.execute(
    `UPDATE orders SET escrowStatus = 'held', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND escrowStatus = 'none'`,
    [orderId]
  );
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

export { ESCROW_RELEASE_DAYS };