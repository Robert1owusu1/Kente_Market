// FILE LOCATION: backend/Services/paymentReconciliationService.js
// DESCRIPTION: Late-charge reconciliation for TERMINAL orders, plus the two
//              recovery jobs that converge whatever a crash can strand.
//
// A Paystack charge can settle after the order behind it was cancelled (or
// refunded through the return path). The paid-flip guards in the webhook,
// verify-paystack fallback, and recoverStuckPendingOrders all correctly
// refuse to resurrect such an order — but until this service existed, the
// captured funds were silently dropped: the webhook retried an UPDATE that
// could never match, and no path ever pushed a refund back to the customer.
//
// The only safe, business-rule-consistent action is what cancelOrder already
// does for a paid order: issue a REAL Paystack refund, then record it. The
// order is never resurrected; the money never disappears from the books.
//
// Idempotency is shared with every other refund path through the SAME claim
// column: `orders.refundReference` is CAS-set from NULL before any provider
// call (cancelOrder, returnController full/partial, and this service all
// refuse to run when it is already claimed). The journal dedupeKey
// `refund:${orderId}` is the ledger's full-refund key, so no path can book
// the same refund twice.
//
// A claim is a CLAIM, never a completed refund — and a crash between claim
// and finalize used to strand money with nobody retrying it (redeliveries
// stand down on the claim and mark the webhook processed; the paid-only
// reconcileRefundedButPaid never saw these rows). Two jobs converge that:
//
//   reconcileStaleRefundClaims — reads the ACTUAL provider refund state
//     (never the claim): finalize when confirmed, wait when pending, re-issue
//     exactly once when provably never issued, alert when state is unknown.
//   reconcileUnmatchedCharges — charge.success receipts whose order never
//     appeared: re-verified server-side, reported to operators once, and
//     handed to the existing stuck-order recovery when the order finally
//     appears. Never creates an order; never refunds an unmatched charge.
import pool from '../config/db.js';
import paystackServices from './paystackservices.js';
import { recordFinancialEvent } from './ledgerService.js';
import { CHARGED_CURRENCY } from './paymentCurrency.js';
import { buildRefundClaim } from '../utils/refundClaim.js';
import { notifyAdmins } from '../utils/adminAlerts.js';
import { recordCheck, recordCheckAndAlert, dueJoin } from '../utils/reconciliationChecks.js';

/**
 * @typedef {Object} TerminalOrder
 * @property {number} id
 * @property {string} paymentStatus
 * @property {string} orderStatus
 * @property {string|null} refundReference
 * @property {string|number} totalAmount
 * @property {string|null} paymentReference
 */

/**
 * @typedef {Object} ReconcileOutcome
 * @property {'refunded'|'already-refunded'|'in-progress'|'no-reference'|'refund-failed'|'refund-unknown'|'finalization-failed'} action
 *   - 'refund-failed': the provider DEFINITIVELY refused — no money moved,
 *     the claim was released, a retry may re-attempt.
 *   - 'refund-unknown': the provider call did not return a definite result
 *     (timeout / network drop / 5xx) — the refund MAY have been accepted, so
 *     the claim was KEPT and reconcileStaleRefundClaims settles it.
 *   - 'finalization-failed': the provider ACCEPTED the refund but the
 *     database write failed — the claim was KEPT (releasing it would invite a
 *     double refund) and the reconciler finalizes from provider state.
 * @property {Error} [error]
 */

/**
 * Release a refund claim this path owns. Value-guarded (`refundReference =
 * claim`) so it can never free a claim a concurrent path replaced.
 */
const releaseClaim = (orderId, claimValue) =>
  pool.execute(
    `UPDATE orders SET refundReference = NULL WHERE id = ? AND refundReference = ?`,
    [orderId, claimValue]
  ).catch(() => {});

/**
 * A DEFINITIVE provider rejection means Paystack answered and refused the
 * refund — no money moved, so releasing the claim is safe and lets a retry
 * re-attempt. Everything else (timeout, network drop, 5xx) is an UNKNOWN
 * outcome: the refund may have been accepted, so the claim must be kept and
 * the real refund state reconciled from the provider before anything else
 * touches this order.
 */
const isDefinitiveRejection = (err) =>
  Boolean(err?.hadProviderResponse) &&
  !(Number.isInteger(err?.providerStatus) && err.providerStatus >= 500);

/**
 * Finalize a refund the provider has CONFIRMED (accepted just now, or found
 * already refunded in the provider's refund list). Journal FIRST — the refund
 * dedupeKey `refund:${orderId}` INSERT-IGNOREs, so a crash between journal
 * and flip converges on the next pass instead of losing the bookkeeping
 * forever — then CAS-flip paymentStatus. The claim marker is deliberately
 * left in place afterwards: it is the completed-refund trace, exactly as on
 * the happy path.
 */
const finalizeConfirmedRefund = async (order, providerRefund) => {
  const orderId = order.id;
  try {
    await recordFinancialEvent({
      eventType: 'refund',
      direction: 'out',
      amount: parseFloat(order.totalAmount) || 0,
      orderId,
      reference: order.paymentReference,
      providerReference:
        providerRefund?.id ?? providerRefund?.failure_reference ?? order.paymentReference,
      // The shared full-refund journal key: cancelOrder and the return path
      // write `refund:${orderId}` too, so a refund is journaled once and only
      // once no matter which path issued or finalized it.
      dedupeKey: `refund:${orderId}`,
      payload: {
        reason: 'late charge on terminal order reconciled by refund',
        providerRefundId: providerRefund?.id ?? null,
        providerRefundStatus: providerRefund?.status ?? null,
      },
    });
  } catch { /* journal is best-effort */ }
  // 'paid' stays in the guard list only for defensive symmetry — a terminal
  // order should never be paid here, and if it somehow is, 'refunded' is
  // still the truthful terminal state once the money went back.
  await pool.execute(
    `UPDATE orders SET paymentStatus = 'refunded', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND paymentStatus IN ('pending', 'failed', 'paid')`,
    [orderId]
  );
};


/**
 * Reconcile a VERIFIED successful charge whose order is in a terminal state
 * (cancelled / refunded) by pushing a real Paystack refund.
 *
 * Callers MUST have already validated the charge against the order (amount,
 * currency, provider status) exactly as they would before a paid flip — this
 * function trusts its input.
 *
 * @param {TerminalOrder} order  the terminal order row (freshly re-read)
 * @param {Object} [charge]      the provider charge/transaction payload (for the journal)
 * @returns {Promise<ReconcileOutcome>}
 */
export const reconcileTerminalOrderCharge = async (order, charge = {}) => {
  const orderId = order.id;
  if (!order.paymentReference) return { action: 'no-reference' };
  // Already refunded: a duplicate delivery or repeated verification must not
  // issue a second refund for the same charge.
  if (order.paymentStatus === 'refunded') return { action: 'already-refunded' };

  // Shared claim: the first actor (webhook, verify fallback, recovery job,
  // admin cancel) to CAS NULL -> marker owns the refund. Everyone else stands
  // down without calling the provider. Bounded to the column size (see
  // utils/refundClaim.js) so a long external reference can never overflow it
  // and break the release CAS below.
  const claimValue = buildRefundClaim(orderId, 'late-charge', order.paymentReference);
  const [claim] = await pool.execute(
    `UPDATE orders SET refundReference = ? WHERE id = ? AND refundReference IS NULL`,
    [claimValue, orderId]
  );
  if (claim.affectedRows === 0) return { action: 'in-progress' };

  // Book the inbound charge BEFORE the refund so the ledger stays symmetric
  // (money in, then money out). Neither the webhook nor the verify fallback
  // journals `charge.collected` on terminal orders — they skip all side
  // effects — so this is the only path that records the inbound leg. The
  // dedupeKey is the provider-reference key used everywhere else, so a later
  // replay of any kind can never double-book it.
  try {
    await recordFinancialEvent({
      eventType: 'charge.collected',
      direction: 'in',
      amount: parseFloat(order.totalAmount) || 0,
      currency: CHARGED_CURRENCY, // asserted equal to the charge's currency by every caller
      orderId,
      reference: order.paymentReference,
      providerReference: order.paymentReference,
      dedupeKey: `charge.collected:${order.paymentReference}`,
      payload: {
        event: 'late-charge-reconciled',
        reconciledToRefund: true,
        // Non-PII provider metadata from the verified charge (channel,
        // amount, currency, paid_at) — never the customer block.
        providerChannel: charge?.channel ?? null,
        providerAmountKobo: charge?.amount ?? null,
        providerCurrency: charge?.currency ?? null,
        providerPaidAt: charge?.paid_at ?? null,
      },
    });
  } catch { /* journal is best-effort */ }

  // Provider call, classified into accepted / definitively rejected / unknown.
  let refund;
  try {
    refund = await paystackServices.refundTransaction(
      order.paymentReference,
      undefined,
      `Order ${orderId} cancelled before its charge settled`
    );
  } catch (err) {
    if (isDefinitiveRejection(err)) {
      // The provider answered and refused: no money moved. Release the claim
      // so the redelivered webhook / next recovery run can re-attempt it.
      // Mirrors cancelOrder's release-on-failure.
      await releaseClaim(orderId, claimValue);
      return { action: 'refund-failed', error: err };
    }
    // Timeout / network drop / 5xx: the outcome is UNKNOWN — the refund may
    // have been accepted. Keep the claim (releasing it would let a
    // redelivery re-issue a refund that may already exist) and let
    // reconcileStaleRefundClaims settle it from the provider's refund list.
    return { action: 'refund-unknown', error: err };
  }
  if (!refund?.status) {
    // Provider answered and refused (refund.status false): no money moved.
    await releaseClaim(orderId, claimValue);
    return { action: 'refund-failed', error: new Error(refund?.message || 'Paystack rejected the refund') };
  }

  try {
    await finalizeConfirmedRefund(order, refund?.data);
    return { action: 'refunded' };
  } catch (err) {
    // The refund is CONFIRMED at the provider but the database write failed.
    // Keep the claim — it is now evidence a refund happened, and releasing it
    // would let a retry re-issue a second refund. reconcileStaleRefundClaims
    // finalizes this from provider state on its next run.
    return { action: 'finalization-failed', error: err };
  }
};

// ============================================================
// Stale refund-claim reconciler (audit Finding 1)
// ============================================================
// Population: orders carrying a stale LATE-CHARGE claim
// (`refund:<id>:late-charge:<ref>`) that never reached paymentStatus=
// 'refunded' — the claim was CAS-written and the process died (or the DB
// write failed) before/after the provider call, leaving the order
// pending/failed with a terminal orderStatus. Redeliveries stand down on the
// claim and mark the webhook processed, so nothing else retries; the paid-only
// reconcileRefundedButPaid never saw this population. cancelOrder/return
// claims cannot appear here: they only claim PAID orders.
//
// The claim is NEVER treated as proof of a refund. Per row:
//   1. own-ledger check — a `refund:<id>` journal row means money was
//      provably booked out → finalize (idempotent journal + CAS flip), no
//      provider call needed;
//   2. otherwise consult the provider: verify the charge, then list its
//      refunds —
//      - a full success/processed refund → finalize;
//      - a pending/processing refund → wait (log), keep the claim, no money
//        action (never finalize early, never stack a second refund);
//      - failed / needs_attention refunds → alert an operator (no blind
//        re-issue: provider-side resolution may need bank details);
//      - rows that cannot be attributed to this transaction, or any provider
//        call that fails → state UNKNOWN → alert, change nothing;
//   3. an ATTRIBUTABLE empty refund list means the crash happened before the
//      refund ever reached Paystack → re-issue ONCE under the claim this job
//      already holds, then finalize on acceptance.
// Nothing here ever resurrects an order, and no path can double-refund: the
// already-set claim keeps every other actor standing down, and the journal
// dedupeKey keeps the books single-booking. This job never RELEASES a claim.
const STALE_CLAIM_MINUTES = 15;
const STALE_CLAIM_BATCH = 25;
const STALE_CLAIM_JOB = 'staleRefundClaim';
/** Rows that need a human are re-checked this often (provider state may change after operator action). */
const REVIEW_RECHECK_MINUTES = 6 * 60;

/**
 * Durable, deduplicated outcome for one stale claim (FV-6): recorded in
 * reconciliation_checks; the admin alert is sent at most once per reason per day.
 * @param {number} orderId
 * @param {'waiting' | 'needs_review'} state
 * @param {string} reason
 * @param {string} title
 * @param {string} message
 */
const flagStaleClaim = (orderId, state, reason, title, message) =>
  recordCheckAndAlert(STALE_CLAIM_JOB, orderId, {
    state, reason, nextCheckMinutes: state === 'needs_review' ? REVIEW_RECHECK_MINUTES : STALE_CLAIM_MINUTES,
    alert: { title, message },
  });


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
 * @param {{ limit?: number, orderIds?: number[] | null, staleMinutes?: number }} [opts]
 *   defaults are the scheduler's; `orderIds` scopes a targeted re-check.
 */
export const reconcileStaleRefundClaims = async ({ limit = STALE_CLAIM_BATCH, orderIds = null, staleMinutes = STALE_CLAIM_MINUTES } = {}) => {
  const batch = Math.min(200, Math.max(1, Math.floor(Number(limit)) || STALE_CLAIM_BATCH));
  const minutes = Math.max(0, Math.floor(Number(staleMinutes)));
  const age = Number.isFinite(minutes) ? minutes : STALE_CLAIM_MINUTES;
  // FV-6: durable per-order check state (reconciliation_checks). Due rows
  // only, never-checked first, then least recently checked — rows that need
  // a human are re-checked every 6 h instead of filling every 15-min batch
  // (they used to: LIMIT 25, no order, re-alerted every run).
  const population = `o.refundReference LIKE 'refund:%:late-charge:%'
       AND o.paymentStatus IN ('pending', 'failed')
       AND o.paymentReference IS NOT NULL AND o.paymentReference != ''
       AND o.updated_at <= DATE_SUB(NOW(), INTERVAL ${age} MINUTE)${idScope(orderIds)}`;
  const { join, due, order } = dueJoin(STALE_CLAIM_JOB, 'o.id');
  let rows;
  try {
    [rows] = await pool.execute(
      `SELECT o.id, o.paymentReference, o.totalAmount, o.orderStatus, o.paymentStatus, o.refundReference
         FROM orders o ${join}
        WHERE ${population} AND ${due}
        ORDER BY ${order}
        LIMIT ${batch}`
    );
  } catch (err) {
    if (err?.code !== 'ER_NO_SUCH_TABLE') throw err;
    console.warn('reconciliation_checks missing — run `npm run db:migrate` (migrateReconciliationChecks.js); using the unordered legacy scan');
    [rows] = await pool.execute(
      `SELECT o.id, o.paymentReference, o.totalAmount, o.orderStatus, o.paymentStatus, o.refundReference
         FROM orders o WHERE ${population} LIMIT ${batch}`
    );
  }
  if (rows.length === 0) return 0;

  let resolved = 0;
  for (const row of rows) {
    try {
      // Ownership: only act on claims this service generates (deterministic
      // recomputation). A foreign or drifted marker is left alone for review.
      if (row.refundReference !== buildRefundClaim(row.id, 'late-charge', row.paymentReference)) {
        console.error(` refund-claims: order ${row.id} carries an unrecognized claim (${row.refundReference}) — manual review required`);
        await recordCheck(STALE_CLAIM_JOB, row.id, { state: 'needs_review', reason: 'unrecognized_claim', detail: row.refundReference, nextCheckMinutes: REVIEW_RECHECK_MINUTES });
        continue;
      }
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(row.paymentReference)) {
        console.error(` refund-claims: order ${row.id} has an unusable paymentReference — manual review required`);
        await flagStaleClaim(row.id, 'needs_review', 'unusable_reference',
          'Stale refund claim needs manual review',
          `Order #${row.id} has a stale late-charge refund claim but its payment reference is unusable. Verify in the Paystack dashboard and finalize manually. Nothing was re-issued.`
        );
        continue;
      }

      // Proof #1: our own ledger. A recorded refund journal means an accepted
      // refund was already booked — finalize without asking the provider.
      const [[journaled]] = await pool.execute(
        `SELECT COUNT(*) AS n FROM financial_events WHERE dedupeKey = ?`,
        [`refund:${row.id}`]
      );
      if (Number(journaled?.n) > 0) {
        await finalizeConfirmedRefund(row, null);
        resolved += 1;
        await recordCheck(STALE_CLAIM_JOB, row.id, { state: 'resolved', reason: 'refund_journal_found' });
        console.log(` refund-claims: order ${row.id} — refund journal found; finalized the flip`);
        continue;
      }

      // Proof #2: the provider's actual refund state (never the claim).
      let tx;
      try {
        const verified = await paystackServices.verifyTransaction(row.paymentReference);
        tx = verified?.status && verified?.data ? verified.data : null;
      } catch (err) {
        // State could not be established (timeout, auth, provider outage).
        // Change NOTHING about money — alert and retry next run.
        console.error(` refund-claims: order ${row.id} — charge verification unavailable (${err.message}); claim retained, will retry next run`);
        await flagStaleClaim(row.id, 'waiting', 'provider_unavailable',
          'Stale refund claim — provider state unavailable',
          `Order #${row.id} has a stale refund claim and Paystack could not be queried (${err.message}). The claim was retained and nothing was re-issued; the job retries automatically.`
        );
        continue;
      }
      if (!tx || tx.status !== 'success') {
        // The charge behind the claim is not a confirmed success — nothing to
        // refund. Leave the claim for an operator to clear.
        console.error(` refund-claims: order ${row.id} — charge is not a provider-confirmed success (status ${tx?.status ?? 'unavailable'}); claim retained for manual review`);
        await flagStaleClaim(row.id, 'needs_review', 'charge_not_confirmed',
          'Stale refund claim without a confirmed charge',
          `Order #${row.id} carries a refund claim but Paystack reports the charge as ${tx?.status ?? 'unavailable'}. Verify in the dashboard, then clear orders.refundReference if no refund is due.`
        );
        continue;
      }

      let refunds;
      try {
        // The documented filter is the transaction ID; a reference fallback
        // covers endpoints that accept either form.
        const listed = await paystackServices.listRefunds(String(tx.id ?? row.paymentReference));
        refunds = Array.isArray(listed?.data) ? listed.data : [];
      } catch (err) {
        console.error(` refund-claims: order ${row.id} — refund listing unavailable (${err.message}); claim retained, will retry next run`);
        await flagStaleClaim(row.id, 'waiting', 'refund_list_unavailable',
          'Stale refund claim — refund state unavailable',
          `Order #${row.id}: the Paystack refund list could not be fetched (${err.message}). The claim was retained and nothing was re-issued; the job retries automatically.`
        );
        continue;
      }
      const attributed = refunds.filter(
        (r) => r && (String(r.transaction) === String(tx.id) || String(r.transaction) === row.paymentReference)
      );
      if (refunds.length > 0 && attributed.length === 0) {
        // The endpoint returned rows that cannot be attributed to this
        // transaction — treat the state as UNKNOWN rather than guessing.
        console.error(` refund-claims: order ${row.id} — refund list rows could not be attributed to the transaction; claim retained for manual review`);
        await flagStaleClaim(row.id, 'needs_review', 'refund_state_ambiguous',
          'Stale refund claim — refund state ambiguous',
          `Order #${row.id}: the Paystack refund list returned rows that could not be attributed to this transaction. Verify in the dashboard before finalizing. Nothing was re-issued.`
        );
        continue;
      }

      const expectedKobo = Math.round(parseFloat(row.totalAmount) * 100);
      const confirmed = attributed.find((r) => {
        const status = String(r.status || '').toLowerCase();
        if (!['success', 'processed'].includes(status)) return false;
        const amount = Number(r.amount);
        return !Number.isFinite(amount) || amount >= expectedKobo;
      });
      if (confirmed) {
        await finalizeConfirmedRefund(row, confirmed);
        resolved += 1;
        await recordCheck(STALE_CLAIM_JOB, row.id, { state: 'resolved', reason: 'provider_refund_confirmed' });
        console.log(` refund-claims: order ${row.id} — provider-confirmed refund ${confirmed.id ?? ''} finalized`);
        continue;
      }
      const partial = attributed.find((r) => ['success', 'processed'].includes(String(r.status || '').toLowerCase()));
      if (partial) {
        // A partial refund on a full-refund claim must not be finalized as a
        // full refund — the remainder needs exact amounts.
        console.error(` refund-claims: order ${row.id} — only a partial refund exists at the provider (${partial.amount ?? '?'} vs expected ${expectedKobo} ${CHARGED_CURRENCY}); manual review required`);
        await flagStaleClaim(row.id, 'needs_review', 'partial_refund_on_full_claim',
          'Partial refund on a full-refund claim',
          `Order #${row.id} has a provider refund smaller than the order total. Finalize the remainder manually; do NOT re-issue blindly.`
        );
        continue;
      }
      const inFlight = attributed.find((r) =>
        ['pending', 'processing', 'queued'].includes(String(r.status || '').toLowerCase())
      );
      if (inFlight) {
        // Refund in flight at the provider: wait. Never finalize early and
        // never stack a second refund behind a pending one.
        console.log(` refund-claims: order ${row.id} — refund ${inFlight.id ?? ''} is ${inFlight.status} at the provider; waiting (claim retained)`);
        await recordCheck(STALE_CLAIM_JOB, row.id, { state: 'waiting', reason: 'refund_in_flight', nextCheckMinutes: STALE_CLAIM_MINUTES });
        continue;
      }
      if (attributed.length > 0) {
        // Failed / needs_attention: a refund attempt exists but no money
        // moved. Re-issuing blindly can mask a provider-side resolution
        // (e.g. needs_attention retries carry customer bank details), so an
        // operator decides.
        console.error(` refund-claims: order ${row.id} — provider refund did not complete (${attributed.map((r) => r.status).join(',')}); claim retained, operator action required`);
        await flagStaleClaim(row.id, 'needs_review', 'refund_not_completed',
          'Refund did not complete at Paystack',
          `Order #${row.id}: the provider refund attempt(s) did not complete (${attributed.map((r) => r.status).join(', ')}). Retry from the Paystack dashboard or clear the claim after verifying. Do NOT re-issue blindly.`
        );
        continue;
      }

      // Empty, attributable refund list: the crash happened before the refund
      // ever reached Paystack. The charge is a verified success, the order is
      // terminal, and this job holds the claim — issue the one refund now.
      let refund;
      try {
        refund = await paystackServices.refundTransaction(
          row.paymentReference,
          undefined,
          `Order ${row.id} refund recovered from a stale claim`
        );
      } catch (err) {
        if (isDefinitiveRejection(err)) {
          console.error(` refund-claims: order ${row.id} — provider refused the recovered refund (${err.message}); claim retained for manual review`);
          await flagStaleClaim(row.id, 'needs_review', 'recovered_refund_refused',
            'Recovered refund refused by Paystack',
            `Order #${row.id}: the recovered refund was refused (${err.message}). Verify in the dashboard before retrying.`
          );
        } else {
          console.error(` refund-claims: order ${row.id} — recovered refund outcome UNKNOWN (${err.message}); claim retained, provider state re-checked next run`);
          await flagStaleClaim(row.id, 'waiting', 'recovered_refund_unknown',
            'Recovered refund outcome unknown',
            `Order #${row.id}: the recovered refund call did not return a definite result (${err.message}). Nothing was marked refunded; the job re-checks the provider state automatically.`
          );
        }
        continue;
      }
      if (!refund?.status) {
        console.error(` refund-claims: order ${row.id} — Paystack rejected the recovered refund (${refund?.message || 'unknown'}); claim retained for manual review`);
        await flagStaleClaim(row.id, 'needs_review', 'recovered_refund_rejected',
          'Recovered refund rejected by Paystack',
          `Order #${row.id}: Paystack rejected the recovered refund (${refund?.message || 'unknown reason'}). Verify in the dashboard before retrying.`
        );
        continue;
      }
      await finalizeConfirmedRefund(row, refund?.data);
      resolved += 1;
      await recordCheck(STALE_CLAIM_JOB, row.id, { state: 'resolved', reason: 'refund_reissued' });
      console.log(` refund-claims: order ${row.id} — refund re-issued from the stale claim and finalized`);
    } catch (err) {
      console.warn(` refund-claims: could not reconcile order ${row.id}: ${err.message}`);
      await recordCheck(STALE_CLAIM_JOB, row.id, { state: 'waiting', reason: 'reconcile_error', detail: err.message, nextCheckMinutes: STALE_CLAIM_MINUTES });
    }
  }
  return resolved;
};

// ============================================================
// Unmatched successful-charge reconciler (audit Finding 2)
// ============================================================
// A charge.success receipt whose order never appears is retried for ~10s and
// then failed durably ("Order was not found after retry window"). Paystack
// eventually stops redelivering, and until this job existed nothing ever
// looked at those receipts again: a genuinely captured payment with no order
// behind it. The stored payload is NOT trusted as proof of payment — the
// receipt was signature-verified at ingestion, but every classification here
// rests on a fresh, server-side Paystack verification. The receipt row (and
// its payload) is preserved untouched as evidence; only `last_error` gains a
// disposition marker.
//
// Per receipt (event='charge.success', failed for lack of an order):
//   - an order for the reference exists NOW → the receipt is no longer
//     unmatched. Settled (paid/refunded) → note the disposition. Still
//     pending/failed → hand the order to the existing stuck-order recovery,
//     which re-verifies the charge server-side before flipping it (flip-guard
//     + amount/currency checks; this job flips nothing itself);
//   - no order exists → re-verify the reference with Paystack:
//       verified success → mark the receipt and alert the operators ONCE
//         (the marker dedupes the notification across runs); keep it in the
//         report on every run for visibility;
//       not confirmed by the provider → mark it and log; no money action.
// NO order is ever created from this job and NO refund is ever issued for an
// unmatched charge. Customer data from the payload is never logged or
// notified — only the reference, amount, currency and timestamps.
export const reconcileUnmatchedCharges = async () => {
  const [rows] = await pool.execute(
    `SELECT event, reference, last_error, attempts, processed_at
     FROM webhook_events
     WHERE event = 'charge.success'
       AND processing_status IN ('received', 'failed')
       AND (last_error IS NULL
            OR last_error LIKE 'Order was not found%'
            OR last_error LIKE '%unmatched-charge:%')
     -- FV-4: receipts not yet reported first. Reported rows never leave this
     -- population, so oldest-first alone let 25 of them fill every batch and
     -- starve every newer receipt forever.
     ORDER BY (last_error LIKE '%unmatched-charge:%') ASC, processed_at ASC
     LIMIT 25`
  );
  if (rows.length === 0) return 0;

  const mark = (reference, marker) =>
    pool.execute(
      `UPDATE webhook_events SET last_error = ? WHERE event = 'charge.success' AND reference = ?`,
      [String(marker).slice(0, 500), reference]
    );

  let unmatched = 0;
  let needOrderRecovery = false;
  for (const row of rows) {
    try {
      const reference = row.reference;
      if (!reference || !/^[A-Za-z0-9._-]{1,100}$/.test(reference)) {
        console.warn(` unmatched-charges: skipping receipt with an unusable reference (${String(reference).slice(0, 40)})`);
        continue;
      }
      const [[order]] = await pool.execute(
        `SELECT id, paymentStatus FROM orders WHERE paymentReference = ?`,
        [reference]
      );
      if (order) {
        // The order appeared after the webhook gave up (slow POST /api/orders,
        // lost connection, ...). Idempotent reprocessing is delegated to the
        // existing recovery job — it re-verifies the charge server-side and
        // flips with the same guards the webhook uses.
        const noted = String(row.last_error || '');
        if (!noted.includes(`order #${order.id} bound`)) {
          if (['paid', 'refunded'].includes(order.paymentStatus)) {
            await mark(reference, `unmatched-charge: order #${order.id} bound and ${order.paymentStatus}; resolved ${new Date().toISOString()}`);
          } else {
            await mark(reference, `unmatched-charge: order #${order.id} bound after the retry window; handed to stuck-order recovery ${new Date().toISOString()}`);
            needOrderRecovery = true;
          }
        } else if (!['paid', 'refunded'].includes(order.paymentStatus)) {
          needOrderRecovery = true;
        }
        continue;
      }

      // No order: establish live provider state before calling this a
      // collected charge.
      let tx = null;
      try {
        const verified = await paystackServices.verifyTransaction(reference);
        tx = verified?.status && verified?.data ? verified.data : null;
      } catch (err) {
        // State not established — leave the receipt exactly as it is and
        // retry next run. Never mark, never alert on a transient failure.
        console.warn(` unmatched-charges: ${reference} — provider verification unavailable (${err.message}); receipt left for the next run`);
        continue;
      }
      const reported = String(row.last_error || '').includes('unmatched-charge:');
      if (tx && tx.status === 'success') {
        unmatched += 1;
        if (!reported) {
          await mark(
            reference,
            `unmatched-charge: verified success ${tx.amount ?? '?'} ${tx.currency ?? '?'} at ${new Date().toISOString()}; no order bound; operator review required`
          );
          console.error(` unmatched-charges: ${reference} — verified success (${(Number(tx.amount) || 0) / 100} ${tx.currency}) with no bound order; operator review required`);
          await notifyAdmins(
            'Unmatched successful payment',
            `Reference ${reference} verifies as a successful ${((Number(tx.amount) || 0) / 100)} ${tx.currency} charge at Paystack, but no order is bound to it. The signed webhook receipt is preserved in webhook_events. Investigate the order (once it exists this job hands off to normal recovery) or refund via the Paystack dashboard. No order was created and no refund was issued automatically.`
          );
        }
      } else if (!reported) {
        await mark(
          reference,
          `unmatched-charge: provider reports ${tx?.status ?? 'no transaction'} at ${new Date().toISOString()}; no order bound; no action taken`
        );
        console.error(` unmatched-charges: ${reference} — receipt not confirmed by the provider (status ${tx?.status ?? 'unavailable'}); no action taken`);
      }
    } catch (err) {
      console.warn(` unmatched-charges: could not reconcile receipt ${row.reference}: ${err.message}`);
    }
  }

  if (needOrderRecovery) {
    try {
      // Dynamic import: escrowService statically imports this module (it calls
      // reconcileTerminalOrderCharge), so the dependency must stay lazy.
      const { recoverStuckPendingOrders } = await import('./escrowService.js');
      await recoverStuckPendingOrders();
    } catch (err) {
      console.warn(` unmatched-charges: stuck-order recovery could not run: ${err.message}`);
    }
  }
  return unmatched;
};

export default reconcileTerminalOrderCharge;
