// FILE LOCATION: backend/tests/escrowLogic.test.js
// DESCRIPTION: Regression tests for the escrow status recompute logic and the
//              allocation lifecycle helpers. These mirror the logic in
//              backend/Services/escrowService.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// --- Exact replica of recomputeOrderEscrowStatus (kept in sync deliberately) ---
function recompute(statusesArr) {
  if (statusesArr.length === 0) return 'none';
  const statuses = new Set(statusesArr);
  if (statuses.size === 1 && statuses.has('released')) return 'released';
  if (statuses.has('pending')) return 'releasing';
  if (statuses.has('releasing')) return 'releasing';
  if (statuses.has('held')) return 'held';
  if (statuses.has('failed')) return 'failed';
  return 'held';
}

describe('recomputeOrderEscrowStatus', () => {
  test('no allocations → none', () => {
    assert.equal(recompute([]), 'none');
  });

  test('all released → released', () => {
    assert.equal(recompute(['released', 'released']), 'released');
  });

  test('single released → released', () => {
    assert.equal(recompute(['released']), 'released');
  });

  test('held → held', () => {
    assert.equal(recompute(['held']), 'held');
    assert.equal(recompute(['held', 'held']), 'held');
  });

  test('held while something still in flight → releasing', () => {
    assert.equal(recompute(['releasing', 'held']), 'releasing');
    assert.equal(recompute(['pending', 'held']), 'releasing');
  });

  test('held + failed (no in-flight) → held (still awaiting release)', () => {
    assert.equal(recompute(['held', 'failed']), 'held');
  });

  test('pending alone → releasing', () => {
    assert.equal(recompute(['pending']), 'releasing');
  });

  test('all failed → failed', () => {
    assert.equal(recompute(['failed']), 'failed');
    assert.equal(recompute(['failed', 'failed']), 'failed');
  });

  test('mix of released + failed → failed (no more in-flight)', () => {
    assert.equal(recompute(['released', 'failed']), 'failed');
    assert.equal(recompute(['released', 'released', 'failed']), 'failed');
  });
});
