// FILE LOCATION: src/utils/__tests__/mutationError.test.ts
// DESCRIPTION: N-20 regression coverage for honest mutation failures.
//
// Why this exists: `unwrap()` only carries a body when the server answered.
// A transport failure — fetch rejecting, or fetchBaseQuery's `timeout: 15000`
// firing (RTK returns `{ status: 'TIMEOUT_ERROR', data: undefined }`) — has no
// `data` at all, so the old `err?.data?.message || 'Failed …'` pattern turned
// every timeout into a generic "failed" claim. In production that claim was
// FALSE: the vendor's order status had already been written when the client
// gave up at 15 s.
//
// The last block is a source guard over the two screens that mutate order
// status, so the call sites cannot drift back to the old pattern.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  describeMutationError,
  UNCERTAIN_OUTCOME_MESSAGE,
} from '../mutationError';

describe('describeMutationError', () => {
  it('shows the server message when the server answered', () => {
    expect(describeMutationError({ status: 403, data: { message: 'Not authorized' } }, 'fallback'))
      .toEqual({ message: 'Not authorized', uncertain: false });
  });

  it('treats a 15s client timeout as an unknown outcome', () => {
    // The exact shape RTK produced for the reported incident: no body to read.
    expect(describeMutationError({ status: 'TIMEOUT_ERROR', error: 'TimeoutError' }, 'fallback'))
      .toEqual({ message: UNCERTAIN_OUTCOME_MESSAGE, uncertain: true });
  });

  it('treats a rejected fetch as an unknown outcome', () => {
    expect(describeMutationError({ status: 'FETCH_ERROR', error: 'TypeError: Failed to fetch' }, 'fallback'))
      .toEqual({ message: UNCERTAIN_OUTCOME_MESSAGE, uncertain: true });
  });

  it('does not claim uncertainty when a response did arrive', () => {
    // PARSING_ERROR means we got an HTTP response whose body was not JSON
    // (e.g. a gateway error page) — the server's answer is known.
    expect(describeMutationError(
      { status: 'PARSING_ERROR', originalStatus: 502, data: '<html>', error: 'SyntaxError' },
      'fallback',
    )).toEqual({ message: 'fallback', uncertain: false });
  });

  it('ignores an empty server message instead of showing a blank toast', () => {
    expect(describeMutationError({ status: 400, data: { message: '   ' } }, 'fallback'))
      .toEqual({ message: 'fallback', uncertain: false });
  });

  it('falls back for shapes it does not recognise', () => {
    expect(describeMutationError(undefined, 'fallback')).toEqual({ message: 'fallback', uncertain: false });
    expect(describeMutationError(new Error('boom'), 'fallback')).toEqual({ message: 'fallback', uncertain: false });
    expect(describeMutationError({ name: 'AbortError' }, 'fallback')).toEqual({ message: 'fallback', uncertain: false });
  });
});

describe('order status screens use the classifier', () => {
  const screens = [
    '../../Pages/Vendor/VendorOrdersSection.tsx',
    '../../Pages/adminDashboardPages/Orders/OrdersPage.tsx',
  ];

  for (const relative of screens) {
    const name = relative.replace('../../', '');
    const source = fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

    it(`${name} classifies every mutation failure`, () => {
      expect(source).toContain('describeMutationError(');
      // The old pattern must not survive in a toast: a read that fails really
      // did fail (the generic query fallback elsewhere is correct), but a
      // mutation timeout must not be reported as a definite failure.
      expect(source).not.toMatch(/toast\.error\(\s*\w+\?\.data\?\.message\s*\|\|/);
    });

    it(`${name} re-syncs when the outcome is unknown`, () => {
      expect(source).toMatch(/if \(uncertain\) refetch\(\)/);
    });
  }
});
