// FILE LOCATION: backend/controllers/adminPayoutController.js
// DESCRIPTION: Admin investigation + safe recovery for vendor payouts
//              (PAYOUT_LIFECYCLE_DESIGN.md §7, PAYOUT_RECONCILIATION_RUNBOOK.md).
//
// Deliberately NOT here: "force paid", "force failed", "retry transfer". The
// only action that can move money is `reconcile`, which asks Paystack for
// the transfer's real status and applies exactly what Paystack confirms,
// through the same idempotent settlement the webhook uses. It can never send
// a transfer. Everything else is read-only or an audited note.
import pool from '../config/db.js';
import { auditFromRequest } from '../utils/auditLog.js';
import { reconcilePayoutAttempt } from '../Services/transferReconciliationService.js';
import { checkVendorPayoutConsistency } from '../Services/transferSettlementService.js';

const UNRESOLVED_AFTER_MINUTES = 30;
const NOTE_MIN = 10;
const NOTE_MAX = 1000;

/**
 * What a reconcile outcome means, for the operator. Kept server-side so the
 * UI cannot present an unknown outcome as a success (or vice versa).
 * `severity` drives the UI tone: success | info | warning | error.
 */
export const OUTCOME_MESSAGES = {
  succeeded: { severity: 'success', message: 'Paystack confirmed the transfer succeeded. The vendor wallet was debited once and the payout is closed.' },
  failed: { severity: 'info', message: 'Paystack confirmed the transfer failed (or never existed). The reserved amount was returned exactly once — to the vendor balance, or clawed back if the order was refunded.' },
  reversed: { severity: 'info', message: 'Paystack reports the transfer was reversed. The amount was returned to the vendor balance (or clawed back for a refunded order).' },
  pending: { severity: 'info', message: 'Paystack has not finished this transfer yet. Nothing changed; the funds stay reserved. Check again later — do not re-send.' },
  attention: { severity: 'warning', message: 'Paystack needs action on this transfer (e.g. OTP, blocked, rejected). Resolve it in the Paystack dashboard; the funds stay reserved.' },
  review: { severity: 'warning', message: 'Automatic settlement is not safe for this payout (see the reason). Nothing moved; it needs manual review under the runbook.' },
  errored: { severity: 'error', message: 'Paystack could not be reached or gave no usable answer. Nothing changed; the funds stay reserved. Try again later.' },
  already: { severity: 'info', message: 'This payout was already settled by another path (webhook or scheduler). Nothing changed.' },
  skipped: { severity: 'info', message: 'This payout is not open; nothing to verify.' },
};

/** @returns {string | null} trimmed note, or null if invalid */
const validNote = (value) => {
  if (typeof value !== 'string') return null;
  const note = value.trim();
  // eslint-disable-next-line no-control-regex
  if (note.length < NOTE_MIN || note.length > NOTE_MAX || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(note)) return null;
  return note;
};

const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// Columns safe to show an operator: no recipient codes or bank details.
const ATTEMPT_COLUMNS = `pa.id, pa.withdrawalId, pa.allocationId, pa.vendorId, v.businessName,
  pa.amount, pa.amountMinor, pa.currency, pa.reference, pa.providerReference, pa.isFull,
  pa.status, pa.providerStatus, pa.initiatedAt, pa.initiateHttpStatus, pa.lastError,
  pa.checkCount, pa.lastCheckedAt, pa.reviewReason, pa.alertedReason, pa.alertedAt,
  pa.resolutionNote, pa.resolvedBy, pa.resolvedAt, pa.created_at, pa.updated_at,
  TIMESTAMPDIFF(MINUTE, pa.created_at, NOW()) AS ageMinutes`;

/** Why an attempt is unresolved, in plain words for the admin list. */
const explain = (a) => {
  if (a.status === 'reconciliation_required') {
    return `Automation stopped: ${a.reviewReason || 'unknown reason'}. Needs manual review — funds remain reserved.`;
  }
  if (a.providerStatus && !['success', 'failed', 'reversed'].includes(a.providerStatus)) {
    return `Paystack reports '${a.providerStatus}' — outcome not final yet. Funds remain reserved.`;
  }
  if (!a.initiatedAt && a.lastError) {
    return `Initiate call got no confirmation (${a.lastError}). Outcome UNKNOWN until Paystack verify answers — do not re-send.`;
  }
  return 'Waiting for Paystack confirmation (webhook or reconciliation).';
};

// @desc    Unresolved payouts: processing past the SLA + reconciliation_required
// @route   GET /api/admin/payouts/unresolved?limit=
// @access  Admin
export const listUnresolvedPayouts = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const filter = req.query.status == null || req.query.status === '' ? 'all' : String(req.query.status);
    if (!['all', 'processing', 'reconciliation_required'].includes(filter)) {
      return res.status(400).json({ message: 'status must be processing, reconciliation_required or empty' });
    }
    const where = filter === 'reconciliation_required'
      ? `pa.status = 'reconciliation_required'`
      : filter === 'processing'
        ? `pa.status = 'processing' AND pa.created_at < DATE_SUB(NOW(), INTERVAL ${UNRESOLVED_AFTER_MINUTES} MINUTE)`
        : `pa.status = 'reconciliation_required'
           OR (pa.status = 'processing' AND pa.created_at < DATE_SUB(NOW(), INTERVAL ${UNRESOLVED_AFTER_MINUTES} MINUTE))`;
    const [rows] = await pool.execute(
      `SELECT ${ATTEMPT_COLUMNS}
         FROM payout_attempts pa
         LEFT JOIN vendors v ON v.userId = pa.vendorId
        WHERE ${where}
        ORDER BY (pa.status = 'reconciliation_required') DESC, pa.created_at ASC
        LIMIT ${limit}`
    );
    res.json({
      count: rows.length,
      payouts: rows.map((a) => ({
        ...a,
        outcomeKnown: a.status === 'reconciliation_required' && a.providerStatus === 'success' ? 'provider-confirmed success, not booked'
          : a.status === 'reconciliation_required' ? 'needs review'
          : 'unknown',
        explanation: explain(a),
      })),
    });
  } catch (error) {
    console.error('listUnresolvedPayouts error:', error.message);
    res.status(500).json({ message: 'Failed to load unresolved payouts' });
  }
};

// @desc    One payout attempt with its allocation, withdrawal, journal and the
//          vendor wallet consistency check (invariant I-15)
// @route   GET /api/admin/payouts/:id
// @access  Admin
export const getPayoutAttempt = async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid payout attempt id' });
  try {
    const [[attempt]] = await pool.execute(
      `SELECT ${ATTEMPT_COLUMNS} FROM payout_attempts pa LEFT JOIN vendors v ON v.userId = pa.vendorId WHERE pa.id = ?`,
      [id]
    );
    if (!attempt) return res.status(404).json({ message: 'Payout attempt not found' });
    const [[allocation]] = await pool.execute(
      `SELECT id, orderId, vendorId, amount, platformFee, payoutAmount, status, payoutReference, reason, released_at
         FROM escrow_allocations WHERE id = ?`,
      [attempt.allocationId]
    );
    const [journal] = await pool.execute(
      `SELECT eventType, amount, direction, reference, providerReference, created_at
         FROM financial_events WHERE payoutAttemptId = ? OR (reference = ? AND eventType LIKE 'wallet.%')
        ORDER BY id ASC LIMIT 50`,
      [id, attempt.reference]
    );
    const consistency = await checkVendorPayoutConsistency(attempt.vendorId);
    // Action history: every admin action on this attempt (audit log is
    // append-only; notes are never overwritten there).
    const [history] = await pool.execute(
      `SELECT id, actorId, actorEmail, action, beforeVal, afterVal, created_at
         FROM admin_audit_log WHERE entityType = 'payout_attempt' AND entityId = ?
        ORDER BY id DESC LIMIT 100`,
      [String(id)]
    ).catch((err) => (err.code === 'ER_NO_SUCH_TABLE' ? [[]] : Promise.reject(err)));
    res.json({
      attempt: { ...attempt, explanation: explain(attempt) },
      allocation: allocation || null,
      journal,
      consistency,
      history,
      canReverify: attempt.status === 'processing' || attempt.status === 'reconciliation_required',
      reverifyNeedsJustification: attempt.status === 'reconciliation_required',
    });
  } catch (error) {
    console.error('getPayoutAttempt error:', error.message);
    res.status(500).json({ message: 'Failed to load payout attempt' });
  }
};

// @desc    Verify one attempt with Paystack now and apply ONLY what Paystack
//          confirms (never re-sends). Safe to repeat.
//          A reconciliation_required attempt may be re-verified only with an
//          explicit acknowledgement + justification note (design §7.1); the
//          same evidence/invariant checks apply, so contradictory evidence
//          keeps it parked.
// @route   POST /api/admin/payouts/:id/reconcile   body: { acknowledge?, note? }
// @access  Admin
export const reconcilePayoutNow = async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid payout attempt id' });
  try {
    const [[attempt]] = await pool.execute(`SELECT * FROM payout_attempts WHERE id = ?`, [id]);
    if (!attempt) return res.status(404).json({ message: 'Payout attempt not found' });
    const parked = attempt.status === 'reconciliation_required';
    if (attempt.status !== 'processing' && !parked) {
      await auditFromRequest(req, {
        action: 'payout.reconcile.refused', entityType: 'payout_attempt', entityId: id,
        before: { status: attempt.status },
      });
      return res.status(409).json({ message: `This payout is already ${attempt.status}.`, status: attempt.status });
    }
    let note = null;
    if (parked) {
      note = validNote(req.body?.note);
      if (req.body?.acknowledge !== true || !note) {
        return res.status(400).json({
          message: `This payout needs manual review. Re-verifying requires acknowledge: true and a justification note (${NOTE_MIN}-${NOTE_MAX} characters) stating what you checked in the Paystack dashboard.`,
        });
      }
    }
    const outcome = await reconcilePayoutAttempt(attempt, { allowReview: parked });
    const [[after]] = await pool.execute(
      `SELECT status, providerStatus, lastError, reviewReason, lastCheckedAt FROM payout_attempts WHERE id = ?`, [id]
    );
    if (note) {
      await pool.execute(
        `UPDATE payout_attempts SET resolutionNote = ?, resolvedBy = ?, resolvedAt = CURRENT_TIMESTAMP WHERE id = ?`,
        [note, req.user.id, id]
      );
    }
    await auditFromRequest(req, {
      action: parked ? 'payout.review.reverify' : 'payout.reconcile', entityType: 'payout_attempt', entityId: id,
      before: { status: attempt.status, providerStatus: attempt.providerStatus, reviewReason: attempt.reviewReason },
      after: { outcome, ...after, ...(note ? { note } : {}) },
    });
    res.json({ outcome, ...(OUTCOME_MESSAGES[outcome] || OUTCOME_MESSAGES.errored), attempt: after });
  } catch (error) {
    console.error('reconcilePayoutNow error:', error.message);
    res.status(500).json({ message: 'Reconciliation failed; nothing was changed by this request', severity: 'error' });
  }
};

// @desc    Record an investigation note (no money or status change)
// @route   POST /api/admin/payouts/:id/note   body: { note }
// @access  Admin
export const addPayoutNote = async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid payout attempt id' });
  const note = validNote(req.body?.note);
  if (!note) {
    return res.status(400).json({ message: `A note of ${NOTE_MIN}–${NOTE_MAX} characters is required` });
  }
  try {
    const [[before]] = await pool.execute(`SELECT id, status, resolutionNote FROM payout_attempts WHERE id = ?`, [id]);
    if (!before) return res.status(404).json({ message: 'Payout attempt not found' });
    await pool.execute(
      `UPDATE payout_attempts SET resolutionNote = ?, resolvedBy = ?, resolvedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [note, req.user.id, id]
    );
    await auditFromRequest(req, {
      action: 'payout.note', entityType: 'payout_attempt', entityId: id,
      before: { resolutionNote: before.resolutionNote }, after: { resolutionNote: note, status: before.status },
    });
    res.json({ message: 'Note recorded', id, status: before.status });
  } catch (error) {
    console.error('addPayoutNote error:', error.message);
    res.status(500).json({ message: 'Failed to record note' });
  }
};
