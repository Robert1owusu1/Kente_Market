// @ts-check
// SERVICES/escrowService.js
// Multi-vendor escrow: funds are captured to the platform's Paystack balance and
// held until the customer confirms receipt (or the release deadline passes), then
// paid out to each vendor via Paystack Transfers minus the platform commission.
import pool from '../config/db.js';
import paystackServices, { PAYSTACK_TIMEOUT_MS } from './paystackservices.js';
import { creditVendorBalance, clawbackVendorBalance } from './walletService.js';
import { recordCheckAndAlert, dueJoin } from '../utils/reconciliationChecks.js';
import { recordFinancialEvent } from './ledgerService.js';
import { reconcileTerminalOrderCharge } from './paymentReconciliationService.js';
import { ESCROW_RELEASE_DAYS } from '../config/businessConfig.js';
import { CHARGED_CURRENCY } from './paymentCurrency.js';
import { buildEscrowAllocationRows, allocationFees, readCommissionSnapshot } from './commissionService.js';
import { recordReferralForOrder, recordPaymentInstrument, adjustReferralForRefund } from './referralService.js';
import Notification from '../models/notificationModel.js';
import Coupon from '../models/couponModel.js';
import { round2 } from '../../shared/pricing.js';
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
 * @property {boolean} [pending] withdrawal reserved but provider outcome unknown (timeout) — still reserved
 */

/**
 * @typedef {Object} OrderLine
 * @property {number} [product] legacy product field (product id)
 * @property {number} [productId] product id
 * @property {number} [id] product id fallback
 * @property {number | string | null} [vendorId] owning vendor user id (absent/null = platform-owned)
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
 * F-2/F-3 central money-out invariant: an order is releasable only when it
 * exists, is not cancelled, and its payment was actually collected (and not
 * refunded). Every release path (manual confirm, auto-release, retry) must
 * pass through this check against authoritative DB state — never trust a
 * previous controller's validation, and never release on allocation status
 * alone.
 * @param {number | string} orderId
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export const assertOrderReleasable = async (orderId) => {
  const [[order]] = await pool.execute(
    `SELECT id, orderStatus, paymentStatus FROM orders WHERE id = ?`,
    [orderId]
  );
  if (!order) return { ok: false, reason: 'order not found' };
  if (order.orderStatus === 'cancelled') return { ok: false, reason: 'order cancelled' };
  if (order.paymentStatus === 'refunded') return { ok: false, reason: 'order refunded' };
  if (order.paymentStatus !== 'paid') {
    return { ok: false, reason: `payment not collected (paymentStatus='${order.paymentStatus}')` };
  }
  return { ok: true };
};

/**
 * F-2 central money-out invariant for withdrawals: an order must not pay out
 * once it is cancelled or refunded. Enforced inside the atomic claim (not
 * just in the controller) so a cancellation racing a withdrawal cannot lose.
 * @param {number | string} allocationId
 * @returns {Promise<boolean>} true when the order is NOT cancelled/refunded
 */
export const assertOrderWithdrawable = async (allocationId) => {
  const [[row]] = await pool.execute(
    `SELECT o.orderStatus, o.paymentStatus
      FROM escrow_allocations ea
      JOIN orders o ON o.id = ea.orderId
     WHERE ea.id = ?`,
    [allocationId]
  );
  if (!row) return false;
  if (row.orderStatus === 'cancelled' || row.paymentStatus === 'refunded') return false;
  return true;
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
       AND NOT EXISTS (
         SELECT 1 FROM orders o
          WHERE o.id = ea.orderId
            AND (o.orderStatus = 'cancelled' OR o.paymentStatus = 'refunded')
       )
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
  // Commission is resolved PER LINE (product > vendor > category > global,
  // then vendor rate, then default) on the seller's list price and frozen on
  // the row (REFERRAL_SYSTEM_DESIGN.md §3).
  // Who funds the discount (R6): an admin coupon (coupons.vendorId NULL) comes
  // out of the platform commission; a seller coupon out of that seller's share.
  const [[couponRow]] = await pool.execute(
    `SELECT c.vendorId AS couponVendorId FROM orders o LEFT JOIN coupons c ON c.id = o.couponId WHERE o.id = ?`,
    [orderId]
  );
  const couponVendorId = couponRow?.couponVendorId ?? null;
  const { rows, snapshot } = await buildEscrowAllocationRows(pool, items, { advanceRatio, discount, couponVendorId });
  // Frozen per-line record (P, r, F, Da, Ds) for revenue, partial refunds and referrals.
  await pool.execute(`UPDATE orders SET commissionSnapshot = ? WHERE id = ?`, [JSON.stringify(snapshot), orderId]);
  let created = 0;
  for (const r of rows) {
    const [insert] = await pool.execute(
      `INSERT IGNORE INTO escrow_allocations
         (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [orderId, r.vendorId, r.amount, r.platformFeeRate, r.platformFee, r.payoutAmount, r.allocationType]
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
 * Journal + notify when a coupon use could not be taken at settlement time.
 * Dedupe key is per order+coupon, so webhook/verify retries never duplicate it.
 * @param {any} couponId
 * @param {any} orderId
 * @param {any} coupon
 */
const reportCouponExhausted = async (couponId, orderId, coupon) => {
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
    const [admins] = await pool.execute(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 5`);
    for (const admin of admins) {
      await Notification.create({
        userId: admin.id,
        type: 'system',
        title: 'Coupon over-redeemed at payment',
        message: `Order #${orderId} was paid with a coupon that hit its usage cap. The discount was honored; reconcile manually.`,
        link: `/admin/orders`,
      });
    }
  } catch { /* notify is best-effort */ }
  return { consumed: false, coupon };
};

/**
 * Settle the coupon slot for a just-paid order — N-7 / V-04.
 *
 * The slot itself is taken when the coupon is booked onto the order
 * (Coupon.reserveUse, one atomic conditional UPDATE against maxUses), so this
 * function's job is to record that the slot now belongs to the order
 * permanently, and to do so EXACTLY ONCE no matter how many times the payment
 * callback, verification, webhook and reconciliation paths call it.
 *
 * orders.couponUseState: 0 = none, 1 = reserved (unpaid), 2 = settled.
 *
 *  - state 1 -> 2 : reserved at booking; no counter change, retries are no-ops.
 *  - state 2      : already settled; return immediately (the idempotency path).
 *  - state 0      : order predates reserve-at-booking (or its state write was
 *                   lost). Take the slot in ONE transaction together with the
 *                   0 -> 2 claim, so neither a retry nor a concurrent webhook
 *                   can take a second slot, and the order can never be marked
 *                   settled while holding no slot.
 *  - no such row  : defensive fallback to the plain atomic increment.
 *
 * When the cap is already spent the discount is reported (coupon.exhausted +
 * admin notification) instead of silently ignored — and never funded twice.
 *
 * @param {any} couponId
 * @param {any} orderId
 * @returns {Promise<{ consumed: boolean, coupon: any }>}
 */
export const consumeCouponForOrder = async (couponId, orderId) => {
  if (!couponId) return { consumed: true, coupon: null };

  let coupon = null;
  try {
    coupon = await Coupon.findById(couponId);
  } catch { /* coupon row may be gone; reporting still works */ }

  const state = await Coupon.getOrderCouponState(orderId, couponId);

  if (state === 1) {
    // Reserved at booking: flip to settled. A losing transition just means a
    // concurrent path already did it — the slot is held either way, exactly once.
    try {
      await Coupon.transitionOrderCoupon(orderId, couponId, 1, 2);
    } catch (err) {
      console.warn(` Could not mark coupon slot settled for order ${orderId}: ${err.message}`);
    }
    return { consumed: true, coupon };
  }

  if (state === 2) {
    // Payment callback retried / webhook replay / verification after webhook:
    // the slot was already taken. Never take another one.
    return { consumed: true, coupon };
  }

  if (state === 0) {
    try {
      const outcome = await Coupon.consumeForOrderOnce(orderId, couponId);
      if (outcome.consumed) {
        return { consumed: true, coupon: coupon ?? (await Coupon.findById(couponId)) };
      }
      if (!outcome.exhausted) {
        // Lost the claim to a concurrent path for this same order — check whether
        // it succeeded rather than taking a slot ourselves.
        const again = await Coupon.getOrderCouponState(orderId, couponId);
        if (again === 1 || again === 2) {
          if (again === 1) await Coupon.transitionOrderCoupon(orderId, couponId, 1, 2);
          return { consumed: true, coupon };
        }
      }
      return await reportCouponExhausted(couponId, orderId, coupon);
    } catch (err) {
      console.error(`Failed to settle coupon for order ${orderId}: ${err.message}`);
      throw err;
    }
  }

  // No order row carries this coupon (orderId missing / mismatched): keep the
  // historical behaviour — one atomic, cap-respecting increment.
  const { consumed, coupon: fresh } = await Coupon.incrementUses(couponId);
  if (!consumed) {
    return await reportCouponExhausted(couponId, orderId, coupon ?? fresh);
  }
  return { consumed: true, coupon: fresh };
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

  // F-3: never release for a cancelled/refunded/unpaid order, even if the
  // allocation itself is still 'held' (e.g. cancel raced the release job).
  // Checked here — not trusted from any caller — against live DB state.
  const releasable = await assertOrderReleasable(allocation.orderId);
  if (!releasable.ok) {
    updated.reason = `order not releasable: ${releasable.reason}`;
    return updated;
  }

  // Commission frozen on the row at order time (later rule edits never
  // rewrite it); recomputed from the stored rate only for rows with no fee.
  const { platformFee, payoutAmount } = allocationFees(allocation);

  // F-2/F-3/E: transition + wallet credit commit atomically on ONE
  // connection with the allocation row locked first. A concurrent
  // void/withdraw/release claim serializes on the row lock: it either runs
  // fully before us (we then see a non-held row and refuse) or fully after
  // us (it then sees the credit row and claws back). The split-brain the
  // old code allowed — void claiming between our transition and our credit,
  // debiting the vendor for funds never credited — is structurally closed.
  const [[orderRows]] = await pool.execute(
    `SELECT orderNumber FROM orders WHERE id = ?`,
    [allocation.orderId]
  );
  const orderNumber = orderRows.length > 0 ? orderRows[0].orderNumber : null;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[locked]] = await connection.execute(
      `SELECT status FROM escrow_allocations WHERE id = ? FOR UPDATE`,
      [allocation.id]
    );
    if (!locked || locked.status !== 'held') {
      await connection.rollback();
      updated.reason = 'not held';
      return updated;
    }
    // Re-check order eligibility atomically inside the claim so a
    // cancellation landing between the pre-check and this UPDATE still wins.
    // Exactly one of (release, void) can own a held allocation.
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
    if (transition.affectedRows !== 1) {
      await connection.rollback();
      updated.reason = 'order not releasable: changed during release';
      return updated;
    }

    // Wallet credit in the same transaction (same statements + idempotency
    // key as creditVendorBalance, so behavior is unchanged).
    const amount = round2(parseFloat(String(payoutAmount)) || 0);
    if (amount <= 0) throw new Error('Escrow credit amount must be positive');
    await connection.execute(`INSERT IGNORE INTO vendor_wallets (vendorId) VALUES (?)`, [allocation.vendorId]);
    const [ledger] = await connection.execute(
      `INSERT IGNORE INTO wallet_transactions (vendorId, type, amount, allocationId, note, status)
       VALUES (?, 'credit', ?, ?, ?, 'succeeded')`,
      [allocation.vendorId, amount, allocation.id, `Escrow release for order ${orderNumber || ''}`.trim()]
    );
    if (ledger.affectedRows !== 1) {
      await connection.rollback();
      updated.reason = 'already credited by another worker';
      return updated;
    }
    await connection.execute(
      `UPDATE vendor_wallets
       SET available_balance = available_balance + ?, total_earned = total_earned + ?,
           updated_at = CURRENT_TIMESTAMP WHERE vendorId = ?`,
      [amount, amount, allocation.vendorId]
    );
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
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    // If the order has become ineligible while we failed, park the row as
    // failed (funds never moved — nothing to claw back) instead of
    // stranding it 'held' where no future release may touch it.
    try {
      const re = await assertOrderReleasable(allocation.orderId);
      if (!re.ok) {
        await pool.execute(
          `UPDATE escrow_allocations
           SET status = 'failed', reason = 'voided (order ineligible; release failed)',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'held'`,
          [allocation.id]
        );
        updated.reason = `release failed and order ineligible (${re.reason})`;
        return updated;
      }
    } catch { /* parking is best-effort */ }
    throw error;
  } finally {
    connection.release();
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
export const payoutAllocation = async (allocation, requestedAmount, { withdrawalId = null } = {}) => {
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

  const requestedNum = parseFloat(String(requestedAmount));
  const wanted = Number.isFinite(requestedNum) && requestedNum > 0
    ? round2(requestedNum)
    : round2(parseFloat(String(allocation.payoutAmount ?? 0)) || 0);
  if (wanted <= 0) {
    updated.reason = 'invalid withdrawal amount';
    return updated;
  }
  const reference = `kente_tr_${allocation.id}_${crypto.randomUUID().replace(/-/g, '')}`;

  // Reserve the funds and persist the provider idempotency key BEFORE any
  // network call (PAYOUT_LIFECYCLE_DESIGN.md §4.1). The allocation row lock
  // is the one lock every writer of this allocation's money takes first
  // (claims, settlements, clawbacks), so "full" is decided from the LOCKED
  // remainder — never from the caller's possibly stale read — and two
  // concurrent claims can never reserve the same money.
  let amount;
  let fullPayout;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[locked]] = await connection.execute(
      `SELECT id, orderId, status, payoutAmount FROM escrow_allocations WHERE id = ? FOR UPDATE`,
      [allocation.id]
    );
    const [[order]] = locked
      ? await connection.execute(`SELECT orderStatus, paymentStatus FROM orders WHERE id = ?`, [locked.orderId])
      : [[null]];
    const remainder = locked ? round2(parseFloat(String(locked.payoutAmount ?? 0)) || 0) : 0;
    // F-2: a cancellation/refund that landed after the controller's read wins.
    const orderBlocked = !order || order.orderStatus === 'cancelled' || order.paymentStatus === 'refunded';
    if (!locked || locked.status !== 'available' || orderBlocked || remainder < wanted || remainder <= 0) {
      await connection.rollback();
      updated.reason = 'allocation was already claimed by another withdrawal';
      return updated;
    }
    amount = wanted;
    fullPayout = round2(remainder - amount) < 0.01;
    await connection.execute(
      `UPDATE escrow_allocations
          SET status = ?, payoutAmount = payoutAmount - ?,
              payoutReference = CASE WHEN ? THEN ? ELSE payoutReference END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [fullPayout ? 'releasing' : 'available', amount, fullPayout, reference, allocation.id]
    );
    await connection.execute(
      `INSERT INTO payout_attempts (allocationId, vendorId, amount, amountMinor, currency, withdrawalId, reference, isFull, status)
       VALUES (?, ?, ?, ?, 'GHS', ?, ?, ?, 'processing')`,
      [allocation.id, allocation.vendorId, amount, Math.round(amount * 100), withdrawalId, reference, fullPayout]
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
    const ackStatus = String(result?.data?.status || result?.data?.data?.status || '').toLowerCase() || null;

    // The provider acknowledged this exact reference: record it. A later
    // "transfer not found" from verify is then contradictory evidence and is
    // escalated instead of releasing the funds (design §5).
    await pool.execute(
      `UPDATE payout_attempts
          SET initiatedAt = CURRENT_TIMESTAMP, providerStatus = ?,
              providerReference = CASE WHEN ? <> reference THEN ? ELSE providerReference END
        WHERE reference = ?`,
      [ackStatus, providerReference, providerReference, reference]
    );
    if (ackStatus === 'otp') {
      // Paystack is waiting for an OTP to finalise this transfer: it will not
      // complete on its own. The funds stay reserved; an operator must act.
      const { alertPayoutAttempt } = await import('./transferSettlementService.js');
      const [[row]] = await pool.execute(`SELECT * FROM payout_attempts WHERE reference = ?`, [reference]);
      if (row) await alertPayoutAttempt(row, 'provider_otp', 'Paystack requires an OTP to finalise this transfer (disable transfer OTP or finalise it in the dashboard)');
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
        payload: { isFull: fullPayout, withdrawalId },
      });
    } catch { /* journal is best-effort */ }

    if (fullPayout) {
      updated.status = 'releasing';
      updated.payoutAmount = 0;
    } else {
      const remainingNet = Math.max(0, round2(parseFloat(String(allocation.payoutAmount ?? 0)) - amount));
      updated.payoutAmount = remainingNet;
      updated.status = 'available';
      updated.reason = `partial withdrawal of GHS ${round2(amount).toFixed(2)}`;
    }
    updated.paid = true;
    updated.amount = amount;
    updated.platformFee = allocation.platformFee;
    updated.payoutReference = providerReference;
  } catch (error) {
    // A timeout can mean Paystack accepted the transfer but its response was
    // lost, so the reservation is NEVER released here. Only provider evidence
    // (webhook or verify, design §5) can return these funds; reconciliation
    // verifies this same reference and never re-sends it.
    await pool.execute(
      `UPDATE payout_attempts SET lastError = ?, initiateHttpStatus = ?, updated_at = CURRENT_TIMESTAMP
        WHERE reference = ? AND status = 'processing'`,
      [String(error.message || error).slice(0, 500),
       Number.isInteger(error?.providerStatus) ? error.providerStatus : null, reference]
    );
    console.error(` Escrow payout failed for allocation ${allocation.id}:`, error.message);
    updated.status = fullPayout ? 'releasing' : 'available';
    updated.pending = true;
    updated.amount = amount;
    updated.reason = `Transfer outcome pending reconciliation: ${error.message}`;
  }
  return updated;
};

/**
 * Release ALL escrow for an order that has been delivered and confirmed
 * (or auto-released after the deadline). Idempotent per allocation.
 * @param {number | string} orderId
 * @returns {Promise<{ released: number, available: number, failed: number, skipped?: string }>}
 */
export const releaseEscrowForOrder = async (orderId) => {
  // F-3: authoritative order gate — releaseEscrowForOrder is called from
  // customer confirm, admin, webhook-adjacent and scheduler paths; none of
  // them may release a cancelled/refunded/unpaid order.
  const releasable = await assertOrderReleasable(orderId);
  if (!releasable.ok) {
    return { released: 0, available: 0, failed: 0, skipped: `order not releasable: ${releasable.reason}` };
  }
  const allocations = await getOrderAllocations(orderId);
  if (allocations.length === 0) return { released: 0, available: 0, failed: 0 };

  let available = 0;
  let failed = 0;

  for (const allocation of allocations) {
    if (allocation.status === 'held') {
      // F: one bad/stale row must not abort the whole order pass.
      try {
        const updated = await releaseAllocation(allocation);
        if (updated.status === 'available') available += 1;
        else if (updated.status === 'failed') failed += 1;
      } catch (error) {
        console.error(` Release failed for allocation ${allocation.id}: ${error.message}`);
        failed += 1;
      }
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
 * Release escrow for a SPECIFIC VENDOR in an order (P0-2).
 * Called when that vendor's fulfillment is marked delivered and customer confirms
 * (or auto-release deadline passes for that vendor).
 * Does NOT affect other vendors' allocations in the same order.
 * @param {number | string} orderId
 * @param {number | string} vendorId
 * @returns {Promise<{ released: number, available: number, failed: number, skipped?: string }>}
 */
export const releaseVendorEscrow = async (orderId, vendorId) => {
  // F-3: same authoritative gate as the whole-order path (auto-release calls
  // here directly per vendor).
  const releasable = await assertOrderReleasable(orderId);
  if (!releasable.ok) {
    return { released: 0, available: 0, failed: 0, skipped: `order not releasable: ${releasable.reason}` };
  }
  const allocations = await getOrderAllocations(orderId);
  const vendorAllocs = allocations.filter(a => a.vendorId == vendorId);
  if (vendorAllocs.length === 0) return { released: 0, available: 0, failed: 0 };

  let available = 0;
  let failed = 0;

  for (const allocation of vendorAllocs) {
    if (allocation.status === 'held') {
      // F: one bad/stale row must not abort the vendor pass.
      try {
        const updated = await releaseAllocation(allocation);
        if (updated.status === 'available') available += 1;
        else if (updated.status === 'failed') failed += 1;
      } catch (error) {
        console.error(` Release failed for allocation ${allocation.id}: ${error.message}`);
        failed += 1;
      }
    }
  }

  // Update vendor_order_fulfillment status to delivered
  await pool.execute(
    `UPDATE vendor_order_fulfillment 
     SET status = 'delivered', deliveredAt = NOW(), updated_at = CURRENT_TIMESTAMP
     WHERE orderId = ? AND vendorId = ?`,
    [orderId, vendorId]
  );

  // Recompute order-level escrow status (may still be held if other vendors pending)
  const escrowStatus = await recomputeOrderEscrowStatus(orderId);
  await pool.execute(
    `UPDATE orders SET escrowStatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [escrowStatus, orderId]
  );

  return { released: available, available, failed };
};

/**
 * Auto-release vendor escrow when their fulfillment deadline passes.
 * Called by cleanup scheduler.
 */
export const autoReleaseExpiredVendorEscrows = async () => {
  // F-3: candidate pre-filter on authoritative order state (service-level
  // assertOrderReleasable inside releaseVendorEscrow remains the real guard).
  const [rows] = await pool.execute(
    `SELECT vof.orderId, vof.vendorId
     FROM vendor_order_fulfillment vof
     JOIN orders o ON o.id = vof.orderId
     WHERE vof.status IN ('delivered','shipped')
       AND vof.deliveredAt IS NOT NULL
       AND vof.escrowReleaseDeadline IS NOT NULL
       AND vof.escrowReleaseDeadline < NOW()
       AND o.orderStatus NOT IN ('cancelled', 'refunded')
       AND o.paymentStatus = 'paid'`
  );

  for (const row of rows) {
    const result = await releaseVendorEscrow(row.orderId, row.vendorId);
    console.log(
      `⏰ Auto-released expired vendor escrow for order ${row.orderId}, vendor ${row.vendorId} (` +
        `${result.released} released, ${result.failed} failed)`
    );
  }
  if (rows.length > 0) {
    console.log(`⏰ Vendor escrow auto-release pass complete (${rows.length} vendor(s))`);
  }
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
 * Set the auto-release deadline for a SPECIFIC VENDOR's escrow.
 * Called when that vendor's fulfillment is marked delivered.
 * @param {number | string} orderId
 * @param {number | string} vendorId
 * @returns {Promise<number>} the configured release window in days
 */
export const setVendorEscrowReleaseDeadline = async (orderId, vendorId) => {
  await pool.execute(
    `UPDATE vendor_order_fulfillment
     SET escrowReleaseDeadline = DATE_ADD(NOW(), INTERVAL ? DAY), updated_at = CURRENT_TIMESTAMP
     WHERE orderId = ? AND vendorId = ?`,
    [ESCROW_RELEASE_DAYS, orderId, vendorId]
  );
  return ESCROW_RELEASE_DAYS;
};

/**
 * Auto-release any delivered escrow orders whose confirmation deadline has passed.
 * Called by the cleanup scheduler.
 */
export const autoReleaseExpiredEscrows = async () => {
  // F-3: only collected, live orders are candidates (releaseEscrowForOrder
  // re-validates authoritatively per order).
  const [rows] = await pool.execute(
    `SELECT id FROM orders
     WHERE orderStatus = 'delivered'
       AND escrowStatus = 'held'
       AND paymentStatus = 'paid'
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
/**
 * Refund after payout: allocations already transferred to the vendor
 * ('released') cannot be clawed back automatically, so the refunded amount
 * becomes a platform loss unless recovered by hand (R-6 decision). This used
 * to happen silently; record the order as needs_review and alert admins once.
 * Best-effort — never blocks the refund path.
 * @param {any} orderId
 * @param {any} [vendorId] limit to one vendor (partial refund)
 */
export const flagReleasedAllocationsAfterRefund = async (orderId, vendorId) => {
  try {
    const scoped = vendorId != null;
    const [rows] = await pool.execute(
      `SELECT id, vendorId, payoutAmount FROM escrow_allocations
        WHERE orderId = ? AND status = 'released'${scoped ? ' AND vendorId = ?' : ''}`,
      scoped ? [orderId, parseInt(vendorId, 10)] : [orderId]
    );
    const list = /** @type {any[]} */ (rows);
    if (list.length === 0) return 0;
    // One review row per ORDER (reconciliation_checks.entityId is an order id
    // for every job; the admin review list joins it to orders).
    const total = round2(list.reduce((sum, a) => sum + (parseFloat(String(a.payoutAmount ?? 0)) || 0), 0));
    const parts = list.map((a) => `vendor ${a.vendorId} GHS ${round2(parseFloat(String(a.payoutAmount ?? 0)) || 0).toFixed(2)} (allocation ${a.id})`);
    const message =
      `Order ${orderId} was refunded after vendor payout: ${parts.join('; ')}. Total GHS ${total.toFixed(2)}. ` +
      'Nothing was debited from the vendor; recover the funds manually or record the loss.';
    await recordCheckAndAlert('refundAfterRelease', Number(orderId), {
      state: 'needs_review',
      reason: 'paid_out_before_refund',
      detail: message,
      nextCheckMinutes: 24 * 60,
      alert: { title: 'Refund after vendor payout — manual recovery needed', message },
    });
    return list.length;
  } catch (err) {
    console.error(` flagReleasedAllocationsAfterRefund failed for order ${orderId}: ${/** @type {any} */ (err).message}`);
    return 0;
  }
};

/**
 * Void ONE vendor's escrow for an order (P1 partial/vendor returns).
 * Same guarantees as voidEscrowForOrder but scoped with `AND vendorId = ?`
 * on every statement, so innocent vendors' allocations are untouched:
 *  - that vendor's pending/held allocations -> failed
 *  - that vendor's available allocations -> clawed back, then failed
 *  - releasing/released -> left for manual recovery (unchanged)
 * @param {any} orderId
 * @param {any} vendorId owner vendor user id
 * @returns {Promise<void>}
 */
export const voidVendorEscrow = async (orderId, vendorId) => {
  const vid = parseInt(vendorId, 10);
  await pool.execute(
    `UPDATE escrow_allocations
     SET status = 'failed', reason = 'voided (partial vendor refund)', updated_at = CURRENT_TIMESTAMP
     WHERE orderId = ? AND vendorId = ? AND status IN ('pending', 'held')`,
    [orderId, vid]
  );

  const [availableRows] = await pool.execute(
    `SELECT id
     FROM escrow_allocations
     WHERE orderId = ? AND vendorId = ? AND status = 'available'`,
    [orderId, vid]
  );

  for (const row of availableRows) {
    await clawbackAvailableAllocation(orderId, row.id, 'clawed back (partial refund)', 'partial vendor refund');
  }

  const escrowStatus = await recomputeOrderEscrowStatus(orderId);
  await pool.execute(
    `UPDATE orders SET escrowStatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [escrowStatus, orderId]
  );
  // Referral commission follows the refund (R12); a failure here is retried
  // by referralService.reconcileReferralRefunds.
  await adjustReferralForRefund(orderId).catch((err) => {
    console.error(` referral adjustment after refund failed for order ${orderId}: ${err.message}`);
  });
  await flagReleasedAllocationsAfterRefund(orderId, vendorId);
};

/** @param {any} orderId */
export const voidEscrowForOrder = async (orderId) => {
  await pool.execute(
    `UPDATE escrow_allocations
     SET status = 'failed', reason = 'voided (order cancelled/refunded)', updated_at = CURRENT_TIMESTAMP
     WHERE orderId = ? AND status IN ('pending', 'held')`,
    [orderId]
  );

  const [available] = await pool.execute(
    `SELECT id FROM escrow_allocations
     WHERE orderId = ? AND status = 'available'`,
    [orderId]
  );

  for (const row of available) {
    await clawbackAvailableAllocation(orderId, row.id, 'clawed back (refunded)', 'refund/return approved');
  }

  const escrowStatus = await recomputeOrderEscrowStatus(orderId);
  await pool.execute(
    `UPDATE orders SET escrowStatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [escrowStatus, orderId]
  );
  // Referral commission follows the refund (R12); a failure here is retried
  // by referralService.reconcileReferralRefunds.
  await adjustReferralForRefund(orderId).catch((err) => {
    console.error(` referral adjustment after refund failed for order ${orderId}: ${err.message}`);
  });
  await flagReleasedAllocationsAfterRefund(orderId);
};

/**
 * Claw back ONE available allocation with a bounded re-read loop.
 * Shared by voidEscrowForOrder and voidVendorEscrow so both offer the same
 * guarantees:
 *  - pending/held handled by the caller; here only 'available' is touched.
 *  - a racing partial withdrawal that shrinks payoutAmount between SELECT
 *    and claim triggers a re-read + retry (max 3) instead of abandoning
 *    withdrawable funds on a cancelled/refunded order.
 *  - the vendor wallet is debited ONLY when a credit ledger row proves the
 *    funds were actually credited (F-2/E: a failed credit + concurrent void
 *    must never debit the vendor's unrelated balance).
 *  - reasons always contain 'void'/'clawback'/'refund' so
 *    retryFailedAllocations keeps refusing these rows.
 * @param {any} orderId
 * @param {number} allocationId
 * @param {string} claimReason stored reason on the failed row
 * @param {string} journalReason human reason for ledger + notes
 * @returns {Promise<string>} outcome: 'clawed-back' | 'voided-empty' |
 *   'voided-uncredited' | 'gone' | 'contended' | 'manual-recovery'
 */
export const clawbackAvailableAllocation = async (orderId, allocationId, claimReason, journalReason) => {
  // F-2/E: claim + credit-verification serialize on the allocation row lock
  // (same lock releaseAllocation holds across ITS transition+credit). A void
  // can therefore never observe "available but not yet credited" and debit
  // the vendor for funds that never arrived.
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[cur]] = await connection.execute(
      `SELECT vendorId, payoutAmount, status FROM escrow_allocations WHERE id = ? FOR UPDATE`,
      [allocationId]
    );
    if (!cur || cur.status !== 'available') {
      await connection.rollback();
      return 'gone';
    }
    const amount = round2(parseFloat(String(cur.payoutAmount ?? 0)) || 0);
    if (amount <= 0) {
      await connection.execute(
        `UPDATE escrow_allocations
         SET status = 'failed', reason = 'voided (no payout)', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'available'`,
        [allocationId]
      );
      await connection.commit();
      return 'voided-empty';
    }

    // Atomic claim: only ONE worker may claw back this allocation. The row
    // is already locked by us, so the payoutAmount guard cannot race.
    await connection.execute(
      `UPDATE escrow_allocations
       SET status = 'failed', reason = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'available' AND payoutAmount >= ?`,
      [claimReason, allocationId, amount]
    );

    // Only debit when the funds were actually credited to the wallet.
    const [[credit]] = await connection.execute(
      `SELECT id FROM wallet_transactions WHERE type = 'credit' AND allocationId = ? LIMIT 1`,
      [allocationId]
    );
    await connection.commit();
    if (!credit) return 'voided-uncredited';

    try {
      const debited = await clawbackVendorBalance(
        cur.vendorId,
        amount,
        `clawback:${allocationId}`,
        `Escrow clawed back for order ${orderId} (${journalReason})`
      );
      if (!debited) {
 console.warn(` Clawback no-op for allocation ${allocationId}: already withdrawn (check balance manually)`);
      }
      // Idempotent journal per allocation — only recorded when THIS worker won
      // the claim above, so a redelivery can't double record.
      await recordFinancialEvent({
        eventType: 'escrow.clawback',
        direction: 'out',
        amount,
        vendorId: cur.vendorId,
        orderId,
        allocationId,
        reference: `escrow.clawback:${allocationId}`,
        dedupeKey: `escrow.clawback:${allocationId}`,
        payload: { reason: journalReason },
      });
      return 'clawed-back';
    } catch (error) {
      // Balance was insufficient (funds already withdrawn elsewhere): leave the
      // allocation marked failed + reason below so reconciliation can find it.
 console.error(` Clawback debit failed for allocation ${allocationId}: ${error.message}`);
      await pool.execute(
        `UPDATE escrow_allocations SET reason = 'clawback failed: manual recovery needed' WHERE id = ?`,
        [allocationId]
      );
      return 'manual-recovery';
    }
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
};
/**
 * Retry payouts for all failed escrow allocations of an order.
 * Admin endpoint: allows retrying vendor payouts that failed.
 * RB-02: Does NOT retry allocations for refunded/voided/cancelled orders.
 * @param {number | string} orderId
 * @returns {Promise<{ retried: number, failed: number, skipped: number }>}
 */
export const retryFailedAllocations = async (orderId) => {
  // First check the order state - do not retry for refunded/voided/cancelled orders
  const [[order]] = await pool.execute(
    `SELECT paymentStatus, orderStatus FROM orders WHERE id = ?`,
    [orderId]
  );
  if (!order) {
    return { retried: 0, failed: 0, skipped: 0 };
  }
  // A refunded or voided allocation must NEVER become vendor wallet credit through retry.
  // Only retry for orders that are still active (paid and not cancelled/refunded).
  const isRefundedOrVoided = order.paymentStatus === 'refunded' || order.orderStatus === 'cancelled';

  // Get failed allocations for this order
  const [rows] = await pool.execute(
    `SELECT ea.*, v.businessName, v.recipientCode, v.status AS vendorStatus
     FROM escrow_allocations ea
     JOIN vendors v ON v.userId = ea.vendorId
     WHERE ea.orderId = ? AND ea.status = 'failed'
     ORDER BY ea.id ASC`,
    [orderId]
  );

  if (isRefundedOrVoided) {
    return { retried: 0, failed: 0, skipped: rows.length };
  }

  let retried = 0;
  let failed = 0;
  let skippedVoid = 0;

  for (const allocation of rows) {
    // RB-02 partial-refund guard: allocations voided by a cancel/refund carry
    // a void/clawback/refund reason and must NEVER become wallet credit via
    // retry — even when the parent order is still paid (partial refund).
    const reason = String(allocation.reason || '').toLowerCase();
    if (reason.includes('void') || reason.includes('clawback') || reason.includes('refund') || reason.includes('order creation failed')) {
      skippedVoid += 1;
      continue;
    }
    // TOCTOU guard: the order-level check above races a concurrent refund/
    // cancel. Re-verify the parent order is still active immediately before
    // each failed->held claim; a refund that landed mid-loop must win and the
    // remaining allocations must be skipped, never credited.
    const [[live]] = await pool.execute(
      `SELECT paymentStatus, orderStatus FROM orders WHERE id = ?`,
      [orderId]
    );
    if (!live || live.paymentStatus === 'refunded' || live.orderStatus === 'cancelled') {
      skippedVoid += 1;
      continue;
    }
    // 'failed' allocations come from cancel/void (pending|held -> failed).
    // releaseAllocation only transitions held -> available, so move the row
    // back to 'held' FIRST; a stale 'pending' would make the release no-op
    // and the retry would silently do nothing.
    const [claimed] = await pool.execute(
      `UPDATE escrow_allocations
       SET status = 'held', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'failed'`,
      [allocation.id]
    );
    if (claimed.affectedRows !== 1) continue;
    allocation.status = 'held';
    const updated = await releaseAllocation(allocation);
    if (updated.status === 'available') retried += 1;
    else if (updated.status === 'failed') failed += 1;
  }

  const escrowStatus = await recomputeOrderEscrowStatus(orderId);
  await pool.execute(
    `UPDATE orders SET escrowStatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [escrowStatus, orderId]
  );

  return { retried, failed, skipped: skippedVoid };
};

/**
 * Recover allocations that were transitioned held -> available but whose wallet
 * credit never committed (a hard crash between the two steps in
 * releaseAllocation). Purely idempotent: creditVendorBalance is gated by the
 * uq_wallet_credit_allocation unique key, so any allocation that was already
 * credited is skipped and never double-credited.
 * @param {{ vendorId?: number | null, limit?: number }} [opts] scheduler uses the defaults
 * @returns {Promise<{ credited: number, errored: number }>}
 */
export const reconcileAvailableAllocations = async ({ vendorId = null, limit = 200 } = {}) => {
  const batch = Math.min(500, Math.max(1, Math.floor(Number(limit)) || 200));
  const vid = vendorId == null ? null : Number(vendorId);
  const vendorScope = vid != null && Number.isInteger(vid) && vid > 0 ? ` AND ea.vendorId = ${vid}` : '';
  const [rows] = await pool.execute(
    `SELECT ea.*, v.businessName, v.recipientCode
     FROM escrow_allocations ea
     JOIN vendors v ON v.userId = ea.vendorId
     WHERE ea.status = 'available'
       -- INT-2: only allocations still MISSING their wallet credit. Credited
       -- 'available' rows (ordinary unwithdrawn balances) never leave this
       -- status, so without this filter the oldest 200 filled every batch and
       -- a newer crash-stranded credit was never recovered. Probes
       -- uq_wallet_credit_allocation (vendorId, allocationId, type).
       AND NOT EXISTS (
         SELECT 1 FROM wallet_transactions wt
          WHERE wt.vendorId = ea.vendorId AND wt.allocationId = ea.id AND wt.type = 'credit')${vendorScope}
     ORDER BY ea.id ASC
     LIMIT ${batch}`
  );
  let credited = 0;
  let errored = 0;
  for (const allocation of rows) {
    try {
      // F-3: never backfill credit for a cancelled/refunded/unpaid order —
      // a leftover 'available' row there must be voided by the cancel/return
      // flow, not paid out by the reconciler.
      const releasable = await assertOrderReleasable(allocation.orderId);
      if (!releasable.ok) {
        console.warn(` reconcileAvailableAllocations: skipping allocation ${allocation.id} (${releasable.reason})`);
        continue;
      }
      const [orderRows] = await pool.execute(
        `SELECT orderNumber FROM orders WHERE id = ?`,
        [allocation.orderId]
      );
      const orderNumber = orderRows.length > 0 ? orderRows[0].orderNumber : null;
      const { payoutAmount } = allocationFees(allocation);
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

export { readCommissionSnapshot } from './commissionService.js';


/**
 * Track platform revenue from platform-owned products (no vendorId).
 * Called after payment confirmation. Records gross, discount, and net amounts.
 *
 * The platform lines' share of an admin coupon is read from the order's
 * commission snapshot (split by platform commission, as escrow does), so
 * vendor payouts + platform net + discount == order gross. Legacy orders
 * without a snapshot keep the previous whole-order pro rata split.
 * @param {number | string} orderId
 * @param {OrderLine[]} items
 * @param {number} [discount=0] order-level discount to apportion
 * @returns {Promise<boolean>} false only when the revenue row could not be written
 */
export const trackPlatformRevenue = async (orderId, items, discount = 0) => {
  if (!Array.isArray(items) || items.length === 0) return true;

  // Same quantity/price reading as createEscrowAllocations.
  const lineTotal = (/** @type {any} */ it) =>
    (parseFloat(String(it?.price)) || 0) * (parseFloat(String(it?.quantity ?? it?.qty)) || 1);

  const platformItems = items.filter((it) => !it.vendorId);
  if (platformItems.length === 0) return true;

  const gross = platformItems.reduce((sum, it) => sum + lineTotal(it), 0);
  if (gross <= 0) return true;

  let net;
  let platformDiscount;
  const snapshot = await readCommissionSnapshot(orderId);
  if (snapshot) {
    // Orders allocated by current code: the admin-coupon share of each
    // platform line was frozen at checkout (split by platform commission, R6).
    const platformLines = snapshot.lines.filter((l) => !l.vendorId);
    platformDiscount = round2(platformLines.reduce((s, l) => s + (Number(l.Da) || 0), 0));
    net = round2(gross - platformDiscount);
  } else {
    // Legacy orders (allocated before the snapshot existed): pro rata split.
    const orderGross = items.reduce((sum, it) => sum + lineTotal(it), 0);
    const discountAmount = Math.max(0, parseFloat(String(discount)) || 0);
    const netFactor = orderGross > 0 ? Math.max(0, 1 - discountAmount / orderGross) : 1;
    net = round2(gross * netFactor);
    platformDiscount = round2(gross - net);
  }

  try {
    await pool.execute(
      `INSERT INTO platform_revenue (orderId, amount, grossAmount, discountAmount, source, created_at)
       VALUES (?, ?, ?, ?, 'platform_product', CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE amount = VALUES(amount), grossAmount = VALUES(grossAmount), discountAmount = VALUES(discountAmount)`,
      [orderId, net, gross, platformDiscount]
    );
    return true;
  } catch (err) {
 console.warn(` Could not track platform revenue for order ${orderId}: ${err.message}`);
    return false;
  }
};

/**
 * FV-8: reverse an order's platform revenue when the order is fully refunded.
 * Writes ONE `source='refund'` row mirroring the `platform_product` row with
 * negated amount/gross/discount (unique (orderId, source) ⇒ idempotent), plus
 * an audit journal entry. A no-op when no platform revenue was ever booked
 * (vendor-only orders, late charges on cancelled orders). Partial (per-vendor)
 * refunds never touch platform lines, so they are not reversed here.
 * Net platform revenue for an order = SUM(amount) over its rows.
 * @param {number | string} orderId
 * @param {string} reason e.g. 'cancel', 'return', 'reconciled'
 * @returns {Promise<boolean>} true if a reversal row was written by this call
 */
export const reversePlatformRevenueForRefund = async (orderId, reason) => {
  // Every full-refund path calls this right after the order turns refunded /
  // cancelled, so the referral commission is settled to 0 here as well (R12).
  await adjustReferralForRefund(orderId).catch((err) => {
    console.error(` referral adjustment after full refund failed for order ${orderId}: ${err.message}`);
  });
  try {
    const [ins] = /** @type {any} */ (await pool.execute(
      `INSERT IGNORE INTO platform_revenue (orderId, amount, grossAmount, discountAmount, source, created_at)
       SELECT orderId, -amount, -COALESCE(grossAmount, amount), -COALESCE(discountAmount, 0), 'refund', CURRENT_TIMESTAMP
         FROM platform_revenue WHERE orderId = ? AND source = 'platform_product'`,
      [orderId]
    ));
    if (ins.affectedRows !== 1) return false;
    const [[row]] = /** @type {any} */ (await pool.execute(
      `SELECT amount FROM platform_revenue WHERE orderId = ? AND source = 'refund'`, [orderId]
    ));
    await recordFinancialEvent({
      eventType: 'platform_revenue.reversed',
      direction: 'out',
      amount: Math.abs(Number(row?.amount) || 0),
      orderId,
      dedupeKey: `platform_revenue.reversed:${orderId}`,
      payload: { reason },
    });
    return true;
  } catch (err) {
    // Recoverable: reconcileRefundedPlatformRevenue backfills missing reversals.
    console.error(` Could not reverse platform revenue for refunded order ${orderId}: ${err.message}`);
    return false;
  }
};

/**
 * FV-8 safety net: refunded orders whose platform revenue was booked but
 * never reversed (crash after the refund flip, a path without the hook, or
 * history from before FV-8). Bounded per run; idempotent.
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<number>} reversals written
 */
export const reconcileRefundedPlatformRevenue = async ({ limit = 100 } = {}) => {
  const safeLimit = Math.min(500, Math.max(1, Math.floor(Number(limit)) || 100));
  const [rows] = /** @type {any} */ (await pool.execute(
    `SELECT pr.orderId FROM platform_revenue pr
       JOIN orders o ON o.id = pr.orderId
      WHERE pr.source = 'platform_product' AND o.paymentStatus = 'refunded'
        AND NOT EXISTS (SELECT 1 FROM platform_revenue r WHERE r.orderId = pr.orderId AND r.source = 'refund')
      ORDER BY pr.orderId ASC
      LIMIT ${safeLimit}`
  ));
  let written = 0;
  for (const r of rows) {
    if (await reversePlatformRevenueForRefund(r.orderId, 'backfill')) written += 1;
  }
  if (written > 0) console.log(` Platform revenue reversed for ${written} refunded order(s)`);
  return written;
};

/**
 * Mark a specific payment side effect as completed for an order.
 * Idempotent: safe to call multiple times.
 * @param {number | string} orderId
 * @param {string} effectName - one of: 'escrowHeld', 'stockDecremented', 'couponConsumed', 'financialEventRecorded', 'platformRevenueTracked', 'referralRecorded'
 * @returns {Promise<boolean>} true if this call made a change
 */
export const markPaymentSideEffect = async (orderId, effectName) => {
  const validEffects = ['escrowHeld', 'stockDecremented', 'couponConsumed', 'financialEventRecorded', 'platformRevenueTracked', 'referralRecorded'];
  if (!validEffects.includes(effectName)) {
    throw new Error(`Invalid side effect name: ${effectName}`);
  }
  try {
    const [result] = await pool.execute(
      `UPDATE orders
       SET paymentSideEffects = JSON_SET(
            COALESCE(paymentSideEffects, JSON_OBJECT()),
            '$.${effectName}',
            true
         ),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND (paymentSideEffects IS NULL OR JSON_EXTRACT(paymentSideEffects, '$.${effectName}') IS NULL OR JSON_EXTRACT(paymentSideEffects, '$.${effectName}') = false)`,
      [orderId]
    );
    return result.affectedRows > 0;
  } catch (err) {
 console.warn(` Could not mark payment side effect ${effectName} for order ${orderId}: ${err.message}`);
    return false;
  }
};

/** Effects that must be recorded for EVERY paid order, coupon or not. */
const NON_COUPON_SIDE_EFFECTS = ['escrowHeld', 'stockDecremented', 'financialEventRecorded', 'platformRevenueTracked'];
/** Full set: the four above plus coupon consumption (coupon orders only). */
const REQUIRED_SIDE_EFFECTS = ['escrowHeld', 'stockDecremented', 'couponConsumed', 'financialEventRecorded', 'platformRevenueTracked'];

/**
 * Does this order actually reference a coupon?
 * Fails closed: only explicit "no coupon" sentinels (null/undefined/0/''),
 * are treated as coupon-free. Any other value — including a malformed one —
 * counts as a coupon reference so couponConsumed stays mandatory for it.
 * @param {unknown} couponId
 * @returns {boolean}
 */
const orderHasCoupon = (couponId) => {
  if (couponId === null || couponId === undefined) return false;
  if (typeof couponId === 'boolean') return false;
  if (typeof couponId === 'number') return Number.isFinite(couponId) && couponId !== 0;
  const raw = String(couponId).trim().toLowerCase();
  return !(raw === '' || raw === 'null' || raw === 'undefined' || raw === '0' || raw === 'false');
};

/**
 * Check if all critical payment side effects are complete for an order.
 * `couponConsumed` is only required when the order carries a coupon — an
 * order without one is complete once escrow, stock, the financial event and
 * platform revenue are recorded. Missing/NULL/malformed coupon fields are
 * handled without throwing, and never mask genuinely missing effects.
 * @param {number | string} orderId
 * @returns {Promise<{complete: boolean, missing: string[]}>}
 */
export const checkPaymentSideEffects = async (orderId) => {
  const [[row]] = await pool.execute(
    `SELECT paymentSideEffects, couponId FROM orders WHERE id = ?`,
    [orderId]
  );
  // Unknown order: fail closed with the full set (coupon applicability unknown).
  if (!row) {
    return { complete: false, missing: [...REQUIRED_SIDE_EFFECTS] };
  }
  const required = orderHasCoupon(row.couponId) ? REQUIRED_SIDE_EFFECTS : NON_COUPON_SIDE_EFFECTS;
  const effects = row.paymentSideEffects;
  // NULL, scalar or otherwise malformed payload => nothing proven complete.
  if (!effects || typeof effects !== 'object') {
    return { complete: false, missing: [...required] };
  }
  const missing = required.filter(e => !effects[e]);
  return { complete: missing.length === 0, missing };
};

/**
 * SQL fragment every paid-flip UPDATE sets alongside paymentStatus = 'paid'.
 * It opts the order into side-effect tracking: recovery only ever touches
 * orders carrying a (possibly empty) marker object. Orders paid before
 * tracking existed keep paymentSideEffects = NULL and are never re-processed
 * — re-running stock/coupon/revenue effects on historical orders would
 * corrupt them, because nothing recorded what had already been applied.
 */
export const PAID_TRACKING_SET_SQL = 'paymentSideEffects = COALESCE(paymentSideEffects, JSON_OBJECT())';

/** @param {unknown} raw @returns {Record<string, any> | null} */
const parseSideEffects = (raw) => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : null; } catch { return null; }
  }
  return typeof raw === 'object' ? /** @type {Record<string, any>} */ (raw) : null;
};

/** @param {unknown} raw @returns {OrderLine[]} */
const parseOrderItems = (raw) => {
  let items = raw;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch { items = []; }
  }
  return Array.isArray(items) ? /** @type {OrderLine[]} */ (items) : [];
};

/**
 * Lines whose stock was NOT yet taken for this order. decrementStockForOrder
 * writes a 'sale' stock_moves row per product it decrements, so a retry after
 * a crash mid-decrement only takes the products that are still missing
 * instead of decrementing everything a second time.
 * @param {number | string} orderId
 * @param {OrderLine[]} items
 */
const linesNotYetDecremented = async (orderId, items) => {
  try {
    const [rows] = /** @type {any} */ (await pool.execute(
      `SELECT DISTINCT productId FROM stock_moves WHERE orderId = ? AND reason = 'sale'`,
      [orderId]
    ));
    const taken = new Set(rows.map((/** @type {any} */ r) => Number(r.productId)));
    return items.filter((it) => !taken.has(parseInt(String(/** @type {any} */ (it).product ?? /** @type {any} */ (it).productId), 10)));
  } catch (err) {
    if (/** @type {any} */ (err)?.code === 'ER_NO_SUCH_TABLE') return items;
    throw err;
  }
};

/**
 * Apply every still-missing post-payment side effect for a PAID order, and
 * record each one in orders.paymentSideEffects only after it succeeded.
 *
 * Shared by all four paths that move an order to paid (Paystack webhook,
 * verify-paystack fallback, admin mark-paid, stuck-pending recovery) and by
 * the incomplete-paid recovery job, so they can no longer drift apart. Each
 * effect is idempotent on its own as well (escrow hold is a pending->held
 * CAS, the journal has a dedupe key, platform revenue upserts, coupon use is
 * claimed once per order, stock skips products already taken), so a retry
 * after a crash completes the order instead of doubling anything.
 *
 * Never throws for an individual effect: a failure is returned in `errors`,
 * the marker stays unset, and recoverIncompletePaidOrders retries it.
 *
 * @param {number | string} orderId
 * @param {{ source: string, charge?: object | null }} opts
 *   source: who confirmed the payment (journal snapshot `capturedBy`);
 *   charge: the provider transaction when one was verified, else null.
 * @returns {Promise<{ complete: boolean, skipped?: string, applied: string[], errors: string[] }>}
 */
export const applyPaidOrderSideEffects = async (orderId, { source, charge = null }) => {
  const [rows] = /** @type {any} */ (await pool.execute(
    `SELECT id, items, couponId, discount, totalAmount, paymentReference,
            paymentStatus, orderStatus, paymentSideEffects, paymentMethod
     FROM orders WHERE id = ?`,
    [orderId]
  ));
  const order = rows[0];
  if (!order) return { complete: false, skipped: 'not-found', applied: [], errors: [] };
  if (order.paymentStatus !== 'paid' || ['cancelled', 'refunded'].includes(order.orderStatus)) {
    return { complete: false, skipped: 'not-paid', applied: [], errors: [] };
  }
  const done = parseSideEffects(order.paymentSideEffects);
  if (!done) {
    // Untracked (paid before tracking existed): never re-apply anything.
    return { complete: false, skipped: 'untracked', applied: [], errors: [] };
  }

  const items = parseOrderItems(order.items);
  /** @type {string[]} */ const applied = [];
  /** @type {string[]} */ const errors = [];

  /** @param {string} name @param {() => Promise<boolean>} run */
  const step = async (name, run) => {
    if (done[name] === true) return;
    try {
      if (await run()) {
        await markPaymentSideEffect(orderId, name);
        applied.push(name);
      } else {
        errors.push(`${name}: not confirmed`);
      }
    } catch (err) {
      errors.push(`${name}: ${/** @type {any} */ (err)?.message || err}`);
    }
  };

  await step('financialEventRecorded', async () => {
    if (order.paymentMethod === 'referral_credit') {
      // Paid from the buyer's referral wallet (no provider charge exists).
      return recordFinancialEvent({
        eventType: 'referral_credit.collected',
        direction: 'in',
        amount: parseFloat(order.totalAmount) || 0,
        currency: CHARGED_CURRENCY,
        orderId: order.id,
        reference: `referral_credit:${order.id}`,
        dedupeKey: `referral_credit.collected:${order.id}`,
        payload: { capturedBy: String(source) },
      });
    }
    const { buildChargeSnapshot } = await import('./paymentCurrency.js');
    const totalKobo = Math.round((parseFloat(order.totalAmount) || 0) * 100);
    return recordFinancialEvent({
      eventType: 'charge.collected',
      direction: 'in',
      amount: parseFloat(order.totalAmount) || 0,
      // Every caller validated the provider charge against CHARGED_CURRENCY
      // (or is an admin confirming a GHS order); the provider's own values
      // are preserved verbatim in the snapshot.
      currency: CHARGED_CURRENCY,
      orderId: order.id,
      reference: order.paymentReference || null,
      providerReference: order.paymentReference || null,
      // Per-reference key, shared with the historical webhook/verify writes
      // so they dedupe against each other. Orders without a reference get a
      // per-order key (all of them used to share `charge.collected:undefined`,
      // so only the first such order was ever journaled).
      dedupeKey: order.paymentReference
        ? `charge.collected:${order.paymentReference}`
        : `charge.collected:order:${order.id}`,
      payload: buildChargeSnapshot(charge ?? { amount: totalKobo, currency: CHARGED_CURRENCY }, source),
    });
  });

  await step('escrowHeld', async () => {
    await holdEscrowForOrder(order.id);
    return true;
  });

  await step('platformRevenueTracked', async () =>
    trackPlatformRevenue(order.id, items, parseFloat(order.discount ?? 0) || 0)
  );

  await step('stockDecremented', async () => {
    const remaining = await linesNotYetDecremented(order.id, items);
    if (remaining.length > 0) {
      const { decrementStockForOrder } = await import('../controllers/orderController.js');
      await decrementStockForOrder(remaining, order.id);
    }
    return true;
  });

  if (orderHasCoupon(order.couponId)) {
    await step('couponConsumed', async () => {
      // Exhausted coupons are journaled + reported inside; that is still a
      // completed settlement attempt (the slot cannot be taken twice).
      await consumeCouponForOrder(order.couponId, order.id);
      return true;
    });
  }

  // Referral commission (REFERRAL_SYSTEM_DESIGN.md): one per order, created
  // only here, i.e. after the backend verified the payment. Not part of the
  // recovery gate below (historical orders must not be re-scanned); a missed
  // step is picked up by referralService.recordMissingReferralCommissions.
  if (charge) await recordPaymentInstrument(order.id, charge);
  await step('referralRecorded', async () => recordReferralForOrder(order.id));

  return { complete: errors.length === 0, applied, errors };
};

/** Orders examined per recovery run (bounded scan). */
const RECOVERY_BATCH_SIZE = Math.max(1, parseInt(process.env.PAID_EFFECTS_RECOVERY_BATCH || '', 10) || 50);
/** Give the confirming request time to finish before recovery competes with it. */
const RECOVERY_GRACE_MINUTES = 10;
/** After this many recovery attempts the order is left for an operator. */
const RECOVERY_MAX_ATTEMPTS = 5;

/**
 * Recovery job: paid orders whose tracked side effects are incomplete — the
 * confirming request crashed or a DB write failed after the paid flip (a
 * webhook redelivery cannot help: it sees `paid` and stands down).
 *
 * Bounded and conservative: only tracked orders (never historical NULL
 * rows), never cancelled/refunded ones, only after a grace period, at most
 * RECOVERY_BATCH_SIZE per run and RECOVERY_MAX_ATTEMPTS per order; an order
 * that still fails then raises one admin alert instead of retrying forever.
 * @returns {Promise<number>} number of orders brought to complete
 */
export const recoverIncompletePaidOrders = async () => {
  const missing = (/** @type {string} */ k) =>
    `(JSON_EXTRACT(paymentSideEffects, '$.${k}') IS NULL OR JSON_EXTRACT(paymentSideEffects, '$.${k}') = false)`;
  const [rows] = /** @type {any} */ (await pool.execute(
    `SELECT id FROM orders
     WHERE paymentStatus = 'paid'
       AND orderStatus NOT IN ('cancelled', 'refunded')
       AND paymentSideEffects IS NOT NULL
       AND COALESCE(JSON_EXTRACT(paymentSideEffects, '$.recoveryAttempts'), 0) < ${RECOVERY_MAX_ATTEMPTS}
       AND updated_at < DATE_SUB(NOW(), INTERVAL ${RECOVERY_GRACE_MINUTES} MINUTE)
       AND (${missing('escrowHeld')} OR ${missing('stockDecremented')}
            OR ${missing('financialEventRecorded')} OR ${missing('platformRevenueTracked')}
            -- couponConsumed only gates orders that actually carry a coupon
            OR (couponId IS NOT NULL AND couponId <> 0 AND ${missing('couponConsumed')}))
     ORDER BY id ASC
     LIMIT ${RECOVERY_BATCH_SIZE}`
  ));

  let recovered = 0;
  for (const { id } of rows) {
    try {
      await pool.execute(
        `UPDATE orders
         SET paymentSideEffects = JSON_SET(paymentSideEffects, '$.recoveryAttempts',
               COALESCE(JSON_EXTRACT(paymentSideEffects, '$.recoveryAttempts'), 0) + 1)
         WHERE id = ? AND paymentSideEffects IS NOT NULL`,
        [id]
      );
      const result = await applyPaidOrderSideEffects(id, { source: 'recovery' });
      if (result.complete) {
        recovered += 1;
 console.log(` Recovered incomplete paid order ${id} (${result.applied.join(', ') || 'nothing missing'})`);
        continue;
      }
      if (result.skipped) continue;
 console.warn(` Paid order ${id} still incomplete after recovery: ${result.errors.join('; ')}`);
      const [[att]] = /** @type {any} */ (await pool.execute(
        `SELECT COALESCE(JSON_EXTRACT(paymentSideEffects, '$.recoveryAttempts'), 0) AS n FROM orders WHERE id = ?`,
        [id]
      ));
      if (Number(att?.n) >= RECOVERY_MAX_ATTEMPTS) {
        const { notifyAdmins } = await import('../utils/adminAlerts.js');
        await notifyAdmins(
          'Paid order side effects incomplete — manual review',
          `Order #${id} is paid but post-payment processing could not complete after ${RECOVERY_MAX_ATTEMPTS} attempts: ${result.errors.join('; ').slice(0, 400)}. Automatic recovery has stopped for this order.`
        );
      }
    } catch (err) {
 console.warn(` Could not recover incomplete paid order ${id}: ${/** @type {any} */ (err)?.message}`);
    }
  }
  return recovered;
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
  // A FULL refund journal completes bookkeeping automatically. A PARTIAL-only
  // trail never flips the order (it stays paid by design) — the crashed
  // partial's vendor escrow is safe to re-void (idempotent claim), while the
  // stock/refundedAmount remainder goes to an admin with exact recovery SQL.
  const fullExpr = journalTable
    ? `EXISTS(SELECT 1 FROM financial_events fe WHERE fe.dedupeKey = CONCAT('refund:', o.id) OR (fe.dedupeKey LIKE CONCAT('refund:', o.id, ':%') AND fe.dedupeKey NOT LIKE '%:partial:%'))`
    : `0`;
  const [rows] = await pool.execute(
    `SELECT o.id, o.paymentReference, o.escrowStatus, o.refundReference,
            (${journalExpr}) AS refundJournaled,
            (${fullExpr}) AS fullRefundJournaled
     FROM orders o
     WHERE o.paymentStatus = 'paid' AND o.refundReference IS NOT NULL`
  );
  if (rows.length === 0) return 0;
  let recovered = 0;
  for (const row of rows) {
    try {
      if (Number(row.refundJournaled) === 1 && Number(row.fullRefundJournaled) !== 1) {
        // Partial crash: re-void is idempotent and money-safe (prevents vendor
        // payout of refunded money); the remainder needs exact amounts, so it
        // alerts with recovery SQL instead of guessing.
        const markerVendor = String(row.refundReference || '').split(':').pop() ?? '';
        try {
          const vid = parseInt(markerVendor, 10);
          if (Number.isFinite(vid)) await voidVendorEscrow(row.id, vid);
        } catch { /* void is best-effort here */ }
        try {
          const [admins] = await pool.execute(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 5`);
          for (const admin of admins) {
            await Notification.create({
              userId: admin.id,
              type: 'system',
              title: 'Partial refund crashed mid-flight — finish manually',
              message: `Order #${row.id} has a partial-refund journal but a stale paid state. Vendor escrow re-voided. Verify the Paystack refund, then run: UPDATE orders SET refundedAmount = refundedAmount + <amount> WHERE id = ${row.id}; plus restore that vendor's lines. Do NOT re-refund blindly.`,
              link: `/admin/orders`,
            });
          }
        } catch { /* notify is best-effort */ }
        recovered += 1;
      } else if (Number(row.refundJournaled) === 1) {
        await cancelEscrowForOrder(row.id);
        const [flip] = await pool.execute(
          `UPDATE orders SET paymentStatus = 'refunded', updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND paymentStatus = 'paid'`,
          [row.id]
        );
        if (flip.affectedRows > 0) {
          await reversePlatformRevenueForRefund(row.id, 'reconciled');
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
          const [admins] = await pool.execute(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 5`);
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
          const [admins] = await pool.execute(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 5`);
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

/** Stuck-pending scan bounds: each candidate costs one Paystack verify call. */
const STUCK_PENDING_WINDOW_DAYS = 7;
const STUCK_PENDING_BATCH = Math.max(1, parseInt(process.env.STUCK_PENDING_RECOVERY_BATCH || '', 10) || 100);
const STUCK_PENDING_JOB = 'stuckPending';
/** Re-check backoff for an order Paystack keeps reporting unpaid: 30 min, doubling, capped at 12 h. */
/** @param {unknown} checkCount */
const stuckPendingBackoffMinutes = (checkCount) => Math.min(12 * 60, 30 * 2 ** Math.min(10, Math.max(0, Number(checkCount) || 0)));

/**
 * Last-resort recovery for orders whose payment confirmation never arrived.
 * Bounded: only orders 1h..7d old, oldest first, STUCK_PENDING_BATCH per run.
 * It used to re-verify EVERY pending order ever created on each 30-minute run
 * — an ever-growing scan of abandoned checkouts, each one a provider call.
 * Older late charges still reach operators through the webhook and
 * reconcileUnmatchedCharges.
 */

/**
 * Safe integer id list for an `o.id IN (...)` scope (operator re-check / tests).
 * @param {unknown} ids
 */
const idScope = (ids) => {
  if (ids == null) return '';
  const clean = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  return clean.length ? ` AND o.id IN (${clean.join(',')})` : ' AND 1 = 0';
};

/**
 * @param {{ limit?: number, orderIds?: number[] | null, minAgeMinutes?: number }} [opts]
 *   defaults are the scheduler's; `orderIds` scopes a targeted re-check.
 */
export const recoverStuckPendingOrders = async ({ limit = STUCK_PENDING_BATCH, orderIds = null, minAgeMinutes = 60 } = {}) => {
  const batch = Math.min(500, Math.max(1, Math.floor(Number(limit)) || STUCK_PENDING_BATCH));
  const minAgeRaw = Math.floor(Number(minAgeMinutes));
  const minAge = Number.isFinite(minAgeRaw) && minAgeRaw >= 0 ? minAgeRaw : 60;
  // FV-7: fair selection via reconciliation_checks. It used to be oldest-first
  // over the whole 7-day window, re-verifying every abandoned checkout every
  // 30 min, so > STUCK_PENDING_BATCH of them starved a newer, genuinely paid
  // order until they aged out. Now: only DUE orders, never-checked first, then
  // least recently checked; "not paid" answers back off exponentially.
  const population = `o.paymentStatus = 'pending'
       AND o.paymentReference IS NOT NULL
       AND o.paymentReference != ''
       AND o.created_at <= DATE_SUB(NOW(), INTERVAL ${minAge} MINUTE)
       AND o.created_at > DATE_SUB(NOW(), INTERVAL ${STUCK_PENDING_WINDOW_DAYS} DAY)${idScope(orderIds)}`;
  const { join, due, order: fairOrder } = dueJoin(STUCK_PENDING_JOB, 'o.id');
  let rows;
  try {
    [rows] = /** @type {any} */ (await pool.execute(
      `SELECT o.id, o.paymentReference, o.totalAmount, COALESCE(rc.checkCount, 0) AS checkCount
         FROM orders o ${join}
        WHERE ${population} AND ${due}
        ORDER BY ${fairOrder}
        LIMIT ${batch}`
    ));
  } catch (err) {
    if (err?.code !== 'ER_NO_SUCH_TABLE') throw err;
    console.warn('reconciliation_checks missing — run `npm run db:migrate` (migrateReconciliationChecks.js); using the legacy oldest-first scan');
    [rows] = /** @type {any} */ (await pool.execute(
      `SELECT o.id, o.paymentReference, o.totalAmount, 0 AS checkCount FROM orders o
        WHERE ${population} ORDER BY o.created_at ASC LIMIT ${batch}`
    ));
  }
  /** @param {any} order @param {'waiting' | 'needs_review' | 'resolved'} state @param {string} reason @param {{ title: string, message: string } | null} [alert] */
  const outcome = (order, state, reason, alert = null) => recordCheckAndAlert(STUCK_PENDING_JOB, order.id, {
    state, reason, alert,
    nextCheckMinutes: state === 'needs_review' ? 6 * 60 : stuckPendingBackoffMinutes(order.checkCount),
  });

  if (rows.length === 0) return 0;
  if (rows.length === batch) {
    console.warn(` recoverStuckPendingOrders: batch limit (${batch}) reached; remaining candidates are checked on later runs`);
  }

  let recovered = 0;
  for (const order of rows) {
    try {
      const { default: axios } = await import('axios');
      // SECURITY FIX (V-09): encodeURIComponent the reference to prevent
      // same-host path injection. Also validate format.
      const ref = order.paymentReference;
      if (!ref || !/^[A-Za-z0-9._-]{1,100}$/.test(ref)) {
 console.warn(` Stuck order ${order.id}: invalid paymentReference format, skipping`);
        await outcome(order, 'needs_review', 'invalid_reference');
        continue;
      }
      const encodedRef = encodeURIComponent(ref);
      // V-09b: assert the built URL's shape, not just the reference's
      // characters. The class above allows `.`, so `..` passed it and
      // normalization moved this URL off the verify prefix. This job runs
      // unattended an hour after checkout, so a path it should never have
      // asked about would be answered and trusted without a human seeing it.
      const verifyUrl = new URL(`https://api.paystack.co/transaction/verify/${encodedRef}`);
      if (
        verifyUrl.origin !== 'https://api.paystack.co'
        || verifyUrl.pathname !== `/transaction/verify/${encodedRef}`
      ) {
        console.warn(` Stuck order ${order.id}: paymentReference does not survive URL normalization, skipping`);
        await outcome(order, 'needs_review', 'invalid_reference');
        continue;
      }
      const resp = await axios.get(
        verifyUrl.href,
        { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }, timeout: PAYSTACK_TIMEOUT_MS }
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
          tx.currency !== CHARGED_CURRENCY ||
          !Number.isFinite(paidKobo) ||
          paidKobo !== expectedKobo
        ) {
          console.warn(
` Stuck order ${order.id}: payment mismatch — paid ${paidKobo} ${tx.currency}, ` +
            `expected ${expectedKobo} ${CHARGED_CURRENCY} (ref ${order.paymentReference}); NOT recovering`
          );
          // A real charge that does not match the order: the customer paid
          // something, the order is not fulfilled — a human must decide
          // (refund or correct). Durable + alerted once, not a log line.
          await outcome(order, 'needs_review', 'charge_amount_mismatch', {
            title: 'Paid charge does not match its order',
            message: `Order #${order.id}: Paystack confirms a successful charge of ${paidKobo} ${tx.currency} (pesewas) but the order expects ${expectedKobo} ${CHARGED_CURRENCY}. The order was NOT marked paid. Decide on a refund or correction in the Paystack dashboard.`,
          });
          continue;
        }
        // Flip-guard: only run side effects if THIS call actually moved the
        // order from pending to paid, so a recovery racing with the webhook or
        // verify-paystack fallback can never double-hold escrow or
        // double-decrement stock.
        const [flipResult] = await pool.execute(
          `UPDATE orders SET paymentStatus = 'paid', orderStatus = 'processing', ${PAID_TRACKING_SET_SQL}, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND paymentStatus = 'pending' AND orderStatus NOT IN ('cancelled', 'refunded')`,
          [order.id]
        );
        if (flipResult.affectedRows === 0) {
          // The flip missed: the order may have been cancelled/refunded after
          // the charge settled (or a fallback already paid it). A verified
          // charge on a terminal order must be reconciled by refund here too —
          // this job is the last resort when the webhook never arrived, and
          // silently skipping it used to drop the customer's money.
          const [[fresh]] = await pool.execute(
            `SELECT id, paymentStatus, orderStatus, refundReference, totalAmount, paymentReference
             FROM orders WHERE id = ?`,
            [order.id]
          );
          if (
            fresh &&
            (['cancelled', 'refunded'].includes(fresh.orderStatus) || fresh.paymentStatus === 'refunded')
          ) {
            const terminal = await reconcileTerminalOrderCharge(fresh, tx);
            if (terminal.action === 'refunded') {
              console.log(` Reconciled late charge on terminal order ${order.id} by refund`);
            }
            // Further refund follow-up is owned by the refund reconcilers.
            await outcome(order, 'resolved', `terminal_${terminal.action}`);
          } else {
            await outcome(order, 'resolved', 'paid_elsewhere');
          }
          continue;
        }

        // Same shared side effects as the webhook/verify paths (this path
        // used to skip the charge journal and platform revenue entirely).
        const effects = await applyPaidOrderSideEffects(order.id, { source: 'stuck-recovery', charge: tx });
        if (!effects.complete) {
          console.error(` Stuck order ${order.id}: paid but side effects incomplete (recovery will retry): ${effects.errors.join('; ')}`);
        }

 console.log(` Recovered stuck order ${order.id} via Paystack verify`);
        recovered += 1;
        await outcome(order, 'resolved', 'recovered');
      } else {
        // Not (yet) a successful charge — abandoned checkouts land here on
        // every check; back off so they stop crowding the batch.
        await outcome(order, 'waiting', `provider_${String(tx?.status || 'no_data').slice(0, 40)}`);
      }
    } catch (err) {
 console.warn(` Could not recover stuck order ${order.id}: ${err.message}`);
      await outcome(order, 'waiting', 'verify_error');
    }
  }
  return recovered;
};
