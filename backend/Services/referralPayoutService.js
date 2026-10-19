// @ts-check
// FILE LOCATION: backend/Services/referralPayoutService.js
// DESCRIPTION: Referral wallet money-out: Paystack withdrawals and paying a
//              whole order with referral earnings (REFERRAL_SYSTEM_DESIGN.md R13).
//   Withdrawal = the vendor payout pattern, simplified to one wallet:
//     1. reserve under the wallet row lock (balance -> reserved) and persist the
//        reference BEFORE calling Paystack;
//     2. initiate; a definite provider rejection returns the funds, no answer
//        keeps them reserved;
//     3. webhook (transfer.*) or the bounded reconciler settles exactly once;
//        amount/currency evidence must match or the withdrawal is parked for
//        an admin. "paid" is set only from Paystack evidence — there is no
//        manual mark-paid.
import crypto from 'crypto';
import { getReferralMinWithdrawal } from './pricingConfig.js';
import pool from '../config/db.js';
import paystackServices from './paystackservices.js';
import { round2 } from '../../shared/pricing.js';
import { postReferralLedger } from './referralService.js';
import { transferReconciliationHooks } from './transferReconciliationService.js';
import { recordFinancialEvent } from './ledgerService.js';
import { notifyAdmins } from '../utils/adminAlerts.js';

export const REFERRAL_TRANSFER_PREFIX = 'kente_rtr_';
// The minimum withdrawal is the admin setting referral.minWithdrawal
// (Services/pricingConfig.js), seeded at the design §6 default of GH₵10.
const NOT_FOUND_GRACE_MINUTES = 30;

/**
 * Create the wallet row OUTSIDE any money transaction. Inside one, INSERT
 * IGNORE on an existing row takes a shared lock that the following
 * SELECT ... FOR UPDATE must upgrade, so two concurrent requests for the same
 * wallet deadlocked (one answered 500) instead of queueing on the row lock.
 * @param {number} userId
 */
const ensureWalletRow = async (userId) => {
  await pool.execute(`INSERT IGNORE INTO referral_wallets (userId) VALUES (?)`, [userId]);
};

/** @param {any} ref */
export const isReferralTransferRef = (ref) => typeof ref === 'string' && ref.startsWith(REFERRAL_TRANSFER_PREFIX);

/** @param {any} w @param {string} reason @param {string} detail */
const park = async (w, reason, detail) => {
  await pool.execute(
    `UPDATE referral_withdrawals SET status = 'reconciliation_required', lastError = ? WHERE id = ? AND status = 'processing'`,
    [`${reason}: ${detail}`.slice(0, 500), w.id]
  );
  await notifyAdmins(
    'Referral withdrawal needs attention',
    `Referral withdrawal #${w.id} (ref ${w.reference}, GHS ${round2(Number(w.amount)).toFixed(2)}): ${detail}. Funds stay reserved. Do NOT re-send — verify in the Paystack dashboard.`,
    { link: '/admin?section=referrals' }
  ).catch(() => {});
};

/**
 * Settle one referral withdrawal from provider evidence. Idempotent: the row
 * is locked and only `processing` (or a paid row being reversed) changes.
 * @param {string} reference
 * @param {'success' | 'failed' | 'reversed'} outcome
 * @param {{ amountMinor?: number | null, currency?: string | null }} [evidence]
 * @returns {Promise<'settled' | 'already' | 'unknown' | 'review'>}
 */
export const settleReferralWithdrawal = async (reference, outcome, evidence = {}) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[w]] = await conn.execute(`SELECT * FROM referral_withdrawals WHERE reference = ? FOR UPDATE`, [reference]);
    if (!w) { await conn.rollback(); return 'unknown'; }
    const amount = round2(Number(w.amount));
    const minor = Math.round(amount * 100);
    if ((evidence.amountMinor != null && Number(evidence.amountMinor) !== minor)
      || (evidence.currency && String(evidence.currency).toUpperCase() !== w.currency)) {
      await conn.rollback();
      await park(w, 'evidence_mismatch', `provider reports ${evidence.amountMinor} ${evidence.currency}`);
      return 'review';
    }
    await conn.execute(`SELECT userId FROM referral_wallets WHERE userId = ? FOR UPDATE`, [w.userId]);

    if (outcome === 'success') {
      if (w.status !== 'processing') { await conn.rollback(); return 'already'; }
      await postReferralLedger(conn, {
        userId: w.userId, type: 'withdraw_paid', balance: 0, reserved: -amount, withdrawn: amount,
        withdrawalId: w.id, dedupeKey: `ref.wdpaid:${w.id}`, note: 'Withdrawal paid (Paystack confirmed)',
      });
      await conn.execute(
        `UPDATE referral_withdrawals SET status = 'paid', providerStatus = 'success', settledAt = NOW() WHERE id = ?`, [w.id]
      );
    } else {
      const wasPaid = w.status === 'paid';
      if (w.status !== 'processing' && !(wasPaid && outcome === 'reversed')) { await conn.rollback(); return 'already'; }
      // Funds come back to the spendable balance exactly once.
      await postReferralLedger(conn, {
        userId: w.userId, type: 'withdraw_return', balance: amount,
        reserved: wasPaid ? 0 : -amount, withdrawn: wasPaid ? -amount : 0,
        withdrawalId: w.id, dedupeKey: `ref.wdret:${w.id}`, note: `Withdrawal ${outcome}`,
      });
      await conn.execute(
        `UPDATE referral_withdrawals SET status = 'failed', providerStatus = ?, settledAt = NOW() WHERE id = ?`, [outcome, w.id]
      );
    }
    await recordFinancialEvent({
      eventType: `referral.withdrawal.${outcome}`, direction: outcome === 'success' ? 'out' : 'info', amount,
      reference, providerReference: reference, dedupeKey: `referral.withdrawal.${outcome}:${w.id}`,
      payload: { withdrawalId: w.id, userId: w.userId }, connection: conn,
    });
    await conn.commit();
    return 'settled';
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
};

/**
 * Request a withdrawal of `amountMinor` pesewas. One request key per intent
 * (double-clicks return the same withdrawal).
 * @param {{ userId: number, amountMinor: number, requestKey: string }} p
 * @returns {Promise<{ status: number, body: any }>}
 */
export const requestReferralWithdrawal = async ({ userId, amountMinor, requestKey }) => {
  const amount = round2(amountMinor / 100);
  const minWithdrawal = await getReferralMinWithdrawal();
  if (amount < minWithdrawal) {
    return { status: 400, body: { message: `Minimum withdrawal is GH₵${minWithdrawal.toFixed(2)}` } };
  }
  const [[user]] = await pool.execute(
    `SELECT id, is_email_verified, isActive, ambassadorSuspended, referralRecipientCode FROM users WHERE id = ?`, [userId]
  );
  if (!user || !user.isActive || !user.is_email_verified) return { status: 403, body: { message: 'Verify your email before withdrawing' } };
  if (user.ambassadorSuspended) return { status: 403, body: { message: 'Referral account suspended' } };
  if (!user.referralRecipientCode) return { status: 400, body: { message: 'Add a payout account first' } };

  const reference = `${REFERRAL_TRANSFER_PREFIX}${crypto.randomUUID().replace(/-/g, '')}`;
  await ensureWalletRow(userId);
  const conn = await pool.getConnection();
  let withdrawal;
  try {
    await conn.beginTransaction();
    const [[wallet]] = await conn.execute(`SELECT balance FROM referral_wallets WHERE userId = ? FOR UPDATE`, [userId]);
    const [[dup]] = await conn.execute(
      `SELECT * FROM referral_withdrawals WHERE userId = ? AND idempotencyKey = ?`, [userId, requestKey]
    );
    if (dup) { await conn.rollback(); return { status: 200, body: { message: 'Withdrawal already submitted', withdrawal: dup } }; }
    if (round2(Number(wallet.balance)) < amount) {
      await conn.rollback();
      return { status: 400, body: { message: 'Insufficient referral balance' } };
    }
    const [ins] = await conn.execute(
      `INSERT INTO referral_withdrawals (userId, amount, reference, idempotencyKey, recipientCode, status)
       VALUES (?, ?, ?, ?, ?, 'processing')`,
      [userId, amount, reference, requestKey, user.referralRecipientCode]
    );
    await postReferralLedger(conn, {
      userId, type: 'withdraw_reserve', balance: -amount, reserved: amount, withdrawalId: ins.insertId,
      dedupeKey: `ref.wd:${ins.insertId}`, note: 'Withdrawal requested',
    });
    await conn.commit();
    withdrawal = { id: ins.insertId, reference, amount };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }

  try {
    const resp = await paystackServices.initiateTransfer(amount, user.referralRecipientCode, 'Kente Market referral earnings', reference);
    const data = resp?.data || {};
    await pool.execute(
      `UPDATE referral_withdrawals SET providerStatus = ?, providerTransferCode = ? WHERE id = ?`,
      [String(data.status || 'pending').slice(0, 40), data.transfer_code || null, withdrawal.id]
    );
    if (data.status === 'success') await settleReferralWithdrawal(reference, 'success', { amountMinor: data.amount ?? null, currency: data.currency ?? null });
    if (data.status === 'failed') await settleReferralWithdrawal(reference, 'failed');
  } catch (err) {
    const e = /** @type {any} */ (err);
    await pool.execute(`UPDATE referral_withdrawals SET lastError = ? WHERE id = ?`, [String(e.message).slice(0, 500), withdrawal.id]);
    // A definite rejection (provider answered 4xx) means no transfer exists.
    if (e.hadProviderResponse && Number(e.providerStatus) >= 400 && Number(e.providerStatus) < 500) {
      await settleReferralWithdrawal(reference, 'failed');
      return { status: 502, body: { message: 'Paystack rejected the transfer; your balance was restored' } };
    }
    // No answer: the transfer may exist — keep the funds reserved for reconciliation.
  }
  const [[row]] = await pool.execute(`SELECT id, amount, status, created_at FROM referral_withdrawals WHERE id = ?`, [withdrawal.id]);
  return { status: 202, body: { message: 'Withdrawal submitted', withdrawal: row } };
};

/**
 * Bounded reconciler for referral withdrawals still `processing` (lost
 * webhooks, timeouts). Rotates by lastCheckedAt so a backlog cannot starve.
 * @param {{ limit?: number, ids?: number[], minAgeMinutes?: number }} [opts]
 */
export const reconcileReferralWithdrawals = async ({ limit = 25, ids, minAgeMinutes = 5 } = {}) => {
  const scope = Array.isArray(ids) && ids.length ? ` AND id IN (${ids.map((i) => Number(i) | 0).join(',')})` : '';
  const [rows] = await pool.execute(
    `SELECT * FROM referral_withdrawals
      WHERE status = 'processing' AND created_at <= DATE_SUB(NOW(), INTERVAL ${Math.max(0, minAgeMinutes | 0)} MINUTE)${scope}
      ORDER BY (lastCheckedAt IS NOT NULL), lastCheckedAt ASC, id ASC LIMIT ${Math.max(1, Math.min(200, limit | 0))}`
  );
  /** @type {Record<string, number>} */
  const tally = {};
  for (const w of /** @type {any[]} */ (rows)) {
    let result = 'pending';
    try {
      const resp = await transferReconciliationHooks.verifyTransfer(w.reference);
      const tx = resp?.data?.data;
      const status = String(tx?.status || '').toLowerCase();
      const evidence = { amountMinor: tx?.amount ?? null, currency: tx?.currency ?? null };
      if (status === 'success' || status === 'failed' || status === 'reversed') {
        result = await settleReferralWithdrawal(w.reference, /** @type {any} */ (status), evidence);
      } else if (status === 'otp' || status === 'blocked' || status === 'abandoned') {
        await park(w, `provider_${status}`, `Paystack reports '${status}'`);
        result = 'review';
      }
    } catch (err) {
      const httpStatus = /** @type {any} */ (err)?.response?.status;
      const ageMin = (Date.now() - new Date(w.created_at).getTime()) / 60000;
      if (httpStatus === 404) {
        if (w.providerTransferCode) {
          await park(w, 'provider_not_found_after_ack', 'Paystack acknowledged the transfer but verify reports it does not exist');
          result = 'review';
        } else if (ageMin > NOT_FOUND_GRACE_MINUTES) {
          // Reference was sent with the initiate and never acknowledged: no transfer exists.
          result = await settleReferralWithdrawal(w.reference, 'failed');
        }
      } else {
        result = 'errored';
      }
    }
    await pool.execute(
      `UPDATE referral_withdrawals SET checkCount = checkCount + 1, lastCheckedAt = NOW() WHERE id = ?`, [w.id]
    );
    tally[result] = (tally[result] || 0) + 1;
  }
  return tally;
};

/**
 * Pay a still-unpaid order in FULL from the buyer's referral balance (R13).
 * The order becomes `paid` with paymentMethod 'referral_credit' (final — no
 * refund), and the normal paid side effects then hold escrow for the seller.
 * Never partial, never mixed with Paystack.
 * @param {{ userId: number, orderId: number }} p
 * @returns {Promise<{ status: number, body: any }>}
 */
export const payOrderWithReferralCredit = async ({ userId, orderId }) => {
  await ensureWalletRow(userId);
  const conn = await pool.getConnection();
  let total;
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.execute(
      `SELECT id, userId, totalAmount, paymentStatus, orderStatus, paymentReference FROM orders WHERE id = ? FOR UPDATE`, [orderId]
    );
    if (!order || Number(order.userId) !== Number(userId)) { await conn.rollback(); return { status: 404, body: { message: 'Order not found' } }; }
    if (order.paymentStatus !== 'pending' || order.orderStatus !== 'pending' || order.paymentReference) {
      await conn.rollback();
      return { status: 409, body: { message: 'This order can no longer be paid with referral earnings' } };
    }
    total = round2(Number(order.totalAmount) || 0);
    if (!(total > 0)) { await conn.rollback(); return { status: 400, body: { message: 'Nothing to pay' } }; }
    const [[wallet]] = await conn.execute(`SELECT balance FROM referral_wallets WHERE userId = ? FOR UPDATE`, [userId]);
    if (round2(Number(wallet.balance)) < total) {
      await conn.rollback();
      return { status: 400, body: { message: 'Your referral earnings do not cover the full order total' } };
    }
    const posted = await postReferralLedger(conn, {
      userId, type: 'spend', balance: -total, spent: total, orderId, dedupeKey: `ref.spend:${orderId}`, note: 'Order paid with referral earnings',
    });
    if (!posted) { await conn.rollback(); return { status: 409, body: { message: 'Order already paid' } }; }
    const [flip] = await conn.execute(
      `UPDATE orders SET paymentStatus = 'paid', paymentMethod = 'referral_credit', orderStatus = 'processing',
              paymentSideEffects = COALESCE(paymentSideEffects, JSON_OBJECT()), updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND paymentStatus = 'pending'`, [orderId]
    );
    if (flip.affectedRows !== 1) { await conn.rollback(); return { status: 409, body: { message: 'Order already paid' } }; }
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
  // Same shared side effects as every other paid flip (escrow hold, stock,
  // coupon, journal). A failure is retried by recoverIncompletePaidOrders.
  const { applyPaidOrderSideEffects } = await import('./escrowService.js');
  const effects = await applyPaidOrderSideEffects(orderId, { source: 'referral-credit' });
  return { status: 200, body: { message: 'Order paid with referral earnings', orderId, amount: total, effectsComplete: effects.complete } };
};
