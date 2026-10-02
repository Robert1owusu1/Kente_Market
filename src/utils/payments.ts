// utils/payments.ts — checkout money helpers (extracted for unit testing).
// Behavior matches the inline checkout math exactly:
// server total wins when finite and positive, else the local fallback;
// pesewa conversion rounds half away from float error.

/** Convert a GHS amount to pesewas for Paystack. Non-positive/non-finite -> 0. */
export const toPesewas = (amountGhs: number | string): number => {
  const n = Number(amountGhs);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
};

/** Server total wins when usable; otherwise the locally computed fallback. */
export const resolvePayableTotal = (serverTotal: number, localTotal: number): number =>
  Number.isFinite(serverTotal) && serverTotal > 0 ? serverTotal : localTotal;
