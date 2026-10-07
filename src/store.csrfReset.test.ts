// FILE LOCATION: src/store.csrfReset.test.ts
// DESCRIPTION: the second half of N-19 — the SPA's in-memory CSRF token must
//              be dropped whenever the auth object changes, not merely when
//              the signed-in boolean flips.
//
// Session issuance always rotates the csrf_token cookie (`generateToken` →
// `setCsrfCookie`). If the cached token survives that rotation, every later
// state-changing request sends header≠cookie and the backend answers
// 403 "CSRF token mismatch" — the same user-visible failure as the OAuth
// incident, one step further along the flow. The flip-based reset missed the
// case where localStorage still holds `userInfo` (expired JWT, no 401 seen
// yet) when the user signs in again: true → true, so nothing reset.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const resetSpy = vi.hoisted(() => vi.fn());

vi.mock('./utils/csrf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/csrf')>();
  // Keep the real implementation: other code in the store's dependency graph
  // must keep working; we only count calls.
  return { ...actual, resetCsrfToken: resetSpy };
});

const { default: store } = await import('./store');
const { setCredentials, logout } = await import('./slices/authSlice');

const resets = () => resetSpy.mock.calls.length;
const signIn = (id: number) =>
  store.dispatch(setCredentials({ id, role: 'customer', firstName: `u${id}` }));

beforeEach(() => {
  resetSpy.mockClear();
});

describe('CSRF cache invalidation on auth transitions', () => {
  it('drops the cached token when a user signs in', () => {
    const before = resets();
    signIn(1);
    expect(resets()).toBe(before + 1);
  });

  it('drops the cached token when a user signs out', () => {
    signIn(2);
    const before = resets();
    store.dispatch(logout());
    expect(resets()).toBe(before + 1);
  });

  it('drops it on a RE-sign-in that never flips the signed-in flag', () => {
    // The exact hole the boolean comparison left: userInfo is already present
    // (persisted from an expired session), so signing in again is true → true,
    // yet the session issuance just rotated the cookie under the cached token.
    signIn(3);
    const before = resets();
    signIn(3);
    expect(resets()).toBe(before + 1);
  });

  it('leaves the cache alone on unrelated dispatches', () => {
    signIn(4);
    const before = resets();
    store.dispatch({ type: 'cart/unknownAction' });
    store.dispatch({ type: 'products/unknownAction' });
    expect(resets()).toBe(before);
  });

  it('does not reset twice for the same stored user (no churn on plain renders)', () => {
    signIn(5);
    const before = resets();
    // Re-dispatching nothing but reducer-noise must not invalidate the cache.
    store.dispatch({ type: 'app/tick' });
    store.dispatch({ type: 'app/tick' });
    expect(resets()).toBe(before);
  });
});
