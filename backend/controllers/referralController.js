// FILE LOCATION: backend/controllers/referralController.js
// DESCRIPTION: Referral (ambassador) API — REFERRAL_SYSTEM_DESIGN.md.
//   Ambassador (any signed-in user): own link, wallet, own commissions with
//   the buyer masked, payout account, withdraw, pay an order with earnings.
//   Admin: settings, ambassador tiers/rates/suspension, commission review,
//   withdrawal verification (Paystack evidence only — no manual mark-paid).
import pool from '../config/db.js';
import paystackServices from '../Services/paystackservices.js';
import { auditFromRequest } from '../utils/auditLog.js';
import { cookieSameSite, cookieSecure } from '../config/cookieConfig.js';
import { parseRate } from './commissionController.js';
import { parseWithdrawalAmountMinor } from './vendorController.js';
import { resolveCommissionRate } from '../Services/commissionService.js';
import {
  REFERRAL_COOKIE, REFERRAL_COOKIE_DAYS, WINDOW_CHOICES,
  ensureReferralCode, findActiveReferrer, signVisitToken, readVisitToken,
  getReferralSettings, getReferralWallet, reviewReferralCommission,
} from '../Services/referralService.js';
import {
  requestReferralWithdrawal, payOrderWithReferralCredit, reconcileReferralWithdrawals, MIN_REFERRAL_WITHDRAWAL,
} from '../Services/referralPayoutService.js';
import { frontendBaseUrl } from '../config/frontendOrigins.js';

const REQUEST_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const n2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const maskName = (first) => (first ? `${String(first).charAt(0).toUpperCase()}***` : 'Customer');
const maskOrder = (num) => (num ? `•••${String(num).slice(-4)}` : '—');

/** Global platform commission rate: the ceiling for referral rates (R7). */
const platformCeiling = async () => resolveCommissionRate({});

// ---------------------------------------------------------------------------
// Ambassador
// ---------------------------------------------------------------------------

// @route POST /api/referrals/visit   (public)
// First link wins: an existing capture cookie is never replaced. The reply is
// the same for valid and invalid codes.
export const captureReferralVisit = async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!readVisitToken(req.cookies?.[REFERRAL_COOKIE])) {
      const referrer = await findActiveReferrer(code);
      if (referrer) {
        res.cookie(REFERRAL_COOKIE, signVisitToken(referrer.code), {
          httpOnly: true,
          secure: cookieSecure(req),
          sameSite: cookieSameSite(),
          maxAge: REFERRAL_COOKIE_DAYS * 24 * 60 * 60 * 1000,
          path: '/',
        });
      }
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('captureReferralVisit error:', error.message);
    res.json({ ok: true });
  }
};

// @route GET /api/referrals/me
export const getMyReferrals = async (req, res) => {
  try {
    const userId = req.user.id;
    const code = await ensureReferralCode(userId);
    const settings = await getReferralSettings();
    const [[me]] = await pool.execute(
      `SELECT ambassadorTier, ambassadorRate, ambassadorSuspended, referralRecipientLabel FROM users WHERE id = ?`, [userId]
    );
    const rate = me.ambassadorTier === 'super' && me.ambassadorRate !== null ? Number(me.ambassadorRate) : settings.standardRate;
    const [commissions] = await pool.execute(
      `SELECT rc.id, rc.status, rc.amount, rc.currentAmount, rc.created_at, rc.availableAt,
              o.orderNumber, u.firstName
         FROM referral_commissions rc
         JOIN orders o ON o.id = rc.orderId
         JOIN users u ON u.id = rc.customerId
        WHERE rc.referrerId = ?
        ORDER BY rc.id DESC LIMIT 100`, [userId]
    );
    const [[{ referred }]] = await pool.execute(`SELECT COUNT(*) AS referred FROM users WHERE referredBy = ?`, [userId]);
    const [withdrawals] = await pool.execute(
      `SELECT id, amount, status, created_at, settledAt FROM referral_withdrawals WHERE userId = ? ORDER BY id DESC LIMIT 50`, [userId]
    );
    res.json({
      code,
      link: `${frontendBaseUrl()}/?ref=${code}`,
      enabled: settings.enabled,
      tier: me.ambassadorTier,
      rate,
      windowDays: settings.windowDays,
      suspended: Boolean(me.ambassadorSuspended),
      referredCount: Number(referred),
      wallet: await getReferralWallet(userId),
      minWithdrawal: MIN_REFERRAL_WITHDRAWAL,
      payoutAccount: me.referralRecipientLabel || null,
      // Buyer identity is masked: an ambassador sees that a purchase happened, not who.
      commissions: commissions.map((c) => ({
        id: c.id,
        status: c.status,
        amount: n2(c.currentAmount),
        originalAmount: n2(c.amount),
        customer: maskName(c.firstName),
        order: maskOrder(c.orderNumber),
        createdAt: c.created_at,
        availableAt: c.availableAt,
      })),
      withdrawals,
    });
  } catch (error) {
    console.error('getMyReferrals error:', error);
    res.status(500).json({ message: 'Failed to load referral account' });
  }
};

// @route POST /api/referrals/payout-account   { type: 'mobile_money'|'bank', name, accountNumber, bankCode }
export const setPayoutAccount = async (req, res) => {
  try {
    const { type, name, accountNumber, bankCode } = req.body || {};
    if (!['mobile_money', 'bank'].includes(type)) return res.status(400).json({ message: 'type must be mobile_money or bank' });
    if (typeof name !== 'string' || name.trim().length < 2 || name.length > 100) return res.status(400).json({ message: 'Account name is required' });
    if (typeof accountNumber !== 'string' || !/^\d{8,20}$/.test(accountNumber.trim())) return res.status(400).json({ message: 'Invalid account number' });
    if (typeof bankCode !== 'string' || !/^[A-Za-z0-9]{2,20}$/.test(bankCode.trim())) return res.status(400).json({ message: 'Invalid bank / network code' });
    const [[u]] = await pool.execute(`SELECT is_email_verified FROM users WHERE id = ?`, [req.user.id]);
    if (!u?.is_email_verified) return res.status(403).json({ message: 'Verify your email first' });
    const resp = type === 'mobile_money'
      ? await paystackServices.createMomoRecipient(name.trim(), accountNumber.trim(), bankCode.trim())
      : await paystackServices.createTransferRecipient('ghipss', name.trim(), accountNumber.trim(), bankCode.trim());
    const code = resp?.data?.recipient_code;
    if (!code) return res.status(502).json({ message: 'Could not register the payout account' });
    const label = `${type === 'mobile_money' ? 'MoMo' : 'Bank'} ${bankCode.trim().toUpperCase()} •••${accountNumber.trim().slice(-4)}`;
    await pool.execute(`UPDATE users SET referralRecipientCode = ?, referralRecipientLabel = ? WHERE id = ?`, [code, label, req.user.id]);
    res.json({ message: 'Payout account saved', payoutAccount: label });
  } catch (error) {
    console.error('setPayoutAccount error:', error.message);
    res.status(502).json({ message: 'Could not register the payout account' });
  }
};

// @route POST /api/referrals/withdraw   { amount, requestKey }
export const withdrawReferralEarnings = async (req, res) => {
  try {
    const amountMinor = parseWithdrawalAmountMinor(req.body?.amount);
    if (amountMinor === null) return res.status(400).json({ message: 'Enter a valid amount' });
    const requestKey = req.body?.requestKey;
    if (typeof requestKey !== 'string' || !REQUEST_KEY_RE.test(requestKey)) return res.status(400).json({ message: 'A request key is required' });
    const { status, body } = await requestReferralWithdrawal({ userId: req.user.id, amountMinor, requestKey });
    res.status(status).json(body);
  } catch (error) {
    console.error('withdrawReferralEarnings error:', error);
    res.status(500).json({ message: 'Withdrawal failed' });
  }
};

// @route POST /api/referrals/pay-order   { orderId }
export const payOrderWithEarnings = async (req, res) => {
  try {
    const orderId = parseInt(req.body?.orderId, 10);
    if (!Number.isInteger(orderId) || orderId <= 0) return res.status(400).json({ message: 'Invalid order id' });
    if (req.body?.acceptFinal !== true) {
      return res.status(400).json({ message: 'Orders paid with referral earnings are final and cannot be refunded. Confirm to continue.', code: 'CONFIRM_FINAL' });
    }
    const { status, body } = await payOrderWithReferralCredit({ userId: req.user.id, orderId });
    res.status(status).json(body);
  } catch (error) {
    console.error('payOrderWithEarnings error:', error);
    res.status(500).json({ message: 'Payment with referral earnings failed' });
  }
};

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

// @route GET /api/admin/referrals/settings
export const adminGetReferralSettings = async (req, res) => {
  try {
    res.json({ ...(await getReferralSettings()), platformRate: await platformCeiling(), windowChoices: WINDOW_CHOICES });
  } catch {
    res.status(500).json({ message: 'Failed to load referral settings' });
  }
};

// @route PUT /api/admin/referrals/settings   { enabled?, standardRate?, windowDays? }
export const adminUpdateReferralSettings = async (req, res) => {
  try {
    const before = await getReferralSettings();
    const { enabled, standardRate, windowDays } = req.body || {};
    /** @type {Array<[string, string]>} */
    const writes = [];
    const ceiling = await platformCeiling();
    if (standardRate !== undefined) {
      if (standardRate === null || standardRate === '') {
        writes.push(['referral.standardRate', '']);
      } else {
        const r = parseRate(standardRate);
        if (r === null) return res.status(400).json({ message: 'Rate must be a decimal between 0 and 0.5, at most 4 decimal places' });
        if (r > ceiling) return res.status(400).json({ message: `Referral rate cannot exceed the platform commission (${(ceiling * 100).toFixed(2)}%)` });
        writes.push(['referral.standardRate', String(r)]);
      }
    }
    if (windowDays !== undefined) {
      if (!WINDOW_CHOICES.includes(Number(windowDays))) return res.status(400).json({ message: 'windowDays must be 30 or 365' });
      writes.push(['referral.windowDays', String(Number(windowDays))]);
    }
    if (enabled !== undefined) {
      if (typeof enabled !== 'boolean') return res.status(400).json({ message: 'enabled must be a boolean' });
      const rateAfter = writes.find(([k]) => k === 'referral.standardRate');
      const effectiveRate = rateAfter ? (rateAfter[1] === '' ? null : Number(rateAfter[1])) : before.standardRate;
      if (enabled && effectiveRate === null) return res.status(400).json({ message: 'Set a standard rate before enabling referrals' });
      writes.push(['referral.enabled', enabled ? 'true' : 'false']);
    }
    if (writes.length === 0) return res.status(400).json({ message: 'No fields to update' });
    for (const [k, v] of writes) {
      await pool.execute(
        `INSERT INTO settings (settingKey, settingValue, settingType) VALUES (?, ?, 'string')
         ON DUPLICATE KEY UPDATE settingValue = VALUES(settingValue)`, [k, v]
      );
    }
    const after = await getReferralSettings();
    await auditFromRequest(req, { action: 'referral.settings.update', entityType: 'setting', entityId: 'referral', before, after });
    res.json({ message: 'Referral settings updated', settings: after });
  } catch (error) {
    console.error('adminUpdateReferralSettings error:', error);
    res.status(500).json({ message: 'Failed to update referral settings' });
  }
};

// @route GET /api/admin/referrals/ambassadors?search=&tier=
export const adminListAmbassadors = async (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const tier = req.query.tier === 'super' ? 'super' : null;
    const where = [];
    const bind = [];
    // Case-insensitive on every engine: TiDB's default collation is utf8mb4_bin (TIDB-COLL), so a plain LIKE missed 'Kente' for 'kente'.
    if (search) { const s = `%${String(search).toLowerCase()}%`; where.push('(LOWER(u.email) LIKE ? OR LOWER(u.firstName) LIKE ? OR LOWER(u.lastName) LIKE ? OR u.referralCode = ?)'); bind.push(s, s, s, search.toUpperCase()); }
    if (tier) { where.push(`u.ambassadorTier = 'super'`); }
    if (!search && !tier) where.push(`(u.ambassadorTier = 'super' OR EXISTS (SELECT 1 FROM referral_commissions rc WHERE rc.referrerId = u.id))`);
    const [rows] = await pool.execute(
      `SELECT u.id, u.firstName, u.lastName, u.email, u.referralCode, u.ambassadorTier, u.ambassadorRate, u.ambassadorSuspended,
              (SELECT COUNT(*) FROM users r WHERE r.referredBy = u.id) AS referredCount,
              COALESCE(w.balance, 0) AS balance, COALESCE(w.totalEarned, 0) AS totalEarned
         FROM users u LEFT JOIN referral_wallets w ON w.userId = u.id
        WHERE ${where.join(' AND ')}
        ORDER BY totalEarned DESC, u.id DESC LIMIT 100`, bind
    );
    res.json(rows);
  } catch (error) {
    console.error('adminListAmbassadors error:', error);
    res.status(500).json({ message: 'Failed to list ambassadors' });
  }
};

// @route PUT /api/admin/referrals/ambassadors/:userId   { tier?, rate?, suspended? }
export const adminUpdateAmbassador = async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ message: 'Invalid user id' });
    const [[before]] = await pool.execute(
      `SELECT id, ambassadorTier, ambassadorRate, ambassadorSuspended FROM users WHERE id = ?`, [userId]
    );
    if (!before) return res.status(404).json({ message: 'User not found' });
    const { tier, rate, suspended } = req.body || {};
    const nextTier = tier !== undefined ? tier : before.ambassadorTier;
    if (!['standard', 'super'].includes(nextTier)) return res.status(400).json({ message: 'tier must be standard or super' });
    let nextRate = before.ambassadorRate === null ? null : Number(before.ambassadorRate);
    if (rate !== undefined) {
      if (rate === null || rate === '') nextRate = null;
      else {
        const r = parseRate(rate);
        if (r === null) return res.status(400).json({ message: 'Rate must be a decimal between 0 and 0.5, at most 4 decimal places' });
        const ceiling = await platformCeiling();
        if (r > ceiling) return res.status(400).json({ message: `Referral rate cannot exceed the platform commission (${(ceiling * 100).toFixed(2)}%)` });
        nextRate = r;
      }
    }
    if (nextTier === 'super' && nextRate === null) return res.status(400).json({ message: 'A super ambassador needs a personal rate' });
    if (nextTier === 'standard') nextRate = null;
    if (suspended !== undefined && typeof suspended !== 'boolean') return res.status(400).json({ message: 'suspended must be a boolean' });
    const nextSuspended = suspended !== undefined ? (suspended ? 1 : 0) : Number(before.ambassadorSuspended);
    await pool.execute(
      `UPDATE users SET ambassadorTier = ?, ambassadorRate = ?, ambassadorSuspended = ? WHERE id = ?`,
      [nextTier, nextRate, nextSuspended, userId]
    );
    const after = { id: userId, ambassadorTier: nextTier, ambassadorRate: nextRate, ambassadorSuspended: nextSuspended };
    await auditFromRequest(req, { action: 'referral.ambassador.update', entityType: 'user', entityId: userId, before, after });
    res.json({ message: 'Ambassador updated', ambassador: after });
  } catch (error) {
    console.error('adminUpdateAmbassador error:', error);
    res.status(500).json({ message: 'Failed to update ambassador' });
  }
};

// @route GET /api/admin/referrals/commissions?status=
export const adminListCommissions = async (req, res) => {
  try {
    const statuses = ['pending', 'under_review', 'available', 'cancelled', 'reversed'];
    const status = statuses.includes(req.query.status) ? req.query.status : null;
    const [rows] = await pool.execute(
      `SELECT rc.*, o.orderNumber, o.paymentStatus, o.orderStatus, o.totalAmount,
              r.email AS referrerEmail, r.firstName AS referrerFirstName, c.email AS customerEmail
         FROM referral_commissions rc
         JOIN orders o ON o.id = rc.orderId
         JOIN users r ON r.id = rc.referrerId
         JOIN users c ON c.id = rc.customerId
        ${status ? 'WHERE rc.status = ?' : ''}
        ORDER BY (rc.status = 'under_review') DESC, rc.id DESC LIMIT 200`,
      status ? [status] : []
    );
    res.json(rows.map((r) => ({ ...r, reviewReasons: typeof r.reviewReasons === 'string' ? JSON.parse(r.reviewReasons) : r.reviewReasons })));
  } catch (error) {
    console.error('adminListCommissions error:', error);
    res.status(500).json({ message: 'Failed to list referral commissions' });
  }
};

// @route POST /api/admin/referrals/commissions/:id/review   { decision: 'approve'|'reject', note }
export const adminReviewCommission = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { decision, note } = req.body || {};
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Invalid id' });
    if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ message: 'decision must be approve or reject' });
    if (typeof note !== 'string' || note.trim().length < 5) return res.status(400).json({ message: 'A justification note is required' });
    const [[before]] = await pool.execute(`SELECT id, status, reviewReasons FROM referral_commissions WHERE id = ?`, [id]);
    if (!before) return res.status(404).json({ message: 'Commission not found' });
    const next = await reviewReferralCommission(id, decision, { adminId: req.user.id, note: note.trim() });
    if (!next) return res.status(409).json({ message: `Only commissions under review can be decided (status: ${before.status})` });
    await auditFromRequest(req, { action: `referral.commission.${decision}`, entityType: 'referral_commission', entityId: id, before, after: { status: next, note: note.trim() } });
    res.json({ message: `Commission ${decision === 'approve' ? 'approved' : 'rejected'}`, status: next });
  } catch (error) {
    console.error('adminReviewCommission error:', error);
    res.status(500).json({ message: 'Failed to review commission' });
  }
};

// @route GET /api/admin/referrals/withdrawals?status=
export const adminListWithdrawals = async (req, res) => {
  try {
    const statuses = ['processing', 'paid', 'failed', 'reconciliation_required'];
    const status = statuses.includes(req.query.status) ? req.query.status : null;
    const [rows] = await pool.execute(
      `SELECT w.id, w.userId, u.email, w.amount, w.currency, w.reference, w.status, w.providerStatus, w.lastError,
              w.checkCount, w.lastCheckedAt, w.created_at, w.settledAt
         FROM referral_withdrawals w JOIN users u ON u.id = w.userId
        ${status ? 'WHERE w.status = ?' : ''} ORDER BY w.id DESC LIMIT 200`,
      status ? [status] : []
    );
    res.json(rows);
  } catch {
    res.status(500).json({ message: 'Failed to list referral withdrawals' });
  }
};

// @route POST /api/admin/referrals/withdrawals/:id/verify
// Re-checks with Paystack and applies only what Paystack confirms.
export const adminVerifyWithdrawal = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Invalid id' });
    const [[before]] = await pool.execute(`SELECT id, status, providerStatus FROM referral_withdrawals WHERE id = ?`, [id]);
    if (!before) return res.status(404).json({ message: 'Withdrawal not found' });
    if (before.status !== 'processing') return res.status(409).json({ message: `Withdrawal is ${before.status}; nothing to verify automatically` });
    const tally = await reconcileReferralWithdrawals({ ids: [id], limit: 1, minAgeMinutes: 0 });
    const [[after]] = await pool.execute(`SELECT id, status, providerStatus FROM referral_withdrawals WHERE id = ?`, [id]);
    await auditFromRequest(req, { action: 'referral.withdrawal.verify', entityType: 'referral_withdrawal', entityId: id, before, after: { ...after, tally } });
    res.json({ message: 'Verified with Paystack', withdrawal: after });
  } catch (error) {
    console.error('adminVerifyWithdrawal error:', error);
    res.status(500).json({ message: 'Verification failed' });
  }
};
