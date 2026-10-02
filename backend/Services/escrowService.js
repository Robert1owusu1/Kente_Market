// @ts-check
// SERVICES/escrowService.js
// Multi-vendor escrow: funds are captured to the platform's Paystack balance and
// held until the customer confirms receipt (or the release deadline passes), then
// paid out to each vendor via Paystack Transfers minus the platform commission.
import pool from '../config/db.js';
import paystackServices from './paystackservices.js';
import { creditVendorBalance, clawbackVendorBalance } from './walletService.js';
import { recordFinancialEvent } from './ledgerService.js';
import { PLATFORM_FEE_RATE, ESCROW_RELEASE_DAYS } from '../config/businessConfig.js';
import { resolveCommissionRate } from './commissionService.js';
import Notification from '../models/notificationModel.js';
import Coupon from '../models/couponModel.js';
import { round2, calcEscrowFees } from '../../shared/pricing.js';
import crypto from 'crypto';

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
 * @param {{ advanceRatio?: number, discount?: number }} [options]
 * @returns {Promise<number>} number of allocations created
 */
export const createEscrowAllocations = async (orderId, items, { advanceRatio = 0, discount = 0 } = {}) => {
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
  /** @type {Array<{ id: number, vendorId: number | string, price: number | string, category?: string }>} */
  const productRows = products;
  const productMap = new Map(productRows.map((p) => [p.id, p]));

  // vendorId -> total amount owed to that vendor (gross, before discount)
  const vendorTotals = new Map();
  let grossSubtotal = 0;
  for (const it of items) {
    const pid = /** @type {any} */ (it?.product || it?.productId || it?.id);
    const product = productMap.get(pid);
    const vendorId = product?.vendorId || it?.vendorId || null;
    const qty = parseFloat(String(it?.quantity)) || 1;
    const price = parseFloat(String(it?.price ?? product?.price)) || 0;
    grossSubtotal += qty * price;
    if (!vendorId) continue; // platform-owned items skip escrow
    vendorTotals.set(vendorId, (vendorTotals.get(vendorId) || 0) + qty * price);
  }

  // Vendors must be paid on the DISCOUNTED amount the customer actually
  // spent, not the gross price — otherwise the platform (not the vendor)
  // funds every coupon, and a large vendor-issued discount drives each order
  // net-negative for the platform. Apportion the order-level discount across
  // all items pro rata (platform-owned items share it too), then allocate.
  const discountAmount = Math.max(0, parseFloat(String(discount)) || 0);
  const netFactor = grossSubtotal > 0 ? Math.max(0, 1 - discountAmount / grossSubtotal) : 1;
  if (netFactor < 1) {
    for (const [vendorId, gross] of vendorTotals) {
      vendorTotals.set(vendorId, round2(gross * netFactor));
    }
  }

  const ratio = Math.max(0, Math.min(1, parseFloat(String(advanceRatio)) || 0));

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
        const [insert] = await pool.execute(
          `INSERT IGNORE INTO escrow_allocations
             (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', 'advance')`,
          [orderId, vendorId, advanceAmount, feeRate, advanceFee, round2(advanceAmount - advanceFee)]
        );
        created += insert.affectedRows;
      }
      if (balanceAmount > 0) {
        const [insert] = await pool.execute(
          `INSERT IGNORE INTO escrow_allocations
             (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', 'balance')`,
          [orderId, vendorId, balanceAmount, feeRate, balanceFee, round2(balanceAmount - balanceFee)]
        );
        created += insert.affectedRows;
      }
      continue;
    }

    const { platformFee, payoutAmount } = calcEscrowFees(totalAmount, feeRate, PLATFORM_FEE_RATE);
    const [insert] = await pool.execute(
      `INSERT IGNORE INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [orderId, vendorId, round2(totalAmount), feeRate, platformFee, payoutAmount]
    );
    created += insert.affectedRows;
  }
  return created;
};

/**
 * Re-allocate a still-unpaid order's escrow after its discount changed
 * (P0-6: owner applies a coupon to the pre-created order). Only 'pending'
 * allocations are replaced — anything already held/released is money in
 * motion and must never be rewritten here. Safe to retry: delete + recreate
 * converges to the same rows.
 */
/**
 * @param {any} orderId
 * @param {any} items
 * @param {{ discount?: number }} [opts]
 */
export const reallocateOrderEscrow = async (orderId, items, { discount = 0 } = {}) => {
  await pool.execute(
    `DELETE FROM escrow_allocations WHERE orderId = ? AND status = 'pending'`,
    [parseInt(orderId, 10)]
  );
  return createEscrowAllocations(orderId, items, { discount });
};

/**
 * Consume one coupon use for a just-paid order (P0-5). When the usage cap was
 * reached between validation and payment (race loser), the order already
 * carries the discount and cannot be re-charged in-flow: journal a
 * `coupon.exhausted` event (idempotent per order+coupon) and notify admins for
 * manual reconcile instead of silently over-funding the coupon.
 */
/**
 * @param {any} couponId
 * @param {any} orderId
 * @returns {Promise<{ consumed: boolean, coupon: any }>}
 */
export const consumeCouponForOrder = async (couponId, orderId) => {
  if (!couponId) return { consumed: true, coupon: null };
  const { consumed, coupon } = await Coupon.incrementUses(couponId);
  if (!consumed) {
    try {
      await recordFinancialEvent({
        eventType: 'coupon.exhausted',
        direction: 'info',
        amount: 0,
        orderId,
        dedupeKey: `coupon.exhausted:${orderId}:${couponId}`,
        payload: { couponId, orderId },
      });
    } catch { /* journal is best-effort */ }
    try {
      const [admins] = await pool.execute(`SELECT id FROM users WHERE role = 'admin' LIMIT 5`);
      for (const admin of admins) {
        await Notification.create({
          userId: admin.id,
          type: 'system',
          title: 'Coupon over-redeemed at payment',
          message: `Order #${orderId} was paid with a coupon that hit its usage cap at payment time. The discount was honored; reconcile manually.`,
          link: `/admin/orders`,
        });
      }
    } catch { /* notify is best-effort */ }
  }
  return { consumed, coupon };
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

  const [transition] = await pool.execute(
    `UPDATE escrow_allocations
     SET status = 'available', platformFee = ?, payoutAmount = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'held'`,
    [platformFee, payoutAmount, allocation.id]
  );

  // A concurrent delivery confirmation may have released this allocation
  // first. Only the request that wins held -> available owns the wallet credit.
  if (transition.affectedRows !== 1) {
    updated.reason = 'already released by another worker';
    return updated;
  }

  // Credit the vendor's wallet balance (durable, shown on dashboard).
  const [orderRows] = await pool.execute(
    `SELECT orderNumber FROM orders WHERE id = ?`,
    [allocation.orderId]
  );
  const orderNumber = orderRows.length > 0 ? orderRows[0].orderNumber : null;
  try {
    await creditVendorBalance(allocation.vendorId, allocation.id, payoutAmount, orderNumber);
  } catch (error) {
    // Do not strand an allocation as available without a corresponding wallet
    // credit. Revert only our own transition so the scheduled release can
    // safely retry; a successful concurrent credit is protected by its ledger
    // unique key and will not be duplicated.
    await pool.execute(
      `UPDATE escrow_allocations SET status = 'held', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'available'`, [allocation.id]
    );
    throw error;
  }

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
  const reference = `kente_tr_${allocation.id}_${crypto.randomUUID().replace(/-/g, '')}`;

  // Claim the funds and persist the provider idempotency key *before* any
  // network call.  This is the critical boundary: concurrent requests cannot
  // both send the same money to Paystack.
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [claimed] = await connection.execute(
      `UPDATE escrow_allocations
       SET status = CASE WHEN ? THEN 'releasing' ELSE 'available' END,
           payoutAmount = payoutAmount - ?,
           payoutReference = CASE WHEN ? THEN ? ELSE payoutReference END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'available' AND payoutAmount >= ?`,
      [fullPayout, amount, fullPayout, reference, allocation.id, amount]
    );
    if (claimed.affectedRows !== 1) {
      await connection.rollback();
      updated.reason = 'allocation was already claimed by another withdrawal';
      return updated;
    }
    await connection.execute(
      `INSERT INTO payout_attempts (allocationId, vendorId, amount, reference, isFull, status)
       VALUES (?, ?, ?, ?, ?, 'processing')`,
      [allocation.id, allocation.vendorId, amount, reference, fullPayout]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  try {
    const result = await paystackServices.initiateTransfer(
      amount, allocation.recipientCode, `Escrow payout for order #${allocation.orderId}`, reference
    );
    const providerReference = result?.data?.data?.reference || result?.data?.reference || reference;
    if (!providerReference) throw new Error('Paystack transfer returned no reference');

    // Paystack normally returns the supplied reference. Keep the provider's
    // value if it differs so its webhook can still be reconciled.
    if (providerReference !== reference) {
      await pool.execute(`UPDATE payout_attempts SET providerReference = ? WHERE reference = ?`, [providerReference, reference]);
    }

    // Immutable audit event for the claim (dedupe by the globally unique
    // per-attempt reference). Best-effort — the outbox row is the real guard.
    try {
      await recordFinancialEvent({
        eventType: 'payout.claimed',
        direction: 'info',
        amount: amount,
        vendorId: allocation.vendorId,
        orderId: allocation.orderId,
        allocationId: allocation.id,
        reference,
        providerReference,
        dedupeKey: `payout.claimed:${reference}`,
        payload: { isFull: fullPayout },
      });
    } catch { /* journal is best-effort */ }

    if (fullPayout) {
      updated.status = 'releasing';
    } else {
      const remainingNet = Math.max(0, round2(available - amount));
      updated.payoutAmount = remainingNet;
      updated.status = 'available';
      updated.reason = `partial withdrawal of GHS ${round2(amount).toFixed(2)} (${round2(remainingNet).toFixed(2)} remaining)`;
    }
    updated.paid = true;
    updated.platformFee = allocation.platformFee;
    updated.payoutReference = providerReference;
  } catch (error) {
    // A timeout can mean Paystack accepted the transfer but its response was
    // lost. Never re-open these funds automatically; reconciliation can safely
    // retry/query the same provider reference without creating a duplicate.
    await pool.execute(
      `UPDATE payout_attempts SET lastError = ?, updated_at = CURRENT_TIMESTAMP WHERE reference = ? AND status = 'processing'`,
      [String(error.message || error).slice(0, 500), reference]
    );
 console.error(` Escrow payout failed for allocation ${allocation.id}:`, error.message);
    updated.status = fullPayout ? 'releasing' : 'available';
    updated.reason = `Transfer outcome pending reconciliation: ${error.message}`;
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
/**
 * Cancel escrow for an order: void any not-yet-released allocations and claw
 * back any funds that were already credited to a vendor wallet (returns/cancels
 * after an early advance release, or a full refund). This is what keeps the
 * "vendor paid after full refund" double-spend from happening.
 * @param {number | string} orderId
 * @returns {Promise<void>}
 */
export const cancelEscrowForOrder = async (orderId) => {
  await voidEscrowForOrder(orderId);
};

/**
 * Void escrow for an order when a return is approved / order cancelled (full
 * refund scenario).
 *  - pending/held allocations → failed (funds return to the platform balance)
 *  - available allocations   → clawed back from the vendor wallet (conditional
 *    debit, idempotent per allocation) then marked failed
 *  - releasing/released      → cannot be clawed back automatically; left as-is
 *    so the audit trail shows the vendor was already paid and manual recovery
 *    is required
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

  const available = await pool.execute(
    `SELECT id, vendorId, amount, platformFee, payoutAmount
     FROM escrow_allocations
     WHERE orderId = ? AND status = 'available'`,
    [orderId]
  );

  for (const allocation of available[0]) {
    const amount = round2(parseFloat(String(allocation.payoutAmount ?? 0)) || 0);
    if (amount <= 0) {
      await pool.execute(
        `UPDATE escrow_allocations
         SET status = 'failed', reason = 'voided (no payout)', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'available'`,
        [allocation.id]
      );
      continue;
    }

    // Atomic claim: only ONE worker may claw back this allocation. Guarded on
    // the remaining payoutAmount so a racing partial withdrawal can't be
    // double-clawed; we recover whatever is still theirs.
    const [claim] = await pool.execute(
      `UPDATE escrow_allocations
       SET status = 'failed', reason = 'clawed back (refunded)', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'available' AND payoutAmount >= ?`,
      [allocation.id, amount]
    );
    if (claim.affectedRows !== 1) continue;

    try {
      const debited = await clawbackVendorBalance(
        allocation.vendorId,
        amount,
        `clawback:${allocation.id}`,
        `Escrow clawed back for order ${orderId} (refund/return approved)`
      );
      if (!debited) {
 console.warn(` Clawback no-op for allocation ${allocation.id}: already withdrawn (check balance manually)`);
      }
      // Idempotent journal per allocation — only recorded when THIS worker won
      // the claim above, so a redelivery can't double record.
      await recordFinancialEvent({
        eventType: 'escrow.clawback',
        direction: 'out',
        amount,
        vendorId: allocation.vendorId,
        orderId,
        allocationId: allocation.id,
        reference: `escrow.clawback:${allocation.id}`,
        dedupeKey: `escrow.clawback:${allocation.id}`,
        payload: { reason: 'refund/return approved' },
      });
    } catch (error) {
      // Balance was insufficient (funds already withdrawn elsewhere): leave the
      // allocation marked failed + reason below so reconciliation can find it.
 console.error(` Clawback debit failed for allocation ${allocation.id}: ${error.message}`);
      await pool.execute(
        `UPDATE escrow_allocations SET reason = 'clawback failed: manual recovery needed' WHERE id = ?`,
        [allocation.id]
      );
    }
  }

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
    // 'failed' allocations come from cancel/void (pending|held -> failed).
    // releaseAllocation only transitions held -> available, so move the row
    // back to 'held' FIRST; a stale 'pending' would make the release no-op
    // and the retry would silently do nothing.
    await pool.execute(
      `UPDATE escrow_allocations
       SET status = 'held', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'failed'`,
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
 * Recover allocations that were transitioned held -> available but whose wallet
 * credit never committed (a hard crash between the two steps in
 * releaseAllocation). Purely idempotent: creditVendorBalance is gated by the
 * uq_wallet_credit_allocation unique key, so any allocation that was already
 * credited is skipped and never double-credited.
 * @returns {Promise<{ credited: number, errored: number }>}
 */
export const reconcileAvailableAllocations = async () => {
  const [rows] = await pool.execute(
    `SELECT ea.*, v.businessName, v.recipientCode
     FROM escrow_allocations ea
     JOIN vendors v ON v.userId = ea.vendorId
     WHERE ea.status = 'available'
     ORDER BY ea.id ASC
     LIMIT 200`
  );
  let credited = 0;
  let errored = 0;
  for (const allocation of rows) {
    try {
      const [orderRows] = await pool.execute(
        `SELECT orderNumber FROM orders WHERE id = ?`,
        [allocation.orderId]
      );
      const orderNumber = orderRows.length > 0 ? orderRows[0].orderNumber : null;
      const { payoutAmount } = calcEscrowFees(
        allocation.amount,
        allocation.platformFeeRate,
        PLATFORM_FEE_RATE
      );
      const applied = await creditVendorBalance(
        allocation.vendorId,
        allocation.id,
        payoutAmount,
        orderNumber
      );
      if (applied) credited += 1;
    } catch (error) {
      errored += 1;
 console.error(` reconcileAvailableAllocations: allocation ${allocation.id} errored: ${error.message}`);
    }
  }
 if (credited > 0) console.log(` reconcileAvailableAllocations credited ${credited} previously uncredited allocation(s)`);
  return { credited, errored };
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
 console.warn(` Could not track platform revenue for order ${orderId}: ${err.message}`);
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
 console.warn(` Could not notify vendor for allocation ${allocId}: ${err.message}`);
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
/**
 * Refund crash reconciler (P1). Detects orders stuck in "refund initiated but
 * still marked paid": refundReference persisted pre-call, paymentStatus never
 * flipped because the process crashed (or the flip failed) after the provider
 * accepted the refund.
 * - Refund journal EXISTS (money provably left): complete the bookkeeping —
 *   void held escrow (vendors must not also be paid), flip to refunded,
 *   journal + notify. Idempotent via the paid-guard on every write.
 * - No journal (attempt threw, outcome unknown): change NOTHING about money —
 *   alert admins to verify in the Paystack dashboard and resolve manually.
 * Never re-issues a refund here: a second provider call after an accepted-
 * but-unrecorded first one would double-refund the customer.
 */
export const reconcileRefundedButPaid = async () => {
  let journalTable = true;
  try {
    const [[t]] = await pool.execute(`SHOW TABLES LIKE 'financial_events'`);
    journalTable = !!t;
  } catch {
    journalTable = false;
  }
  const journalExpr = journalTable
    ? `EXISTS(SELECT 1 FROM financial_events fe WHERE fe.dedupeKey = CONCAT('refund:', o.id) OR fe.dedupeKey LIKE CONCAT('refund:', o.id, ':%'))`
    : `0`;
  const [rows] = await pool.execute(
    `SELECT o.id, o.paymentReference, o.escrowStatus, o.refundReference,
            (${journalExpr}) AS refundJournaled
     FROM orders o
     WHERE o.paymentStatus = 'paid' AND o.refundReference IS NOT NULL`
  );
  if (rows.length === 0) return 0;
  let recovered = 0;
  for (const row of rows) {
    try {
      if (Number(row.refundJournaled) === 1) {
        await cancelEscrowForOrder(row.id);
        const [flip] = await pool.execute(
          `UPDATE orders SET paymentStatus = 'refunded', updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND paymentStatus = 'paid'`,
          [row.id]
        );
        if (flip.affectedRows > 0) {
          try {
            await recordFinancialEvent({
              eventType: 'refund.reconciled',
              direction: 'info',
              amount: 0,
              orderId: row.id,
              dedupeKey: `refund.reconciled:${row.id}`,
              payload: { refundReference: row.refundReference },
            });
          } catch { /* journal is best-effort */ }
          recovered += 1;
        }
        try {
          const [admins] = await pool.execute(`SELECT id FROM users WHERE role = 'admin' LIMIT 5`);
          for (const admin of admins) {
            await Notification.create({
              userId: admin.id,
              type: 'system',
              title: 'Refund crash recovered',
              message: `Order #${row.id} was refunded via Paystack but crashed before the books flipped. Escrow voided and order marked refunded — no action needed.`,
              link: `/admin/orders`,
            });
          }
        } catch { /* notify is best-effort */ }
      } else {
        try {
          const [admins] = await pool.execute(`SELECT id FROM users WHERE role = 'admin' LIMIT 5`);
          for (const admin of admins) {
            await Notification.create({
              userId: admin.id,
              type: 'system',
              title: 'Refund outcome unknown — verify in Paystack',
              message: `Order #${row.id} has a refund marker (${row.refundReference || 'set'}) but is still paid with no refund journal. Check the Paystack dashboard: if refunded, flip + void manually; if not, clear refundReference and retry. Do NOT blindly re-refund.`,
              link: `/admin/orders`,
            });
          }
        } catch { /* notify is best-effort */ }
        recovered += 1;
      }
    } catch (err) {
 console.warn(` Could not reconcile refund for order ${row.id}: ${err.message}`);
    }
  }
  return recovered;
};

export const recoverStuckPendingOrders = async () => {
  const [rows] = await pool.execute(
    `SELECT id, paymentReference, items, totalAmount FROM orders
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
      const tx = resp.data?.data;
      if (tx?.status === 'success') {
        // CRITICAL: this job must validate the charge exactly like the webhook
        // and verify-paystack fallback do — full order amount, in GHS. Without
        // these checks a 1 GHS charge's reference pasted onto a 5,000 GHS
        // order would be fulfilled here ~1h later even though both guarded
        // paths correctly rejected it.
        const expectedKobo = Math.round(parseFloat(order.totalAmount) * 100);
        const paidKobo = parseInt(tx.amount, 10);
        if (
          tx.currency !== 'GHS' ||
          !Number.isFinite(paidKobo) ||
          paidKobo !== expectedKobo
        ) {
          console.warn(
` Stuck order ${order.id}: payment mismatch — paid ${paidKobo} ${tx.currency}, ` +
            `expected ${expectedKobo} GHS (ref ${order.paymentReference}); NOT recovering`
          );
          continue;
        }
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

        // P0-6: consume the coupon like every other paid path (previously
        // skipped here, so recovered orders never burned a use).
        try {
          const [[couponRow]] = await pool.execute(
            `SELECT couponId FROM orders WHERE id = ?`,
            [order.id]
          );
          if (couponRow?.couponId) {
            await consumeCouponForOrder(couponRow.couponId, order.id);
          }
        } catch (couponErr) {
 console.warn(` Could not consume coupon for recovered order ${order.id}: ${couponErr.message}`);
        }

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
 console.warn(` Could not decrement stock for recovered order ${order.id}: ${stockErr.message}`);
        }

 console.log(` Recovered stuck order ${order.id} via Paystack verify`);
        recovered += 1;
      }
    } catch (err) {
 console.warn(` Could not recover stuck order ${order.id}: ${err.message}`);
    }
  }
  return recovered;
};
