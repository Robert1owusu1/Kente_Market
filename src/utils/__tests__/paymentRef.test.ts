// Same-reference retry persistence: the anti-double-charge primitive.
import { describe, test, expect, beforeEach, vi } from 'vitest';
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

beforeEach(() => {
  store.clear();
  vi.restoreAllMocks();
});

describe('paymentRef', () => {
  test('key format: scope namespaces drafts AND real ids', () => {
    expect(paymentRefKey(42)).toBe('pendingPaymentRef:order:42');
    // The draft bucket is namespaced per checkout flow so an order checkout
    // and a custom-request checkout in the same tab can never collide.
    expect(paymentRefKey(null)).toBe('pendingPaymentRef:order:draft');
    expect(paymentRefKey(undefined)).toBe('pendingPaymentRef:order:draft');
    expect(paymentRefKey(null, 'custom')).toBe('pendingPaymentRef:custom:draft');
    // Real ids are scoped too: order ids and custom-request ids are
    // independent counters, so id 7 exists in BOTH flows.
    expect(paymentRefKey(7, 'custom')).toBe('pendingPaymentRef:custom:7');
  });

  test('regression: the same numeric id in both flows never collides', () => {
    // The bug this pins: both flows used to share `pendingPaymentRef:7`, so
    // custom-request checkout could read (and overwrite) order 7's reference
    // — and then verify a Paystack transaction belonging to the other
    // checkout entirely.
    savePendingPaymentRef(7, 'ORDER_7_ref');
    savePendingPaymentRef(7, 'CUSTOM_7_ref', 'custom');
    expect(readPendingPaymentRef(7)).toBe('ORDER_7_ref');
    expect(readPendingPaymentRef(7, 'custom')).toBe('CUSTOM_7_ref');
    // Clearing one flow's entry must not disturb the other's.
    clearPendingPaymentRef(7);
    expect(readPendingPaymentRef(7)).toBeNull();
    expect(readPendingPaymentRef(7, 'custom')).toBe('CUSTOM_7_ref');
  });

  test('save/read/clear round-trip isolates order ids', () => {
    savePendingPaymentRef(1, 'ORDER_1_abc');
    savePendingPaymentRef(2, 'ORDER_2_xyz');
    expect(readPendingPaymentRef(1)).toBe('ORDER_1_abc');
    clearPendingPaymentRef(1);
    expect(readPendingPaymentRef(1)).toBeNull();
    expect(readPendingPaymentRef(2)).toBe('ORDER_2_xyz');
  });

  test('unrelated draft checkouts in the same tab do not collide', () => {
    savePendingPaymentRef(null, 'ORDER_draft_a');
    savePendingPaymentRef(null, 'CUSTOM_draft_b', 'custom');
    expect(readPendingPaymentRef(null)).toBe('ORDER_draft_a');
    expect(readPendingPaymentRef(null, 'custom')).toBe('CUSTOM_draft_b');
  });

  test('missing ref reads null (retry path stands down)', () => {
    expect(readPendingPaymentRef(999)).toBeNull();
  });

  test('stale references expire and are removed, never replayed', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-01T10:00:00Z'));
      savePendingPaymentRef(9, 'ORDER_9_fresh');
      expect(readPendingPaymentRef(9)).toBe('ORDER_9_fresh');

      // 25h later: past the 24h TTL → null AND the key is gone.
      vi.setSystemTime(new Date('2026-10-02T11:00:00Z'));
      expect(readPendingPaymentRef(9)).toBeNull();
      expect(store.has('pendingPaymentRef:order:9')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test('legacy FLAT keys from an older build are deliberately not read', () => {
    // `pendingPaymentRef:<id>` (no scope) was written by BOTH flows in older
    // builds, so adopting it could attach the wrong flow's reference and
    // verify an unrelated transaction. The entry is left to expire unread;
    // losing it costs at most a delayed confirmation (the server reconciles).
    store.set('pendingPaymentRef:5', 'ORDER_5_legacy');
    expect(readPendingPaymentRef(5)).toBeNull();
  });

  test('legacy plain-string VALUES under the scoped key are still readable', () => {
    store.set('pendingPaymentRef:order:5', 'ORDER_5_legacy');
    expect(readPendingPaymentRef(5)).toBe('ORDER_5_legacy');
  });

  test('a corrupt entry reads null and is cleaned up', () => {
    store.set('pendingPaymentRef:order:6', JSON.stringify({ nope: true }));
    expect(readPendingPaymentRef(6)).toBeNull();
    expect(store.has('pendingPaymentRef:order:6')).toBe(false);
  });
});
