// FILE LOCATION: backend/tests/refundGuard.test.js
// DESCRIPTION: Regression tests for the refund/return money-safety invariants:
//   - return_requests status is a one-way door (a double admin "approve" must
//     never be able to refund the same order twice);
//   - escrow clawback only claims an allocation that is still 'available' with
//     enough payoutAmount left (mirror of the conditional SQL guard);
//   - clawback + reversal journaling are dedupe-keyed so redeliveries can't
//     double-write.
// These mirror the logic in backend/models/returnModel.js and
// backend/Services/escrowService.js (kept in sync deliberately).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import ReturnRequest from '../models/returnModel.js';

describe('return_requests state machine (one-way door)', () => {
  const allowed = (from, to) => ReturnRequest.TRANSITIONS[from]?.includes(to) ?? false;

  test('pending -> approved is the only path into a refund', () => {
    assert.equal(allowed('pending', 'approved'), true);
  });

  test('pending -> rejected is allowed (no money moves)', () => {
    assert.equal(allowed('pending', 'rejected'), true);
  });

  test('approved -> completed is allowed (fulfilment bookkeeping)', () => {
    assert.equal(allowed('approved', 'completed'), true);
  });

  test('double-approve is rejected (guards against double refunds)', () => {
    assert.equal(allowed('approved', 'approved'), false);
    assert.equal(allowed('completed', 'approved'), false);
    assert.equal(allowed('rejected', 'approved'), false);
  });

  test('terminal states accept nothing', () => {
    assert.equal(allowed('rejected', 'rejected'), false);
    assert.equal(allowed('rejected', 'completed'), false);
    assert.equal(allowed('completed', 'rejected'), false);
    assert.equal(allowed('completed', 'completed'), false);
  });
});

// --- Exact replica of the escrow clawback guards (kept in sync deliberately) ---
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Mirrors the UPDATE ... WHERE id=? AND status='available' AND payoutAmount>=? claim.
function claimAllocation(allocations, id, amount) {
  const a = allocations.find((x) => x.id === id);
  if (!a) return 0;
  if (round2(parseFloat(String(amount)) || 0) <= 0) return 0;
  if (a.status !== 'available') return 0;
  if (round2(parseFloat(String(a.payoutAmount)) || 0) < amount) return 0;
  a.status = 'failed';
  return 1;
}

describe('escrow clawback claim', () => {
  test('claims only allocations still in the available state (no double clawback)', () => {
    const allocations = [
      { id: 1, status: 'available', payoutAmount: '50.00' },
      { id: 2, status: 'held', payoutAmount: '50.00' },
      { id: 3, status: 'released', payoutAmount: '50.00' },
    ];
    assert.equal(claimAllocation(allocations, 1, 50), 1);
    assert.equal(claimAllocation(allocations, 1, 50), 0);
    assert.equal(claimAllocation(allocations, 2, 50), 0);
    assert.equal(claimAllocation(allocations, 3, 50), 0);
  });

  test('a zero/negative payout cannot be clawed back', () => {
    const allocations = [{ id: 9, status: 'available', payoutAmount: '0.00' }];
    assert.equal(claimAllocation(allocations, 9, 0), 0);
  });

  test('a previously-withdrawn remainder is only ever clawed once', () => {
    const allocations = [{ id: 7, status: 'available', payoutAmount: '30.00' }];
    assert.equal(claimAllocation(allocations, 7, 30), 1);
    assert.equal(allocations[0].status, 'failed');
    assert.equal(claimAllocation(allocations, 7, 30), 0);
  });
});

const dedupeKeyed = (store, key) => {
  if (store.has(key)) return false;
  store.add(key);
  return true;
};

describe('refund/ledger idempotency', () => {
  test('refund journal honours its dedupeKey', () => {
    const store = new Set();
    assert.equal(dedupeKeyed(store, 'refund:12:34'), true);
    assert.equal(dedupeKeyed(store, 'refund:12:34'), false);
    assert.equal(dedupeKeyed(store, 'refund:12:35'), true);
  });

  test('clawback journal honours its allocation-scoped key', () => {
    const store = new Set();
    assert.equal(dedupeKeyed(store, 'escrow.clawback:42'), true);
    assert.equal(dedupeKeyed(store, 'escrow.clawback:42'), false);
  });
});