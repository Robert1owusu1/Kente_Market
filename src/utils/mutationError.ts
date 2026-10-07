// FILE LOCATION: src/utils/mutationError.ts
// DESCRIPTION: N-20 — turn an RTK Query `unwrap()` rejection into an honest
//              toast, and flag when the outcome is genuinely unknown.
//
// Why this exists: `unwrap()` puts the HTTP body in `err.data`, but a
// transport-level failure has NO body at all — when `fetch` rejects, or when
// fetchBaseQuery's `timeout: 15000` fires (RTK answers `{ status:
// 'TIMEOUT_ERROR', data: undefined }`), `err.data` is undefined. Every call
// site wrote `err?.data?.message || 'Failed …'`, so those failures were always
// reported as a generic failure even when the server had already committed
// the write.
//
// That is exactly what production N-20 looked like: advancing an order
// blocked the HTTP response behind a customer notification + SMTP send, the
// browser gave up at 15 s, and the vendor was told "Failed to update order
// status" for a save that had already landed (order row updated, POST
// recorded as status 0). A "failed" message for an applied change is worse
// than no message: the vendor repeats an action the server already took.

/**
 * Outcome of classifying a mutation rejection.
 *
 * `uncertain === true` means the client never saw a response, so the server
 * MAY still have applied the change — the caller must re-sync rather than
 * leave the UI asserting something it cannot know.
 */
export type MutationErrorOutcome = {
  /** Text safe to show a user. */
  message: string;
  /** True when the request may have been applied server-side. */
  uncertain: boolean;
};

/**
 * Transport-level failures: no response was observed. Note what is NOT here —
 * `PARSING_ERROR` means a response DID arrive (just not JSON, e.g. a gateway
 * error page), so its outcome is known and not uncertain.
 */
const UNCERTAIN_STATUSES: ReadonlySet<string> = new Set(['FETCH_ERROR', 'TIMEOUT_ERROR', 'ABORT_ERROR']);

export const UNCERTAIN_OUTCOME_MESSAGE =
  'Connection problem — this may still have been saved. Re-syncing…';

/**
 * @param error  the value `unwrap()` rejected with
 * @param fallback message to use when the server gave us nothing to show
 */
export const describeMutationError = (
  error: unknown,
  fallback: string,
): MutationErrorOutcome => {
  const err = error as
    | { status?: unknown; data?: { message?: unknown }; error?: unknown }
    | undefined;

  const serverMessage = err?.data?.message;
  if (typeof serverMessage === 'string' && serverMessage.trim().length > 0) {
    // The server answered and explained itself — highest-fidelity message
    // available, and the outcome is known.
    return { message: serverMessage, uncertain: false };
  }

  if (typeof err?.status === 'string' && UNCERTAIN_STATUSES.has(err.status)) {
    return { message: UNCERTAIN_OUTCOME_MESSAGE, uncertain: true };
  }

  return { message: fallback, uncertain: false };
};
