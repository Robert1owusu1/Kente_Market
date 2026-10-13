// @ts-check
// FILE LOCATION: backend/Services/referralService.js
// DESCRIPTION: Referral (ambassador) commissions — REFERRAL_SYSTEM_DESIGN.md.
//   - attribution: link capture cookie (first link wins), bound at signup only,
//     self-referral / same-device / email-alias blocking;
//   - earning: one commission per verified paid order (UNIQUE orderId), funded
//     by the platform and capped per line at the platform commission left after
//     any admin coupon (F - Da), base = seller list price P;
//   - lifecycle: pending -> (under_review) -> available (escrow released) ->
//     withdrawn/spent from the wallet; refunds post one reversal per target;
//   - wallet: append-only ledger with unique dedupe keys; balance may only go
//     negative through reversals (debt offset against future earnings).
// Never trusts client amounts, rates or referrer ids.
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { ESCROW_RELEASE_DAYS } from '../config/businessConfig.js';
import { round2 } from '../../shared/pricing.js';
import { readCommissionSnapshot } from './commissionService.js';
import { recordFinancialEvent } from './ledgerService.js';

export const REFERRAL_COOKIE = 'kref';
export const DEVICE_COOKIE = 'kdid';
export const REFERRAL_COOKIE_DAYS = 30;
export const WINDOW_CHOICES = [30, 365];
export const MAX_REFERRAL_RATE = 0.5;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Keyed hash so raw device ids / IPs / payment instruments are never stored. */
export const keyedHash = (/** @type {string} */ kind, /** @type {string} */ value) =>
  crypto.createHmac('sha256', String(process.env.JWT_SECRET || 'referral')).update(`${kind}:${value}`).digest('hex');

/**
 * Canonical mailbox for alias detection: lower-case; "+tag" removed; for
 * Gmail/Googlemail dots in the local part are ignored too.
 * @param {string} email
 */
export const canonicalEmail = (email) => {
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  local = local.split('+')[0];
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
};

/** Last 9 digits of a phone number (Ghana numbers with/without +233 / 0 match). */
export const normPhone = (/** @type {any} */ p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : '';
};

/** Street + city, letters and digits only. */
export const normAddress = (/** @type {any} */ a) => {
  if (!a || typeof a !== 'object') return '';
  const street = a.addressLine1 || a.street || a.address || '';
  const city = a.city || '';
  const key = `${street}|${city}`.toLowerCase().replace(/[^a-z0-9|]/g, '');
  return key.replace(/\|/g, '').length >= 6 ? key : '';
};

/** @param {any} raw */
const parseJson = (raw) => {
  if (!raw) return null;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return null; }
};

// ---------------------------------------------------------------------------
// settings (stored in `settings`; missing/blank = OFF)
// ---------------------------------------------------------------------------

/**
 * @param {any} [executor]
 * @returns {Promise<{ enabled: boolean, standardRate: number | null, windowDays: number }>}
 */
export const getReferralSettings = async (executor = pool) => {
  const [rows] = await executor.execute(
    `SELECT settingKey, settingValue FROM settings WHERE settingKey IN ('referral.enabled','referral.standardRate','referral.windowDays')`
  );
  /** @type {Record<string, string>} */
  const m = {};
  for (const r of /** @type {any[]} */ (rows)) m[r.settingKey] = r.settingValue;
  const rate = m['referral.standardRate'] === undefined || m['referral.standardRate'] === '' ? NaN : Number(m['referral.standardRate']);
  const windowDays = Number(m['referral.windowDays']);
  return {
    enabled: m['referral.enabled'] === 'true',
    standardRate: Number.isFinite(rate) && rate >= 0 && rate <= MAX_REFERRAL_RATE ? rate : null,
    windowDays: WINDOW_CHOICES.includes(windowDays) ? windowDays : 30,
  };
};

// ---------------------------------------------------------------------------
// codes, devices, link capture
// ---------------------------------------------------------------------------

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const REFERRAL_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

const newCode = () => {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
};

/**
 * The user's referral code, created on first use (every registered user is an
 * ambassador, R1). Retries on the (unlikely) unique collision.
 * @param {number} userId
 * @returns {Promise<string>}
 */
export const ensureReferralCode = async (userId) => {
  const [[row]] = await pool.execute(`SELECT referralCode FROM users WHERE id = ?`, [userId]);
  if (row?.referralCode) return row.referralCode;
  for (let i = 0; i < 5; i += 1) {
    try {
      const code = newCode();
      const [r] = await pool.execute(
        `UPDATE users SET referralCode = ? WHERE id = ? AND referralCode IS NULL`, [code, userId]
      );
      if (/** @type {any} */ (r).affectedRows === 1) return code;
      const [[again]] = await pool.execute(`SELECT referralCode FROM users WHERE id = ?`, [userId]);
      if (again?.referralCode) return again.referralCode;
    } catch (err) {
      if (/** @type {any} */ (err)?.code !== 'ER_DUP_ENTRY') throw err;
    }
  }
  throw new Error('Could not allocate a referral code');
};

/**
 * Ambassador behind a code, only if it may refer right now.
 * @param {any} code
 */
export const findActiveReferrer = async (code) => {
  const c = String(code || '').trim().toUpperCase();
  if (!REFERRAL_CODE_RE.test(c)) return null;
  const [[u]] = await pool.execute(
    `SELECT id, email, emailCanonical, isActive, is_email_verified, ambassadorSuspended, signupIpHash
       FROM users WHERE referralCode = ?`, [c]
  );
  if (!u || !u.isActive || u.ambassadorSuspended) return null;
  return { ...u, code: c };
};

/**
 * Record that a user was seen on a device (login, signup, OAuth). Best-effort.
 * @param {number} userId
 * @param {string | undefined | null} deviceId raw cookie value
 */
export const recordDevice = async (userId, deviceId) => {
  if (!userId || !deviceId || typeof deviceId !== 'string' || deviceId.length < 16 || deviceId.length > 100) return;
  try {
    await pool.execute(
      `INSERT INTO user_devices (userId, deviceHash) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE lastSeenAt = CURRENT_TIMESTAMP`,
      [userId, keyedHash('device', deviceId)]
    );
  } catch (err) {
    console.warn(` recordDevice failed: ${/** @type {any} */ (err).message}`);
  }
};

/** Signed capture token stored in the httpOnly referral cookie. */
export const signVisitToken = (/** @type {string} */ code) =>
  jwt.sign({ purpose: 'referral_visit', code }, String(process.env.JWT_SECRET), { expiresIn: `${REFERRAL_COOKIE_DAYS}d` });

/** @param {any} token @returns {string | null} code */
export const readVisitToken = (token) => {
  if (!token || typeof token !== 'string') return null;
  try {
    const d = /** @type {any} */ (jwt.verify(token, String(process.env.JWT_SECRET)));
    return d?.purpose === 'referral_visit' && REFERRAL_CODE_RE.test(d.code) ? d.code : null;
  } catch {
    return null;
  }
};

/**
 * Bind a NEW account to the referrer named in its capture cookie (R9, R11).
 * Called by email registration and Google signup right after the user row is
 * created. Returns why attribution was refused, or null when bound / no cookie.
 * Never throws (registration must not fail because of referral problems).
 * @param {{ userId: number, email: string, visitToken?: string | null, deviceId?: string | null, ip?: string | null }} p
 * @returns {Promise<{ bound: boolean, reason: string | null, referrerId?: number }>}
 */
export const bindReferralAtSignup = async ({ userId, email, visitToken, deviceId, ip }) => {
  try {
    const canon = canonicalEmail(email);
    const ipHash = ip ? keyedHash('ip', ip) : null;
    await pool.execute(`UPDATE users SET emailCanonical = ?, signupIpHash = COALESCE(signupIpHash, ?) WHERE id = ?`, [canon, ipHash, userId]);
    await recordDevice(userId, deviceId);

    const code = readVisitToken(visitToken);
    if (!code) return { bound: false, reason: visitToken ? 'invalid_token' : null };
    const referrer = await findActiveReferrer(code);
    if (!referrer) return { bound: false, reason: 'unknown_or_inactive_referrer' };
    if (referrer.id === userId) return { bound: false, reason: 'self' };
    if (canonicalEmail(referrer.email) === canon) return { bound: false, reason: 'email_alias' };
    if (deviceId) {
      const [seen] = await pool.execute(
        `SELECT 1 FROM user_devices WHERE userId = ? AND deviceHash = ? LIMIT 1`, [referrer.id, keyedHash('device', deviceId)]
      );
      if (/** @type {any[]} */ (seen).length > 0) return { bound: false, reason: 'same_device' };
    }
    // Only a brand-new account with no orders can be referred (existing customers cannot).
    const [r] = await pool.execute(
      `UPDATE users SET referredBy = ?, referredAt = NOW()
        WHERE id = ? AND referredBy IS NULL
          AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.userId = ?)`,
      [referrer.id, userId, userId]
    );
    if (/** @type {any} */ (r).affectedRows !== 1) return { bound: false, reason: 'already_bound_or_existing_customer' };
    return { bound: true, reason: null, referrerId: referrer.id };
  } catch (err) {
    console.warn(` bindReferralAtSignup failed for user ${userId}: ${/** @type {any} */ (err).message}`);
    return { bound: false, reason: 'error' };
  }
};

// ---------------------------------------------------------------------------
// calculation (pure)
// ---------------------------------------------------------------------------

/**
 * Per-line referral: min(rate x P, F - Da), floored at 0 (R3–R5, R8).
 * Lines in `excludeVendorIds` (refunded per vendor) and, when `fullRefund`,
 * every line contribute nothing.
 * @param {{ lines: Array<{ vendorId: any, P: number, F: number, Da: number }> }} snapshot
 * @param {number} rate
 * @param {{ excludeVendorIds?: Set<string>, fullRefund?: boolean }} [opts]
 * @returns {{ base: number, cap: number, amount: number }}
 */
export const computeReferralAmount = (snapshot, rate, { excludeVendorIds = new Set(), fullRefund = false } = {}) => {
  let base = 0;
  let cap = 0;
  let amount = 0;
  for (const l of snapshot?.lines || []) {
    if (fullRefund) continue;
    if (l.vendorId != null && excludeVendorIds.has(String(l.vendorId))) continue;
    const P = Math.max(0, Number(l.P) || 0);
    const room = Math.max(0, (Number(l.F) || 0) - (Number(l.Da) || 0));
    base += P;
    cap += room;
    amount += Math.min(Math.max(0, rate) * P, room);
  }
  return { base: round2(base), cap: round2(cap), amount: Math.max(0, round2(amount)) };
};

// ---------------------------------------------------------------------------
// wallet ledger
// ---------------------------------------------------------------------------

/**
 * Append one ledger row and apply its effect, inside the caller's transaction.
 * Returns false (and changes nothing) when the dedupe key was already posted.
 * @param {any} conn
 * @param {{ userId: number, type: string, dedupeKey: string, commissionId?: number | null, orderId?: number | null, withdrawalId?: number | null, note?: string | null,
 *           balance?: number, reserved?: number, earned?: number, withdrawn?: number, spent?: number }} e
 */
export const postReferralLedger = async (conn, e) => {
  const balance = round2(e.balance || 0);
  const [ins] = await conn.execute(
    `INSERT IGNORE INTO referral_ledger (userId, type, amount, commissionId, orderId, withdrawalId, dedupeKey, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [e.userId, e.type, balance, e.commissionId ?? null, e.orderId ?? null, e.withdrawalId ?? null, e.dedupeKey, e.note ?? null]
  );
  if (ins.affectedRows !== 1) return false;
  await conn.execute(`INSERT IGNORE INTO referral_wallets (userId) VALUES (?)`, [e.userId]);
  await conn.execute(
    `UPDATE referral_wallets
        SET balance = balance + ?, reserved = reserved + ?, totalEarned = totalEarned + ?,
            totalWithdrawn = totalWithdrawn + ?, totalSpent = totalSpent + ?
      WHERE userId = ?`,
    [balance, round2(e.reserved || 0), round2(e.earned || 0), round2(e.withdrawn || 0), round2(e.spent || 0), e.userId]
  );
  return true;
};

/** @param {number} userId */
export const getReferralWallet = async (userId) => {
  const [[w]] = await pool.execute(`SELECT * FROM referral_wallets WHERE userId = ?`, [userId]);
  const n = (/** @type {any} */ v) => round2(Number(v) || 0);
  return {
    balance: n(w?.balance), reserved: n(w?.reserved), totalEarned: n(w?.totalEarned),
    totalWithdrawn: n(w?.totalWithdrawn), totalSpent: n(w?.totalSpent),
  };
};

// ---------------------------------------------------------------------------
// earning (paid side effect)
// ---------------------------------------------------------------------------

/**
 * Store a keyed hash of the paying instrument (card signature, or MoMo/bank
 * bin+last4+bank) on the order — never the raw value. Best-effort.
 * @param {number} orderId
 * @param {any} charge verified provider transaction
 */
export const recordPaymentInstrument = async (orderId, charge) => {
  const a = charge?.authorization;
  if (!a || typeof a !== 'object') return;
  const raw = a.signature
    ? `sig:${a.signature}`
    : (a.last4 ? `${charge.channel || a.channel || ''}:${a.bank || ''}:${a.bin || ''}:${a.last4}` : '');
  if (!raw) return;
  try {
    await pool.execute(
      `UPDATE orders SET paymentInstrumentHash = ? WHERE id = ? AND paymentInstrumentHash IS NULL`,
      [keyedHash('instrument', raw), orderId]
    );
  } catch (err) {
    console.warn(` recordPaymentInstrument failed for order ${orderId}: ${/** @type {any} */ (err).message}`);
  }
};

/**
 * Abuse signals between buyer and referrer (R11). Any signal parks the
 * commission in `under_review`; none of them blocks the purchase itself.
 * @param {any} order
 * @param {any} customer
 * @param {any} referrer
 * @returns {Promise<string[]>}
 */
const reviewSignals = async (order, customer, referrer) => {
  /** @type {string[]} */
  const reasons = [];
  if (order.paymentInstrumentHash) {
    const [same] = await pool.execute(
      `SELECT 1 FROM orders WHERE userId = ? AND paymentInstrumentHash = ? LIMIT 1`, [referrer.id, order.paymentInstrumentHash]
    );
    if (/** @type {any[]} */ (same).length) reasons.push('same_payment_instrument');
  }
  const [dev] = await pool.execute(
    `SELECT 1 FROM user_devices a JOIN user_devices b ON a.deviceHash = b.deviceHash
      WHERE a.userId = ? AND b.userId = ? LIMIT 1`, [customer.id, referrer.id]
  );
  if (/** @type {any[]} */ (dev).length) reasons.push('shared_device');

  const ship = parseJson(order.shippingAddress) || {};
  const [refAddrs] = await pool.execute(`SELECT phone, addressLine1, city FROM user_addresses WHERE userId = ?`, [referrer.id]);
  const refPhones = new Set([normPhone(referrer.phone), ...(/** @type {any[]} */ (refAddrs)).map((a) => normPhone(a.phone))].filter(Boolean));
  const buyerPhones = [normPhone(ship.phone), normPhone(customer.phone)].filter(Boolean);
  if (buyerPhones.some((p) => refPhones.has(p))) reasons.push('same_phone');
  const refAddrKeys = new Set((/** @type {any[]} */ (refAddrs)).map((a) => normAddress(a)).filter(Boolean));
  const shipKey = normAddress(ship);
  if (shipKey && refAddrKeys.has(shipKey)) reasons.push('same_delivery_address');
  if (customer.signupIpHash && customer.signupIpHash === referrer.signupIpHash) reasons.push('same_signup_ip');
  return reasons;
};

/**
 * Paid side effect `referralRecorded`. Creates at most ONE commission per
 * order (UNIQUE orderId — duplicate webhooks, verify retries and concurrent
 * workers all converge). Returns true when the order was handled (commission
 * created, already present, or not qualifying) so the marker can be set.
 * @param {number} orderId
 * @returns {Promise<boolean>}
 */
export const recordReferralForOrder = async (orderId) => {
  const [[order]] = await pool.execute(
    `SELECT id, userId, paymentStatus, orderStatus, paymentMethod, created_at, shippingAddress, paymentInstrumentHash
       FROM orders WHERE id = ?`, [orderId]
  );
  if (!order) return true;
  // Only a backend-verified paid order qualifies (R2).
  if (order.paymentStatus !== 'paid' || order.orderStatus === 'cancelled') return true;
  // Engineer default (design §6): orders paid FROM referral earnings earn nothing.
  if (order.paymentMethod === 'referral_credit') return true;

  const [[customer]] = await pool.execute(
    `SELECT id, phone, referredBy, referredAt, signupIpHash FROM users WHERE id = ?`, [order.userId]
  );
  if (!customer?.referredBy || !customer.referredAt) return true;
  const [[referrer]] = await pool.execute(
    `SELECT id, phone, isActive, ambassadorSuspended, ambassadorTier, ambassadorRate, signupIpHash FROM users WHERE id = ?`,
    [customer.referredBy]
  );
  if (!referrer || referrer.id === customer.id || !referrer.isActive || referrer.ambassadorSuspended) return true;

  const settings = await getReferralSettings();
  if (!settings.enabled) return true;
  const windowEnd = new Date(new Date(customer.referredAt).getTime() + settings.windowDays * 86400000);
  if (new Date(order.created_at) > windowEnd) return true;

  const superRate = referrer.ambassadorTier === 'super' && referrer.ambassadorRate !== null ? Number(referrer.ambassadorRate) : null;
  const rate = superRate !== null && Number.isFinite(superRate) ? superRate : settings.standardRate;
  if (rate === null || !(rate > 0)) return true;

  const snapshot = await readCommissionSnapshot(orderId);
  if (!snapshot) {
    console.warn(` referral: order ${orderId} has no commission snapshot — not eligible`);
    return true;
  }
  const { base, cap, amount } = computeReferralAmount(snapshot, rate);
  if (amount <= 0) return true;

  const reasons = await reviewSignals(order, customer, referrer);
  const status = reasons.length ? 'under_review' : 'pending';
  const [ins] = await pool.execute(
    `INSERT IGNORE INTO referral_commissions
       (orderId, referrerId, customerId, base, rate, cap, amount, currentAmount, status, reviewReasons)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [orderId, referrer.id, customer.id, base, rate, cap, amount, amount, status, reasons.length ? JSON.stringify(reasons) : null]
  );
  if (/** @type {any} */ (ins).affectedRows === 1) {
    await recordFinancialEvent({
      eventType: 'referral.pending',
      direction: 'info',
      amount,
      orderId,
      reference: `referral:${orderId}`,
      dedupeKey: `referral.pending:${orderId}`,
      payload: { referrerId: referrer.id, rate, base, cap, status, reasons },
    }).catch(() => {});
  }
  return true;
};

/**
 * Safety net for a crash between the paid flip and the referral step: paid
 * orders of referred customers with no commission row and no marker.
 * Bounded; uses the same idempotent recorder.
 * @param {{ limit?: number }} [opts]
 */
export const recordMissingReferralCommissions = async ({ limit = 100 } = {}) => {
  const [rows] = await pool.execute(
    `SELECT o.id FROM orders o
       JOIN users u ON u.id = o.userId AND u.referredBy IS NOT NULL
      WHERE o.paymentStatus = 'paid' AND o.orderStatus <> 'cancelled'
        AND o.paymentSideEffects IS NOT NULL
        AND (JSON_EXTRACT(o.paymentSideEffects, '$.referralRecorded') IS NULL
             OR JSON_EXTRACT(o.paymentSideEffects, '$.referralRecorded') = false)
        AND o.updated_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)
        AND NOT EXISTS (SELECT 1 FROM referral_commissions rc WHERE rc.orderId = o.id)
      ORDER BY o.id LIMIT ${Math.max(1, Math.min(500, limit | 0))}`
  );
  let handled = 0;
  for (const { id } of /** @type {any[]} */ (rows)) {
    try {
      if (await recordReferralForOrder(id)) {
        await pool.execute(
          `UPDATE orders SET paymentSideEffects = JSON_SET(paymentSideEffects, '$.referralRecorded', true) WHERE id = ?`, [id]
        );
        handled += 1;
      }
    } catch (err) {
      console.error(` recordMissingReferralCommissions: order ${id}: ${/** @type {any} */ (err).message}`);
    }
  }
  return handled;
};

// ---------------------------------------------------------------------------
// lifecycle: availability, review, refunds
// ---------------------------------------------------------------------------

/**
 * Has the order completed successfully (R2/R12)? Vendor items: every
 * non-voided escrow allocation released to the vendor and none still
 * pending/held. Platform-only orders: delivered and past the release window.
 * @param {any} conn
 * @param {number} orderId
 */
export const isOrderComplete = async (conn, orderId) => {
  const [[o]] = await conn.execute(
    `SELECT paymentStatus, orderStatus, deliveredAt FROM orders WHERE id = ?`, [orderId]
  );
  if (!o || o.paymentStatus !== 'paid' || o.orderStatus === 'cancelled') return false;
  const [[a]] = await conn.execute(
    `SELECT COUNT(*) AS total, SUM(status IN ('pending','held')) AS open,
            SUM(status IN ('available','releasing','released')) AS done
       FROM escrow_allocations WHERE orderId = ?`, [orderId]
  );
  // An order with vendor allocations completes only through escrow release;
  // if every allocation was voided (refund) it never completes.
  if (Number(a?.total) > 0) return Number(a?.open) === 0 && Number(a?.done) > 0;
  // No vendor allocation (platform-owned goods only).
  if (o.orderStatus !== 'delivered' || !o.deliveredAt) return false;
  return new Date(o.deliveredAt).getTime() + ESCROW_RELEASE_DAYS * 86400000 <= Date.now();
};

/**
 * pending -> available for completed orders; credits the wallet exactly once.
 * Bounded scan; `orderIds` scopes it (tests / targeted runs).
 * @param {{ limit?: number, orderIds?: number[] }} [opts]
 */
export const promoteReferralCommissions = async ({ limit = 100, orderIds } = {}) => {
  const scope = Array.isArray(orderIds) && orderIds.length
    ? ` AND orderId IN (${orderIds.map((id) => Number(id) | 0).join(',')})` : '';
  const [rows] = await pool.execute(
    `SELECT id FROM referral_commissions WHERE status = 'pending'${scope}
      ORDER BY updated_at ASC LIMIT ${Math.max(1, Math.min(500, limit | 0))}`
  );
  let promoted = 0;
  for (const { id } of /** @type {any[]} */ (rows)) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[c]] = await conn.execute(`SELECT * FROM referral_commissions WHERE id = ? FOR UPDATE`, [id]);
      if (!c || c.status !== 'pending' || !(await isOrderComplete(conn, c.orderId))) {
        await conn.rollback();
        // touch so the bounded scan rotates
        await pool.execute(`UPDATE referral_commissions SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`, [id]);
        continue;
      }
      const amt = round2(Number(c.currentAmount) || 0);
      if (amt > 0) {
        await postReferralLedger(conn, {
          userId: c.referrerId, type: 'earn', balance: amt, earned: amt, commissionId: c.id, orderId: c.orderId,
          dedupeKey: `ref.earn:${c.id}`, note: 'Referral commission available',
        });
      }
      await conn.execute(
        `UPDATE referral_commissions SET status = ?, creditedAmount = ?, availableAt = NOW() WHERE id = ?`,
        [amt > 0 ? 'available' : 'cancelled', amt, c.id]
      );
      await recordFinancialEvent({
        eventType: 'referral.available', direction: 'info', amount: amt, orderId: c.orderId,
        reference: `referral:${c.orderId}`, dedupeKey: `referral.available:${c.id}`,
        payload: { commissionId: c.id, referrerId: c.referrerId }, connection: conn,
      });
      await conn.commit();
      promoted += 1;
    } catch (err) {
      await conn.rollback().catch(() => {});
      console.error(` promoteReferralCommissions: commission ${id}: ${/** @type {any} */ (err).message}`);
    } finally {
      conn.release();
    }
  }
  return promoted;
};

/**
 * Admin decision on an under_review commission (approve -> pending, reject ->
 * cancelled). Never touches money directly; availability still requires a
 * completed order. Caller audits.
 * @param {number} id
 * @param {'approve' | 'reject'} decision
 * @param {{ adminId: number, note: string }} p
 */
export const reviewReferralCommission = async (id, decision, { adminId, note }) => {
  const next = decision === 'approve' ? 'pending' : 'cancelled';
  const [r] = await pool.execute(
    `UPDATE referral_commissions SET status = ?, reviewedBy = ?, reviewedAt = NOW(), reviewNote = ?
      WHERE id = ? AND status = 'under_review'`,
    [next, adminId, String(note).slice(0, 1000), id]
  );
  return /** @type {any} */ (r).affectedRows === 1 ? next : null;
};

/**
 * Re-evaluate a commission after a refund/cancel (R12). Target = referral on
 * the lines not refunded (0 for a full refund/cancel). Posts the difference
 * once (dedupe key carries the target), so retries and concurrent refund
 * paths cannot double-reverse. An already-credited amount is debited from the
 * wallet, which may go negative (debt offset against future earnings).
 * @param {number | string} orderId
 * @returns {Promise<{ changed: boolean, target?: number }>}
 */
export const adjustReferralForRefund = async (orderId) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[c]] = await conn.execute(`SELECT * FROM referral_commissions WHERE orderId = ? FOR UPDATE`, [orderId]);
    if (!c || c.status === 'cancelled' || c.status === 'reversed') {
      await conn.rollback();
      return { changed: false };
    }
    const [[o]] = await conn.execute(`SELECT paymentStatus, orderStatus FROM orders WHERE id = ?`, [orderId]);
    const fullRefund = !o || o.paymentStatus === 'refunded' || o.orderStatus === 'cancelled';
    const [refunded] = await conn.execute(
      `SELECT DISTINCT vendorId FROM escrow_allocations
        WHERE orderId = ? AND status = 'failed' AND (reason LIKE '%refund%' OR reason LIKE '%clawed back%')`, [orderId]
    );
    const exclude = new Set((/** @type {any[]} */ (refunded)).map((r) => String(r.vendorId)));
    const snapshot = await readCommissionSnapshot(orderId, conn);
    const target = Math.min(
      round2(Number(c.currentAmount) || 0),
      computeReferralAmount(snapshot || { lines: [] }, Number(c.rate), { excludeVendorIds: exclude, fullRefund }).amount
    );
    const current = round2(Number(c.currentAmount) || 0);
    if (target >= current) {
      await conn.rollback();
      return { changed: false, target };
    }
    if (c.status === 'available') {
      const credited = round2(Number(c.creditedAmount) || 0);
      const delta = round2(target - credited);
      if (delta < 0) {
        await postReferralLedger(conn, {
          userId: c.referrerId, type: 'reverse', balance: delta, earned: delta, commissionId: c.id, orderId: c.orderId,
          dedupeKey: `ref.rev:${c.id}:${Math.round(target * 100)}`, note: fullRefund ? 'Order refunded' : 'Partial refund',
        });
      }
      await conn.execute(
        `UPDATE referral_commissions SET currentAmount = ?, creditedAmount = ?, status = ? WHERE id = ?`,
        [target, target, target <= 0 ? 'reversed' : 'available', c.id]
      );
    } else {
      await conn.execute(
        `UPDATE referral_commissions SET currentAmount = ?, status = ? WHERE id = ?`,
        [target, target <= 0 ? 'cancelled' : c.status, c.id]
      );
    }
    await recordFinancialEvent({
      eventType: 'referral.adjusted', direction: 'info', amount: round2(current - target), orderId: c.orderId,
      reference: `referral:${c.orderId}`, dedupeKey: `referral.adjusted:${c.id}:${Math.round(target * 100)}`,
      payload: { commissionId: c.id, from: current, to: target, fullRefund }, connection: conn,
    });
    await conn.commit();
    return { changed: true, target };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
};

/**
 * Safety net: commissions whose order has since been refunded/cancelled (or
 * had a vendor refunded) but were not adjusted (crash between the refund and
 * the adjustment). Bounded.
 * @param {{ limit?: number }} [opts]
 */
export const reconcileReferralRefunds = async ({ limit = 100 } = {}) => {
  const [rows] = await pool.execute(
    `SELECT rc.orderId FROM referral_commissions rc JOIN orders o ON o.id = rc.orderId
      WHERE rc.status IN ('pending','under_review','available')
        AND (o.paymentStatus = 'refunded' OR o.orderStatus = 'cancelled'
             OR EXISTS (SELECT 1 FROM escrow_allocations ea WHERE ea.orderId = rc.orderId AND ea.status = 'failed'
                         AND (ea.reason LIKE '%refund%' OR ea.reason LIKE '%clawed back%')))
      ORDER BY rc.updated_at ASC LIMIT ${Math.max(1, Math.min(500, limit | 0))}`
  );
  let changed = 0;
  for (const { orderId } of /** @type {any[]} */ (rows)) {
    try {
      if ((await adjustReferralForRefund(orderId)).changed) changed += 1;
      else await pool.execute(`UPDATE referral_commissions SET updated_at = CURRENT_TIMESTAMP WHERE orderId = ?`, [orderId]);
    } catch (err) {
      console.error(` reconcileReferralRefunds: order ${orderId}: ${/** @type {any} */ (err).message}`);
    }
  }
  return changed;
};
