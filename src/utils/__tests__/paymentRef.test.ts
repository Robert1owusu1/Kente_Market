// Same-reference retry persistence: the anti-double-charge primitive.
import { describe, test, expect, beforeEach } from 'vitest';
import {
  paymentRefKey,
  savePendingPaymentRef,
  readPendingPaymentRef,
  clearPendingPaymentRef,
} from '../paymentRef';

const store = new Map<string, string>();
// Minimal sessionStorage stand-in (node environment has none).
(globalThis as Record<string, unknown>).sessionStorage = {
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  removeItem: (k: string) => void store.delete(k),
};

beforeEach(() => store.clear());

describe('paymentRef', () => {
  test('key format + draft fallback', () => {
    expect(paymentRefKey(42)).toBe('pendingPaymentRef:42');
    expect(paymentRefKey(null)).toBe('pendingPaymentRef:draft');
    expect(paymentRefKey(undefined)).toBe('pendingPaymentRef:draft');
  });

  test('save/read/clear round-trip isolates order ids', () => {
    savePendingPaymentRef(1, 'ORDER_1_abc');
    savePendingPaymentRef(2, 'ORDER_2_xyz');
    expect(readPendingPaymentRef(1)).toBe('ORDER_1_abc');
    clearPendingPaymentRef(1);
    expect(readPendingPaymentRef(1)).toBeNull();
    expect(readPendingPaymentRef(2)).toBe('ORDER_2_xyz');
  });

  test('missing ref reads null (retry path stands down)', () => {
    expect(readPendingPaymentRef(999)).toBeNull();
  });
});
