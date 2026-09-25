// utils/paymentRef.ts
// Persists the Paystack reference of a charge that already SUCCEEDED so a
// failure in the follow-up order/verify call can be retried with the SAME
// reference instead of inviting the customer to pay twice (double charge).
// sessionStorage keyed by order id: survives the page navigation/refresh that
// a payment redirect may cause, but dies with the tab.

const REF_KEY_PREFIX = 'pendingPaymentRef:';

export const paymentRefKey = (orderId: number | string | null | undefined): string =>
  `${REF_KEY_PREFIX}${orderId ?? 'draft'}`;

export const savePendingPaymentRef = (
  orderId: number | string | null | undefined,
  reference: string
): void => {
  try {
    sessionStorage.setItem(paymentRefKey(orderId), reference);
  } catch {
    /* private mode / quota — the in-memory ref still covers this session */
  }
};

export const readPendingPaymentRef = (
  orderId: number | string | null | undefined
): string | null => {
  try {
    return sessionStorage.getItem(paymentRefKey(orderId));
  } catch {
    return null;
  }
};

export const clearPendingPaymentRef = (
  orderId: number | string | null | undefined
): void => {
  try {
    sessionStorage.removeItem(paymentRefKey(orderId));
  } catch {
    /* best effort */
  }
};

// Shown when a charge succeeded but confirmation could not be completed — the
// user must NOT be told to pay again with a fresh reference.
export const PAYMENT_CONFIRMATION_DELAYED_MESSAGE =
  'Payment received but confirmation is delayed — your order will update automatically. Contact support if this persists.';
