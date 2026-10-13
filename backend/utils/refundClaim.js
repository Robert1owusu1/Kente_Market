// FILE LOCATION: backend/utils/refundClaim.js
// DESCRIPTION: Bounded builder for the shared refund claim marker stored in
//              orders.refundReference (VARCHAR(191) — see migrateRefundReference.js).
//
// Every refund path CAS-writes a claim marker into orders.refundReference
// BEFORE calling the provider (cancelOrder, the return path, and the
// late-charge reconciler). Several of those markers embed the external
// payment reference, and orders.paymentReference is VARCHAR(255) — so an
// unusually long external reference could overflow the claim column. In
// strict SQL mode the claim UPDATE throws (the refund path dies before the
// provider call); in non-strict mode MySQL truncates the stored value, and
// the release CAS (`WHERE refundReference = ?` with the untruncated value)
// then never matches, permanently stranding the claim.
//
// buildRefundClaim bounds every generated claim to the column size while
// keeping the two properties the CAS protocol depends on:
//   1. DETERMINISM — the same (orderId, kind, reference) always produces the
//      same claim, so a later release/reconciliation recomputing the claim
//      from the same order row always matches what was written.
//   2. UNIQUENESS — two different long references never collapse into the
//      same claim (the digest covers the FULL reference, not the truncated
//      head).
// For references that fit (every reference Paystack itself issues), the claim
// is byte-identical to the historical format, so nothing that parses these
// markers downstream changes behavior.
import crypto from 'crypto';

// orders.refundReference is VARCHAR(191).
export const REFUND_CLAIM_MAX_LENGTH = 191;

/**
 * Build a bounded refund claim marker: `refund:<orderId>:<kind>:<reference>`
 * when it fits, otherwise a deterministic truncated+digested form.
 *
 * @param {number|string} orderId
 * @param {string|number} kind  claim kind ('late-charge', 'cancel', a return id, ...)
 * @param {string|null|undefined} externalRef  the external payment reference
 * @returns {string} a claim guaranteed to fit the refundReference column
 */
export const buildRefundClaim = (orderId, kind, externalRef) => {
  const head = `refund:${orderId}:${kind}:`;
  const ref = externalRef == null ? '' : String(externalRef);
  const full = `${head}${ref}`;
  if (full.length <= REFUND_CLAIM_MAX_LENGTH) return full;

  // Overlong: keep a readable head of the external reference plus a digest of
  // the FULL reference (not of the truncated head, so two references sharing
  // a prefix still claim differently). The digest is prefixed with 'x' so the
  // trailing segment can never parse as a numeric vendor id for code that
  // splits claim markers (see reconcileRefundedButPaid's partial-marker
  // vendor parse).
  const digest = `x${crypto.createHash('sha256').update(ref).digest('hex').slice(0, 31)}`;
  const budget = REFUND_CLAIM_MAX_LENGTH - head.length - digest.length - 1; // -1 for the ':'
  const kept = ref.slice(0, Math.max(0, budget));
  const bounded = `${head}${kept}:${digest}`;
  // Defensive: head is `refund:<int id>:<short kind>:` in every real caller,
  // so this can never trigger — but the column guarantee must be absolute.
  return bounded.length <= REFUND_CLAIM_MAX_LENGTH
    ? bounded
    : `refund:${orderId}:${digest}`;
};
