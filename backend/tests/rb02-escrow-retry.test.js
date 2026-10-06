// FILE LOCATION: backend/tests/rb02-escrow-retry.test.js
// DESCRIPTION: Regression tests for RB-02 escrow retry after refund/void.
//   1. wallet credit failure
//   2. retry before refund
//   3. retry after refund
//   4. retry after void
//   5. duplicate retry
//   6. concurrent retry workers
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

const baseTs = Date.now();
const state = { vendorId: null, userId: null, orderId: null, allocationId: null };

before(async () => {
  if (!dbAvailable || !pool) return;

  // Create a test vendor user
  const [vendorRes] = await pool.execute(
    `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
     VALUES ('RB02', 'Vendor', ?, ?, 'vendor', 1, 1)`,
    [`rb02-vendor-${baseTs}@test.local`, 'hashedpass']
  );
  state.vendorId = vendorRes.insertId;

  await pool.execute(
    `INSERT INTO vendors (userId, businessName, status, recipientCode)
     VALUES (?, ?, 'approved', 'RCP_test')`,
    [state.vendorId, `RB02 Vendor ${baseTs}`]
  );

  // Create a test customer user
  const [userRes] = await pool.execute(
    `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
     VALUES ('RB02', 'Customer', ?, ?, 'customer', 1, 1)`,
    [`rb02-customer-${baseTs}@test.local`, 'hashedpass']
  );
  state.userId = userRes.insertId;
});

after(async () => {
  if (!dbAvailable || !pool) return;
  try {
    if (state.orderId) {
      await pool.execute(`DELETE FROM escrow_allocations WHERE orderId = ?`, [state.orderId]);
      await pool.execute(`DELETE FROM order_items WHERE orderId = ?`, [state.orderId]);
      await pool.execute(`DELETE FROM orders WHERE id = ?`, [state.orderId]);
    }
    if (state.vendorId) {
      await pool.execute(`DELETE FROM vendor_wallets WHERE vendorId = ?`, [state.vendorId]);
      await pool.execute(`DELETE FROM wallet_transactions WHERE vendorId = ?`, [state.vendorId]);
      await pool.execute(`DELETE FROM vendors WHERE userId = ?`, [state.vendorId]);
      await pool.execute(`DELETE FROM users WHERE id = ?`, [state.vendorId]);
    }
    if (state.userId) {
      await pool.execute(`DELETE FROM users WHERE id = ?`, [state.userId]);
    }
  } finally {
    await pool.end();
  }
});

// Helper to generate unique test values per test
let testCounter = 0;
const genTs = () => `${Date.now()}-${++testCounter}-${Math.random().toString(36).slice(2, 8)}`;

describe('RB-02: Escrow retry after refund/void', { skip: !dbAvailable }, () => {
  test('1. wallet credit failure (allocation stuck in failed, can be retried)', async () => {
    const { retryFailedAllocations } = await import('../Services/escrowService.js');
    const ts = genTs();

    // Create a paid order with a failed allocation (simulating wallet credit failure)
    const [orderRes] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentReference)
       VALUES (?, ?, ?, 100.00, 'paid', 'processing', 'failed', ?)`,
      [state.userId, `RB02-ORDER-${ts}-1`, JSON.stringify([]), `REF1-${ts}`]
    );
    const orderId = orderRes.insertId;

    const [allocRes] = await pool.execute(
      `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType)
       VALUES (?, ?, 100.00, 0.1000, 10.00, 90.00, 'failed', 'standard')`,
      [orderId, state.vendorId]
    );
    const allocationId = allocRes.insertId;

    // Retry should succeed (move to held, then release to available)
    const result = await retryFailedAllocations(orderId);
    assert.equal(result.retried, 1, 'should retry 1 allocation');
    assert.equal(result.failed, 0, 'should not fail');

    const [[alloc]] = await pool.execute(`SELECT status FROM escrow_allocations WHERE id = ?`, [allocationId]);
    // releaseAllocation transitions held -> available (credits wallet), not releasing
    assert.equal(alloc.status, 'available', 'allocation should be available after retry');

    // Cleanup
    await pool.execute(`DELETE FROM escrow_allocations WHERE orderId = ?`, [orderId]);
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [orderId]);
  });

  test('2. retry before refund (should succeed)', async () => {
    const { retryFailedAllocations } = await import('../Services/escrowService.js');
    const ts = genTs();

    // Create a paid order with a failed allocation (NOT refunded)
    const [orderRes] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentReference)
       VALUES (?, ?, ?, 100.00, 'paid', 'processing', 'failed', ?)`,
      [state.userId, `RB02-ORDER-${ts}-2`, JSON.stringify([]), `REF2-${ts}`]
    );
    const orderId = orderRes.insertId;

    const [allocRes] = await pool.execute(
      `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType)
       VALUES (?, ?, 100.00, 0.1000, 10.00, 90.00, 'failed', 'standard')`,
      [orderId, state.vendorId]
    );
    const allocationId = allocRes.insertId;

    // Retry should succeed
    const result = await retryFailedAllocations(orderId);
    assert.equal(result.retried, 1, 'should retry 1 allocation before refund');
    assert.equal(result.failed, 0);

    const [[alloc]] = await pool.execute(`SELECT status FROM escrow_allocations WHERE id = ?`, [allocationId]);
    assert.equal(alloc.status, 'available', 'allocation should be available after retry');

    // Cleanup
    await pool.execute(`DELETE FROM escrow_allocations WHERE orderId = ?`, [orderId]);
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [orderId]);
  });

  test('3. retry after refund (should NOT retry - allocation stays failed)', async () => {
    const { retryFailedAllocations } = await import('../Services/escrowService.js');
    const ts = genTs();

    // Create a REFUNDED order with a failed allocation
    const [orderRes] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentReference, refundReference)
       VALUES (?, ?, ?, 100.00, 'refunded', 'cancelled', 'failed', ?, ?)`,
      [state.userId, `RB02-ORDER-${ts}-3`, JSON.stringify([]), `REF3-${ts}`, `RFD3-${ts}`]
    );
    const orderId = orderRes.insertId;

    const [allocRes] = await pool.execute(
      `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType)
       VALUES (?, ?, 100.00, 0.1000, 10.00, 90.00, 'failed', 'standard')`,
      [orderId, state.vendorId]
    );
    const allocationId = allocRes.insertId;

    // Retry should NOT succeed - order is refunded
    const result = await retryFailedAllocations(orderId);
    // After fix: should return retried: 0, skipped > 0
    assert.equal(result.retried, 0, 'should not retry refunded order');
    assert.ok(result.skipped > 0, 'should skip the failed allocation');

    const [[alloc]] = await pool.execute(`SELECT status FROM escrow_allocations WHERE id = ?`, [allocationId]);
    // After fix: should remain 'failed' (not retried)
    assert.equal(alloc.status, 'failed', 'allocation should remain failed for refunded order');

    // Cleanup
    await pool.execute(`DELETE FROM escrow_allocations WHERE orderId = ?`, [orderId]);
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [orderId]);
  });

  test('4. retry after void (should NOT retry - allocation stays failed)', async () => {
    const { retryFailedAllocations } = await import('../Services/escrowService.js');
    const ts = genTs();

    // Create a CANCELLED (voided) order with a failed allocation
    const [orderRes] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentReference)
       VALUES (?, ?, ?, 100.00, 'pending', 'cancelled', 'failed', ?)`,
      [state.userId, `RB02-ORDER-${ts}-4`, JSON.stringify([]), `REF4-${ts}`]
    );
    const orderId = orderRes.insertId;

    const [allocRes] = await pool.execute(
      `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType)
       VALUES (?, ?, 100.00, 0.1000, 10.00, 90.00, 'failed', 'standard')`,
      [orderId, state.vendorId]
    );
    const allocationId = allocRes.insertId;

    // Retry should NOT succeed - order is voided/cancelled
    const result = await retryFailedAllocations(orderId);
    assert.equal(result.retried, 0, 'should not retry cancelled order');
    assert.ok(result.skipped > 0, 'should skip the failed allocation');

    const [[alloc]] = await pool.execute(`SELECT status FROM escrow_allocations WHERE id = ?`, [allocationId]);
    // After fix: should remain 'failed'
    assert.equal(alloc.status, 'failed', 'allocation should remain failed for cancelled order');

    // Cleanup
    await pool.execute(`DELETE FROM escrow_allocations WHERE orderId = ?`, [orderId]);
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [orderId]);
  });

  test('5. duplicate retry (idempotent - second retry does not double-process)', async () => {
    const { retryFailedAllocations } = await import('../Services/escrowService.js');
    const ts = genTs();

    // Create a paid order with a failed allocation
    const [orderRes] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentReference)
       VALUES (?, ?, ?, 100.00, 'paid', 'processing', 'failed', ?)`,
      [state.userId, `RB02-ORDER-${ts}-5`, JSON.stringify([]), `REF5-${ts}`]
    );
    const orderId = orderRes.insertId;

    const [allocRes] = await pool.execute(
      `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType)
       VALUES (?, ?, 100.00, 0.1000, 10.00, 90.00, 'failed', 'standard')`,
      [orderId, state.vendorId]
    );
    const _allocationId = allocRes.insertId;

    // First retry
    const result1 = await retryFailedAllocations(orderId);
    assert.equal(result1.retried, 1);

    // Second retry (should be idempotent - allocation is no longer 'failed')
    const result2 = await retryFailedAllocations(orderId);
    assert.equal(result2.retried, 0, 'second retry should not retry again');
    assert.equal(result2.failed, 0);

    // Cleanup
    await pool.execute(`DELETE FROM escrow_allocations WHERE orderId = ?`, [orderId]);
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [orderId]);
  });

  test('6. concurrent retry workers (only one should succeed)', async () => {
    const { retryFailedAllocations } = await import('../Services/escrowService.js');
    const ts = genTs();

    // Create a paid order with a failed allocation
    const [orderRes] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentReference)
       VALUES (?, ?, ?, 100.00, 'paid', 'processing', 'failed', ?)`,
      [state.userId, `RB02-ORDER-${ts}-6`, JSON.stringify([]), `REF6-${ts}`]
    );
    const orderId = orderRes.insertId;

    const [allocRes] = await pool.execute(
      `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType)
       VALUES (?, ?, 100.00, 0.1000, 10.00, 90.00, 'failed', 'standard')`,
      [orderId, state.vendorId]
    );
    const _allocationId = allocRes.insertId;

    // Run two concurrent retries
    const [result1, result2] = await Promise.all([
      retryFailedAllocations(orderId),
      retryFailedAllocations(orderId),
    ]);

    // Only one should succeed in retrying
    const totalRetried = result1.retried + result2.retried;
    assert.equal(totalRetried, 1, 'only one worker should retry the allocation');

    // Cleanup
    await pool.execute(`DELETE FROM escrow_allocations WHERE orderId = ?`, [orderId]);
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [orderId]);
  });
});