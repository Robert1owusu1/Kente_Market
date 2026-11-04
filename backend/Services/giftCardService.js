// @ts-check
// FILE LOCATION: backend/Services/giftCardService.js
// DESCRIPTION: Gift card + store credit orchestration (Phase 3, Step 7).
//   Purchase (Paystack) → on payment issue a code + email it → redeem into the
//   recipient's spend-only store credit → pay a whole order from that credit
//   (mirrors payOrderWithReferralCredit; same escrow/commission side effects).
import crypto from 'crypto';
import pool from '../config/db.js';
import { round2 } from '../../shared/pricing.js';
import paystack from './paystackservices.js';
import GiftCard from '../models/giftCardModel.js';
import { sendEmailSafely } from '../utils/emailService.js';
import { frontendBaseUrl } from '../config/frontendOrigins.js';

export const GIFT_CARD_MIN = 10;      // GHS
export const GIFT_CARD_MAX = 10000;   // GHS

/** Human-friendly unique code: BK-XXXX-XXXX-XXXX (no ambiguous chars). */
const genCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () => Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `BK-${block()}-${block()}-${block()}`;
};

// --- Purchase ------------------------------------------------------------

/**
 * Begin a gift-card purchase. Creates a pending card + Paystack checkout.
 * @param {{ purchaserUserId:number, purchaserEmail:string, amount:number, recipientEmail:string, message?:string }} p
 * @returns {Promise<{ authorizationUrl:string, reference:string, giftCardId:number }>}
 */
export const startGiftCardPurchase = async ({ purchaserUserId, purchaserEmail, amount, recipientEmail, message }) => {
  const value = round2(Number(amount));
  if (!(value >= GIFT_CARD_MIN) || value > GIFT_CARD_MAX) {
    throw Object.assign(new Error(`Gift card amount must be between GHS ${GIFT_CARD_MIN} and GHS ${GIFT_CARD_MAX}`), { status: 400 });
  }
  if (!recipientEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(recipientEmail))) {
    throw Object.assign(new Error('A valid recipient email is required'), { status: 400 });
  }
  if (!purchaserEmail) throw Object.assign(new Error('Your account has no email for billing'), { status: 400 });

  const reference = `GIFT_${purchaserUserId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const card = await GiftCard.createPending({
    initialAmount: value,
    purchaserUserId,
    recipientEmail: String(recipientEmail).trim(),
    message: message ? String(message).slice(0, 500) : null,
    purchaseReference: reference,
  });
  if (!card) throw Object.assign(new Error('Could not create the gift card'), { status: 500 });

  const res = await paystack.initializeGiftCardPurchase(purchaserEmail, value, reference, {
    purpose: 'gift_card', giftCardId: card.id, purchaserUserId,
  });
  const authorizationUrl = res?.data?.authorization_url;
  if (!authorizationUrl) throw Object.assign(new Error('Could not start the payment. Please try again.'), { status: 502 });
  return { authorizationUrl, reference, giftCardId: card.id };
};

// --- Activation (on successful payment) ----------------------------------

/**
 * Issue the card after a verified charge. Idempotent (no-op if already active).
 * @param {string} reference the Paystack reference we created
 * @returns {Promise<{ handled: boolean, action?: string }>}
 */
export const activateGiftCardByReference = async (reference) => {
  const card = await GiftCard.findByReference(reference);
  if (!card) return { handled: false };
  if (card.status !== 'pending_payment') return { handled: true, action: 'already_issued' };

  // Generate a unique code (retry a couple of times on the rare collision).
  let code = genCode();
  for (let i = 0; i < 3; i++) {
    const [r] = /** @type {any} */ (await pool.execute(
      `UPDATE gift_cards SET code = ?, status = 'active', issuedAt = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending_payment'`, [code, card.id]
    ));
    if (r.affectedRows === 1) break;
    const fresh = await GiftCard.findById(card.id);
    if (fresh && fresh.status !== 'pending_payment') return { handled: true, action: 'already_issued' };
    code = genCode();
    if (i === 2) throw new Error('Could not issue a unique gift card code');
  }

  // Email the recipient (best-effort; never throws).
  const link = frontendBaseUrl() ? `${frontendBaseUrl()}/gift-cards/redeem?code=${encodeURIComponent(code)}` : null;
  const html = `
    <h2>You've received a Bonwire Kente gift card 🎁</h2>
    ${card.message ? `<p><em>"${String(card.message).replace(/</g, '&lt;')}"</em></p>` : ''}
    <p>Your gift card is worth <strong>${card.currency} ${card.initialAmount.toFixed(2)}</strong>.</p>
    <p>Your code: <strong style="font-size:1.2em">${code}</strong></p>
    ${link ? `<p><a href="${link}">Redeem it here</a> — sign in (or create an account) and the balance is added to your store credit.</p>` : '<p>Redeem it at checkout on Bonwire Kente.</p>'}
  `;
  await sendEmailSafely(card.recipientEmail, 'Your Bonwire Kente gift card', html);
  return { handled: true, action: 'issued' };
};

/** Webhook entry: handle a gift-card charge, else report not-ours.
 * @param {{ event: string, data: any }} evt */
export const processGiftCardWebhook = async ({ event, data }) => {
  if (event !== 'charge.success') return { handled: false };
  const ref = data?.reference;
  if (!ref) return { handled: false };
  return activateGiftCardByReference(ref);
};

// --- Store credit wallet -------------------------------------------------

/** @param {{ execute: Function }} conn @param {number} userId */
const ensureWallet = async (conn, userId) => {
  await conn.execute(`INSERT IGNORE INTO store_credit_wallets (userId) VALUES (?)`, [userId]);
};

/** @param {number} userId */
export const getStoreCreditBalance = async (userId) => {
  const [[row]] = /** @type {any} */ (await pool.execute(
    `SELECT balance FROM store_credit_wallets WHERE userId = ?`, [userId]
  ));
  return round2(Number(row?.balance) || 0);
};

/**
 * Redeem a gift card code into the caller's store credit (whole card).
 * @param {number} userId @param {string} rawCode
 */
export const redeemGiftCard = async (userId, rawCode) => {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) throw Object.assign(new Error('Enter a gift card code'), { status: 400 });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[card]] = /** @type {any} */ (await conn.execute(
      `SELECT * FROM gift_cards WHERE code = ? FOR UPDATE`, [code]
    ));
    if (!card) { await conn.rollback(); throw Object.assign(new Error('Invalid gift card code'), { status: 404 }); }
    if (card.status === 'redeemed') { await conn.rollback(); throw Object.assign(new Error('This gift card has already been redeemed'), { status: 409 }); }
    if (card.status !== 'active') { await conn.rollback(); throw Object.assign(new Error('This gift card is not active'), { status: 409 }); }

    const amount = round2(Number(card.initialAmount));
    await conn.execute(
      `UPDATE gift_cards SET status = 'redeemed', balance = 0, redeemedByUserId = ?, redeemedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [userId, card.id]
    );
    await ensureWallet(conn, userId);
    await conn.execute(
      `INSERT INTO store_credit_transactions (userId, type, amount, giftCardId, dedupeKey, note)
       VALUES (?, 'redeem', ?, ?, ?, ?)`,
      [userId, amount, card.id, `gift.redeem:${card.id}`, `Redeemed gift card ${code}`]
    );
    await conn.execute(
      `UPDATE store_credit_wallets SET balance = balance + ?, totalReceived = totalReceived + ? WHERE userId = ?`,
      [amount, amount, userId]
    );
    await conn.commit();
    return { amount, balance: await getStoreCreditBalance(userId) };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
};

// --- Split: apply PART of an order to store credit -----------------------

/**
 * Apply store credit to a PENDING order as a partial payment. The remainder is
 * paid via Paystack (the amount checks subtract orders.storeCreditApplied).
 * If the credit covers the whole order, returns { coversFull: true } so the
 * caller uses the whole-order path instead (no Paystack leg).
 * @param {{ userId:number, orderId:number }} p
 */
export const applyStoreCreditToOrder = async ({ userId, orderId }) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = /** @type {any} */ (await conn.execute(
      `SELECT id, userId, totalAmount, paymentStatus, orderStatus, paymentReference, storeCreditApplied
         FROM orders WHERE id = ? FOR UPDATE`, [orderId]
    ));
    if (!order || Number(order.userId) !== Number(userId)) { await conn.rollback(); return { status: 404, body: { message: 'Order not found' } }; }
    if (order.paymentStatus !== 'pending' || order.orderStatus !== 'pending' || order.paymentReference) {
      await conn.rollback(); return { status: 409, body: { message: 'Store credit can no longer be applied to this order' } };
    }
    if (round2(Number(order.storeCreditApplied)) > 0) {
      await conn.rollback(); return { status: 409, body: { message: 'Store credit has already been applied' } };
    }
    const total = round2(Number(order.totalAmount) || 0);
    await ensureWallet(conn, userId);
    const [[wallet]] = /** @type {any} */ (await conn.execute(`SELECT balance FROM store_credit_wallets WHERE userId = ? FOR UPDATE`, [userId]));
    const balance = round2(Number(wallet.balance) || 0);
    if (!(balance > 0)) { await conn.rollback(); return { status: 400, body: { message: 'You have no store credit' } }; }
    if (balance >= total) {
      // Credit covers everything — caller should use the whole-order path.
      await conn.rollback();
      return { status: 200, body: { coversFull: true, balance, total } };
    }

    const applied = balance; // partial
    const [ins] = /** @type {any} */ (await conn.execute(
      `INSERT IGNORE INTO store_credit_transactions (userId, type, amount, orderId, dedupeKey, note)
       VALUES (?, 'spend', ?, ?, ?, ?)`,
      [userId, -applied, orderId, `sc.spend:${orderId}`, `Store credit toward order ${orderId}`]
    ));
    if (ins.affectedRows !== 1) { await conn.rollback(); return { status: 409, body: { message: 'Store credit already applied' } }; }
    await conn.execute(`UPDATE store_credit_wallets SET balance = balance - ?, totalSpent = totalSpent + ? WHERE userId = ?`, [applied, applied, userId]);
    await conn.execute(`UPDATE orders SET storeCreditApplied = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [applied, orderId]);
    await conn.commit();
    return { status: 200, body: { applied, amountDue: round2(total - applied) } };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
};

/**
 * Return store credit spent on an order (idempotent) — call when an order with
 * a store-credit leg is cancelled, refunded or expires. Safe to call repeatedly.
 * @param {number} orderId
 * @param {{ execute: Function }} [executor] pool or a transaction connection
 */
export const returnStoreCreditForOrder = async (orderId, executor = pool) => {
  const [[order]] = /** @type {any} */ (await executor.execute(
    `SELECT userId, storeCreditApplied FROM orders WHERE id = ?`, [orderId]
  ));
  if (!order) return false;
  const amount = round2(Number(order.storeCreditApplied) || 0);
  if (!(amount > 0)) return false;
  const [ins] = /** @type {any} */ (await executor.execute(
    `INSERT IGNORE INTO store_credit_transactions (userId, type, amount, orderId, dedupeKey, note)
     VALUES (?, 'reverse', ?, ?, ?, ?)`,
    [order.userId, amount, orderId, `sc.reverse:${orderId}`, `Store credit returned for order ${orderId}`]
  ));
  if (ins.affectedRows !== 1) return false; // already returned
  await executor.execute(`INSERT IGNORE INTO store_credit_wallets (userId) VALUES (?)`, [order.userId]);
  await executor.execute(`UPDATE store_credit_wallets SET balance = balance + ?, totalSpent = GREATEST(totalSpent - ?, 0) WHERE userId = ?`, [amount, amount, order.userId]);
  return true;
};

/**
 * Safety net: return store credit for any cancelled/refunded order whose
 * credit leg was never returned. Runs hourly.
 */
export const reconcileStoreCreditRefunds = async ({ limit = 100 } = {}) => {
  const [rows] = /** @type {any} */ (await pool.execute(
    `SELECT o.id FROM orders o
      WHERE o.storeCreditApplied > 0
        AND (o.orderStatus = 'cancelled' OR o.paymentStatus = 'refunded')
        AND NOT EXISTS (SELECT 1 FROM store_credit_transactions t WHERE t.orderId = o.id AND t.type = 'reverse')
      LIMIT ?`, [limit]
  ));
  let returned = 0;
  for (const r of rows) { if (await returnStoreCreditForOrder(r.id)) returned++; }
  return { returned };
};

// --- Spend: pay a whole order from store credit --------------------------

/**
 * Pay a whole pending order from store credit (mirrors referral-credit).
 * @param {{ userId:number, orderId:number }} p
 */
export const payOrderWithStoreCredit = async ({ userId, orderId }) => {
  const conn = await pool.getConnection();
  let total;
  try {
    await conn.beginTransaction();
    const [[order]] = /** @type {any} */ (await conn.execute(
      `SELECT id, userId, totalAmount, paymentStatus, orderStatus, paymentReference FROM orders WHERE id = ? FOR UPDATE`, [orderId]
    ));
    if (!order || Number(order.userId) !== Number(userId)) { await conn.rollback(); return { status: 404, body: { message: 'Order not found' } }; }
    if (order.paymentStatus !== 'pending' || order.orderStatus !== 'pending' || order.paymentReference) {
      await conn.rollback();
      return { status: 409, body: { message: 'This order can no longer be paid with store credit' } };
    }
    total = round2(Number(order.totalAmount) || 0);
    if (!(total > 0)) { await conn.rollback(); return { status: 400, body: { message: 'Nothing to pay' } }; }

    await ensureWallet(conn, userId);
    const [[wallet]] = /** @type {any} */ (await conn.execute(
      `SELECT balance FROM store_credit_wallets WHERE userId = ? FOR UPDATE`, [userId]
    ));
    if (round2(Number(wallet.balance)) < total) {
      await conn.rollback();
      return { status: 400, body: { message: 'Your store credit does not cover the full order total', code: 'INSUFFICIENT_CREDIT' } };
    }

    // Dedupe on orderId so duplicate requests converge.
    const [ins] = /** @type {any} */ (await conn.execute(
      `INSERT IGNORE INTO store_credit_transactions (userId, type, amount, orderId, dedupeKey, note)
       VALUES (?, 'spend', ?, ?, ?, ?)`,
      [userId, -total, orderId, `sc.spend:${orderId}`, `Order ${orderId} paid with store credit`]
    ));
    if (ins.affectedRows !== 1) { await conn.rollback(); return { status: 409, body: { message: 'Order already paid' } }; }

    await conn.execute(
      `UPDATE store_credit_wallets SET balance = balance - ?, totalSpent = totalSpent + ? WHERE userId = ?`,
      [total, total, userId]
    );
    const [flip] = /** @type {any} */ (await conn.execute(
      `UPDATE orders SET paymentStatus = 'paid', paymentMethod = 'store_credit', orderStatus = 'processing',
              paymentSideEffects = COALESCE(paymentSideEffects, JSON_OBJECT()), updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND paymentStatus = 'pending'`, [orderId]
    ));
    if (flip.affectedRows !== 1) { await conn.rollback(); return { status: 409, body: { message: 'Order already paid' } }; }
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }

  // Same shared side effects as every other paid flip (escrow hold, stock,
  // commission snapshot, platform revenue, journal). Retried by recovery if it fails.
  const { applyPaidOrderSideEffects } = await import('./escrowService.js');
  const effects = await applyPaidOrderSideEffects(orderId, { source: 'store-credit' });
  return { status: 200, body: { message: 'Order paid with store credit', orderId, amount: total, effectsComplete: effects.complete } };
};
