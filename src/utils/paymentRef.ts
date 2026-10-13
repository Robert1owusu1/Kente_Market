// utils/paymentRef.ts
// Persists the Paystack reference of a charge that already SUCCEEDED so a
// failure in the follow-up order/verify call can be retried with the SAME
// reference instead of inviting the customer to pay twice (double charge).
// sessionStorage keyed by order id: survives the page navigation/refresh that
// a payment redirect may cause, but dies with the tab.
//
// This is UI recovery state ONLY — never financial authority. The server
// verifies every reference against Paystack (status, amount, currency,
// ownership) and the Paystack webhook is the source of truth for payment
// state, so losing this entry (cleared storage, closed tab) costs at most a
// delayed confirmation that the backend reconciles — never a payment.

const REF_KEY_PREFIX = 'pendingPaymentRef:';

// Stale references are worthless a day later: the charge either settled long
// ago (the server already reconciled it) or never completed. Expiry keeps an
// old tab's reference from being replayed against an unrelated retry much
// later in the same browsing session.
const REF_TTL_MS = 24 * 60 * 60 * 1000;

// `scope` namespaces EVERY bucket — drafts and real ids — so the two checkout
// flows (regular order checkout vs custom-request checkout) in the same tab
// can never collide on — or read — each other's pending reference. Order ids
// and custom-request ids are independent counters, so "the id already
// discriminates" was false: order #7 and custom request #7 shared one flat
// key, and each flow could read (or overwrite) the other's reference, then
// verify a Paystack transaction that belongs to an unrelated checkout.
//
// Flat keys written by an older build in the same tab (`pendingPaymentRef:<id>`,
// no scope) are deliberately NOT read: they are ambiguous between the two
// flows, and adopting the wrong flow's reference would verify an unrelated
// transaction. Losing a mid-flight entry costs at most a delayed
// confirmation — the server reconciles via webhook / verify fallback, never
// the other way around.
export const paymentRefKey = (
  orderId: number | string | null | undefined,
  scope: 'order' | 'custom' = 'order'
): string =>
  orderId == null
    ? `${REF_KEY_PREFIX}${scope}:draft`
    : `${REF_KEY_PREFIX}${scope}:${orderId}`;

type StoredRef = { reference: string; savedAt: number };

export const savePendingPaymentRef = (
  orderId: number | string | null | undefined,
  reference: string,
  scope: 'order' | 'custom' = 'order'
): void => {
  try {
    const payload: StoredRef = { reference, savedAt: Date.now() };
    sessionStorage.setItem(paymentRefKey(orderId, scope), JSON.stringify(payload));
  } catch {
    /* private mode / quota — the in-memory ref still covers this session */
  }
};

export const readPendingPaymentRef = (
  orderId: number | string | null | undefined,
  scope: 'order' | 'custom' = 'order'
): string | null => {
  try {
    const key = paymentRefKey(orderId, scope);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    let stored: StoredRef | null = null;
    try {
      const parsed = JSON.parse(raw);
      stored = parsed && typeof parsed.reference === 'string' ? parsed : null;
    } catch {
      // Legacy plain-string format written by an earlier build in this same
      // tab. Accept it (the tab cannot outlive the session anyway) and let it
      // expire with the TTL from the moment it is first re-read.
      stored = { reference: raw, savedAt: Date.now() };
    }
    if (!stored) {
      sessionStorage.removeItem(key);
      return null;
    }
    if (Date.now() - stored.savedAt > REF_TTL_MS) {
      sessionStorage.removeItem(key); // stale — never replayed
      return null;
    }
    return stored.reference;
  } catch {
    return null;
  }
};

export const clearPendingPaymentRef = (
  orderId: number | string | null | undefined,
  scope: 'order' | 'custom' = 'order'
): void => {
  try {
    sessionStorage.removeItem(paymentRefKey(orderId, scope));
  } catch {
    /* best effort */
  }
};

// Shown when a charge succeeded but confirmation could not be completed — the
// user must NOT be told to pay again with a fresh reference.
export const PAYMENT_CONFIRMATION_DELAYED_MESSAGE =
  'Payment received but confirmation is delayed — your order will update automatically. Contact support if this persists.';
