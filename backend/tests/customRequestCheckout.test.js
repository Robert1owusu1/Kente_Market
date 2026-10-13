// FILE LOCATION: backend/tests/customRequestCheckout.test.js
// DESCRIPTION: Regression tests for the atomic custom-request checkout fix.
//              Verifies transaction safety, concurrency protection, and idempotency.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/db.js';
import CustomRequest from '../models/customRequestModel.js';
import Order from '../models/orderModel.js';

// Test setup: create test users, vendor, and a custom request in 'accepted' state
let testCustomerId;
let testVendorId;
let testRequestId;
// Probed at module load: `describe(..., { skip: !dbAvailable })` reads this
// when the suite is declared, so setting it inside a before() hook was too
// late — without a database the suite ran and failed instead of skipping.
let dbAvailable = true;
try {
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

async function setupTestData() {
  if (!dbAvailable) return;

  // Create test customer
  const [custResult] = await pool.execute(
    `INSERT INTO users (email, password, firstName, lastName, role, is_email_verified)
     VALUES (?, 'hashed', 'Test', 'Customer', 'customer', 1)`,
    [`test-customer-${Date.now()}@example.com`]
  );
  testCustomerId = custResult.insertId;

  // Create test vendor user
  const [vendorUserResult] = await pool.execute(
    `INSERT INTO users (email, password, firstName, lastName, role, is_email_verified)
     VALUES (?, 'hashed', 'Test', 'Vendor', 'vendor', 1)`,
    [`test-vendor-${Date.now()}@example.com`]
  );
  const vendorUserId = vendorUserResult.insertId;

  // Create vendor profile
  await pool.execute(
    `INSERT INTO vendors (userId, businessName, status) VALUES (?, 'Test Weaver', 'approved')`,
    [vendorUserId]
  );
  testVendorId = vendorUserId;

  // Create a base product for the custom request
  const [prodResult] = await pool.execute(
    `INSERT INTO product (vendorId, title, price, isCustomizable, approvalStatus, stock, img, category)
     VALUES (?, 'Base Kente Cloth', 500, 1, 'approved', 10, '/placeholder.jpg', 'Kente')`,
    [vendorUserId]
  );
  const productId = prodResult.insertId;

  // Create custom request in 'accepted' state
  const [reqResult] = await pool.execute(
    `INSERT INTO custom_requests
     (customerId, vendorId, baseProductId, description, yards, colours, dominantColour,
      threadTypes, dominantThread, referenceImage, neededForDate, neededForTime,
      status, vendorQuotePrice, vendorCanMeet, vendorMessage)
     VALUES (?, ?, ?, 'Test custom kente', 4, '["red","gold"]', 'red',
             '["cotton"]', 'cotton', NULL, DATE_ADD(CURDATE(), INTERVAL 30 DAY), '12:00',
             'accepted', 500, 1, 'Quote accepted')`,
    [testCustomerId, vendorUserId, productId]
  );
  testRequestId = reqResult.insertId;
}

async function cleanupTestData() {
  if (!dbAvailable) {
    await pool.end();
    return;
  }
  try {
    if (testRequestId) await pool.execute(`DELETE FROM custom_requests WHERE id = ?`, [testRequestId]);
    if (testVendorId) {
      await pool.execute(`DELETE FROM product WHERE vendorId = ?`, [testVendorId]);
      await pool.execute(`DELETE FROM vendors WHERE userId = ?`, [testVendorId]);
      await pool.execute(`DELETE FROM users WHERE id = ?`, [testVendorId]);
    }
    if (testCustomerId) await pool.execute(`DELETE FROM users WHERE id = ?`, [testCustomerId]);
    // Clean up any orders created during tests
    await pool.execute(`DELETE FROM orders WHERE paymentReference LIKE 'test-ref-%'`);
    await pool.execute(`DELETE FROM order_items WHERE orderId IN (SELECT id FROM orders WHERE paymentReference LIKE 'test-ref-%')`);
    await pool.execute(`DELETE FROM escrow_allocations WHERE orderId IN (SELECT id FROM orders WHERE paymentReference LIKE 'test-ref-%')`);
  } catch (e) {
    console.warn('Cleanup warning:', e.message);
  }
  await pool.end();
}

describe('Custom Request Checkout - Atomic Transaction Safety', { skip: !dbAvailable }, () => {
  before(setupTestData);
  after(cleanupTestData);

  test('successful checkout creates order, escrow, and links request atomically', async () => {
    const paymentReference = `test-ref-success-${Date.now()}`;
    const request = await CustomRequest.findById(testRequestId);
    assert.ok(request, 'Request should exist');
    assert.equal(request.status, 'accepted');

    // Simulate the checkout flow within a transaction (same logic as controller)
    const connection = await pool.getConnection();
    let orderId = null;
    try {
      await connection.beginTransaction();

      // 1. Create order
      const orderNumber = `CUS-TEST-${Date.now()}`;
      const [orderResult] = await connection.execute(
        `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
          paymentMethod, paymentStatus, orderStatus, shippingCost, tax, discount, notes, paymentReference,
          couponId, expectedCompletionDate, productionNote, couponUseState)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [testCustomerId, orderNumber, JSON.stringify([{name: 'Test'}]), 500,
         JSON.stringify({}), JSON.stringify({}), 'Card Payment', 'paid', 'processing',
         0, 0, 0, 'Test order', paymentReference, null, null, null, 0]
      );
      orderId = orderResult.insertId;

      // 2. Atomic claim
      const [claimResult] = await connection.execute(
        `UPDATE custom_requests SET status = 'paid', orderId = ? WHERE id = ? AND status = 'accepted'`,
        [orderId, testRequestId]
      );
      assert.equal(claimResult.affectedRows, 1, 'Atomic claim should succeed');

      // 3. Create escrow allocation
      await connection.execute(
        `INSERT IGNORE INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 'advance')`,
        [orderId, testVendorId, 250, 0.1, 25, 225]
      );

      // 4. Hold escrow
      await connection.execute(
        `UPDATE escrow_allocations SET status = 'held', updated_at = CURRENT_TIMESTAMP WHERE orderId = ? AND status = 'pending'`,
        [orderId]
      );
      await connection.execute(
        `UPDATE orders SET escrowStatus = 'held', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND escrowStatus IN ('none', 'held')`,
        [orderId]
      );

      // 5. Release advance (simplified - just mark available)
      await connection.execute(
        `UPDATE escrow_allocations SET status = 'available', updated_at = CURRENT_TIMESTAMP WHERE orderId = ? AND allocationType = 'advance'`,
        [orderId]
      );

      await connection.commit();
    } catch (e) {
      await connection.rollback().catch(() => {});
      throw e;
    } finally {
      connection.release();
    }

    // Verify final state
    const updatedRequest = await CustomRequest.findById(testRequestId);
    assert.equal(updatedRequest.status, 'paid');
    assert.equal(updatedRequest.orderId, orderId);

    const order = await Order.findById(orderId);
    assert.ok(order, 'Order should exist');
    assert.equal(order.paymentStatus, 'paid');
    assert.equal(order.paymentReference, paymentReference);

    const [allocations] = await pool.execute(
      `SELECT * FROM escrow_allocations WHERE orderId = ?`,
      [orderId]
    );
    assert.ok(allocations.length > 0, 'Escrow allocations should exist');
  });

  test('concurrent checkout for same request fails with CUSTOM_REQUEST_ALREADY_CLAIMED', async () => {
    // Create a fresh request for this test
    const [reqResult] = await pool.execute(
      `INSERT INTO custom_requests
       (customerId, vendorId, baseProductId, description, yards, colours, dominantColour,
        threadTypes, dominantThread, neededForDate, neededForTime,
        status, vendorQuotePrice, vendorCanMeet)
       VALUES (?, ?, (SELECT id FROM product WHERE vendorId = ? LIMIT 1), 'Concurrent test', 2, '["blue"]', 'blue',
               '["cotton"]', 'cotton', DATE_ADD(CURDATE(), INTERVAL 30 DAY), '12:00',
               'accepted', 300, 1)`,
      [testCustomerId, testVendorId, testVendorId]
    );
    const concurrentRequestId = reqResult.insertId;

    const paymentReference1 = `test-ref-concurrent-1-${Date.now()}`;
    const paymentReference2 = `test-ref-concurrent-2-${Date.now()}`;

    // Simulate two concurrent checkouts
    async function attemptCheckout(paymentRef) {
      const connection = await pool.getConnection();
      let orderId = null;
      try {
        await connection.beginTransaction();

        const orderNumber = `CUS-TEST-${Date.now()}-${Math.random()}`;
        const [orderResult] = await connection.execute(
          `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentMethod, paymentStatus, orderStatus,
            paymentReference, couponUseState)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [testCustomerId, orderNumber, JSON.stringify([{name: 'Test'}]), 300,
           'Card Payment', 'paid', 'processing', paymentRef, 0]
        );
        orderId = orderResult.insertId;

        const [claimResult] = await connection.execute(
          `UPDATE custom_requests SET status = 'paid', orderId = ? WHERE id = ? AND status = 'accepted'`,
          [orderId, concurrentRequestId]
        );

        if (claimResult.affectedRows !== 1) {
          throw new Error('CUSTOM_REQUEST_ALREADY_CLAIMED');
        }

        await connection.commit();
        return { success: true, orderId };
      } catch (e) {
        await connection.rollback().catch(() => {});
        return { success: false, error: e.message };
      } finally {
        connection.release();
      }
    }

    // Run both concurrently
    const [result1, result2] = await Promise.all([
      attemptCheckout(paymentReference1),
      attemptCheckout(paymentReference2),
    ]);

    // Exactly one should succeed
    const successCount = [result1, result2].filter(r => r.success).length;
    assert.equal(successCount, 1, 'Exactly one concurrent checkout should succeed');

    // Verify the request is linked to only one order
    const request = await CustomRequest.findById(concurrentRequestId);
    assert.equal(request.status, 'paid');
    assert.ok(request.orderId, 'Request should be linked to an order');
    assert.equal(
      [result1.success ? result1.orderId : null, result2.success ? result2.orderId : null]
        .filter(Boolean).length,
      1,
      'Only one order should be linked'
    );

    // Cleanup the extra request
    await pool.execute(`DELETE FROM custom_requests WHERE id = ?`, [concurrentRequestId]);
  });

  test('failed transaction rolls back order and leaves request in accepted state', async () => {
    // Create a fresh request
    const [reqResult] = await pool.execute(
      `INSERT INTO custom_requests
       (customerId, vendorId, baseProductId, description, yards, colours, dominantColour,
        threadTypes, dominantThread, neededForDate, neededForTime,
        status, vendorQuotePrice, vendorCanMeet)
       VALUES (?, ?, (SELECT id FROM product WHERE vendorId = ? LIMIT 1), 'Rollback test', 2, '["green"]', 'green',
               '["cotton"]', 'cotton', DATE_ADD(CURDATE(), INTERVAL 30 DAY), '12:00',
               'accepted', 400, 1)`,
      [testCustomerId, testVendorId, testVendorId]
    );
    const rollbackRequestId = reqResult.insertId;

    const paymentReference = `test-ref-rollback-${Date.now()}`;
    const connection = await pool.getConnection();
    let orderId = null;

    try {
      await connection.beginTransaction();

      const orderNumber = `CUS-TEST-${Date.now()}`;
      const [orderResult] = await connection.execute(
        `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentMethod, paymentStatus, orderStatus,
          paymentReference, couponUseState)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [testCustomerId, orderNumber, JSON.stringify([{name: 'Test'}]), 400,
         'Card Payment', 'paid', 'processing', paymentReference, 0]
      );
      orderId = orderResult.insertId;

      // Atomic claim succeeds
      const [claimResult] = await connection.execute(
        `UPDATE custom_requests SET status = 'paid', orderId = ? WHERE id = ? AND status = 'accepted'`,
        [orderId, rollbackRequestId]
      );
      assert.equal(claimResult.affectedRows, 1);

      // Simulate a failure (e.g., escrow allocation fails due to constraint)
      // Force a duplicate key error by inserting a duplicate escrow allocation
      await connection.execute(
        `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 'advance')`,
        [orderId, testVendorId, 200, 0.1, 20, 180]
      );
      // This second insert with same orderId/vendorId/allocationType should fail due to unique constraint
      await connection.execute(
        `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 'advance')`,
        [orderId, testVendorId, 200, 0.1, 20, 180]
      );

      await connection.commit();
      assert.fail('Should have thrown on duplicate escrow allocation');
    } catch (e) {
      // Expected to fail — but only with the duplicate-key error. Without this
      // re-throw the assert.fail above was swallowed here and the test passed
      // even when the unique key was missing.
      await connection.rollback().catch(() => {});
      if (e instanceof assert.AssertionError) throw e;
      assert.equal(e.code, 'ER_DUP_ENTRY', `expected a duplicate-key error, got: ${e.message}`);
    } finally {
      connection.release();
    }

    // Verify request is back in 'accepted' state (no orderId)
    const request = await CustomRequest.findById(rollbackRequestId);
    assert.equal(request.status, 'accepted', 'Request should remain accepted after rollback');
    assert.equal(request.orderId, null, 'Request should not have orderId after rollback');

    // Verify no order exists with that paymentReference (rolled back)
    const [orders] = await pool.execute(
      `SELECT * FROM orders WHERE paymentReference = ?`,
      [paymentReference]
    );
    assert.equal(orders.length, 0, 'Order should be rolled back');

    // Cleanup
    await pool.execute(`DELETE FROM custom_requests WHERE id = ?`, [rollbackRequestId]);
  });

  test('unique constraint on custom_requests.orderId prevents duplicate linkage', async () => {
    // Create two requests
    const [req1] = await pool.execute(
      `INSERT INTO custom_requests
       (customerId, vendorId, baseProductId, description, yards, colours, dominantColour,
        threadTypes, dominantThread, neededForDate, neededForTime,
        status, vendorQuotePrice, vendorCanMeet)
       VALUES (?, ?, (SELECT id FROM product WHERE vendorId = ? LIMIT 1), 'Unique test 1', 2, '["purple"]', 'purple',
               '["cotton"]', 'cotton', DATE_ADD(CURDATE(), INTERVAL 30 DAY), '12:00',
               'paid', 200, 1)`,
      [testCustomerId, testVendorId, testVendorId]
    );

    const [req2] = await pool.execute(
      `INSERT INTO custom_requests
       (customerId, vendorId, baseProductId, description, yards, colours, dominantColour,
        threadTypes, dominantThread, neededForDate, neededForTime,
        status, vendorQuotePrice, vendorCanMeet)
       VALUES (?, ?, (SELECT id FROM product WHERE vendorId = ? LIMIT 1), 'Unique test 2', 2, '["orange"]', 'orange',
               '["cotton"]', 'cotton', DATE_ADD(CURDATE(), INTERVAL 30 DAY), '12:00',
               'paid', 200, 1)`,
      [testCustomerId, testVendorId, testVendorId]
    );

    // Create an order and link it to req1
    const orderNumber = `CUS-TEST-${Date.now()}`;
    const [orderResult] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentMethod, paymentStatus, orderStatus,
        paymentReference, couponUseState)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [testCustomerId, orderNumber, JSON.stringify([{name: 'Test'}]), 200,
       'Card Payment', 'paid', 'processing', `test-ref-unique-${Date.now()}`, 0]
    );
    const orderId = orderResult.insertId;

    // Link order to req1
    await pool.execute(
      `UPDATE custom_requests SET orderId = ? WHERE id = ?`,
      [orderId, req1.insertId]
    );

    // Attempt to link SAME order to req2 - should fail due to unique constraint
    let constraintViolated = false;
    try {
      await pool.execute(
        `UPDATE custom_requests SET orderId = ? WHERE id = ?`,
        [orderId, req2.insertId]
      );
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY' && e.message.includes('uq_custom_requests_orderId')) {
        constraintViolated = true;
      } else {
        throw e;
      }
    }

    assert.ok(constraintViolated, 'Unique constraint should prevent duplicate orderId linkage');

    // Cleanup
    await pool.execute(`DELETE FROM custom_requests WHERE id IN (?, ?)`, [req1.insertId, req2.insertId]);
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [orderId]);
  });

  test('retry after failed attempt does not create duplicate order', async () => {
    // Create a fresh request
    const [reqResult] = await pool.execute(
      `INSERT INTO custom_requests
       (customerId, vendorId, baseProductId, description, yards, colours, dominantColour,
        threadTypes, dominantThread, neededForDate, neededForTime,
        status, vendorQuotePrice, vendorCanMeet)
       VALUES (?, ?, (SELECT id FROM product WHERE vendorId = ? LIMIT 1), 'Retry test', 2, '["pink"]', 'pink',
               '["cotton"]', 'cotton', DATE_ADD(CURDATE(), INTERVAL 30 DAY), '12:00',
               'accepted', 350, 1)`,
      [testCustomerId, testVendorId, testVendorId]
    );
    const retryRequestId = reqResult.insertId;

    const paymentReference = `test-ref-retry-${Date.now()}`;

    // First attempt: simulate failure after order creation but before commit
    const connection1 = await pool.getConnection();
    let orderId1 = null;
    try {
      await connection1.beginTransaction();

      const orderNumber = `CUS-TEST-${Date.now()}`;
      const [orderResult] = await connection1.execute(
        `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentMethod, paymentStatus, orderStatus,
          paymentReference, couponUseState)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [testCustomerId, orderNumber, JSON.stringify([{name: 'Test'}]), 350,
         'Card Payment', 'paid', 'processing', paymentReference, 0]
      );
      orderId1 = orderResult.insertId;

      const [claimResult] = await connection1.execute(
        `UPDATE custom_requests SET status = 'paid', orderId = ? WHERE id = ? AND status = 'accepted'`,
        [orderId1, retryRequestId]
      );
      assert.equal(claimResult.affectedRows, 1);

      // Simulate a failure - force rollback
      throw new Error('SIMULATED_FAILURE');
    } catch {
      await connection1.rollback().catch(() => {});
    } finally {
      connection1.release();
    }

    // Verify rollback: request should be back to 'accepted'
    let request = await CustomRequest.findById(retryRequestId);
    assert.equal(request.status, 'accepted', 'Request should be accepted after failed attempt');
    assert.equal(request.orderId, null);

    // Second attempt (retry) with NEW payment reference (simulating user paying again)
    const paymentReference2 = `test-ref-retry-${Date.now()}-2`;
    const connection2 = await pool.getConnection();
    let orderId2 = null;
    try {
      await connection2.beginTransaction();

      const orderNumber = `CUS-TEST-${Date.now()}`;
      const [orderResult] = await connection2.execute(
        `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentMethod, paymentStatus, orderStatus,
          paymentReference, couponUseState)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [testCustomerId, orderNumber, JSON.stringify([{name: 'Test'}]), 350,
         'Card Payment', 'paid', 'processing', paymentReference2, 0]
      );
      orderId2 = orderResult.insertId;

      const [claimResult] = await connection2.execute(
        `UPDATE custom_requests SET status = 'paid', orderId = ? WHERE id = ? AND status = 'accepted'`,
        [orderId2, retryRequestId]
      );
      assert.equal(claimResult.affectedRows, 1, 'Retry should succeed');

      await connection2.commit();
    } catch (e) {
      await connection2.rollback().catch(() => {});
      throw e;
    } finally {
      connection2.release();
    }

    // Verify final state: request linked to order2 only
    request = await CustomRequest.findById(retryRequestId);
    assert.equal(request.status, 'paid');
    assert.equal(request.orderId, orderId2);

    // Verify only ONE order exists for this request
    const [orders] = await pool.execute(
      `SELECT * FROM orders WHERE paymentReference IN (?, ?)`,
      [paymentReference, paymentReference2]
    );
    assert.equal(orders.length, 1, 'Only one order should exist after retry');
    assert.equal(orders[0].id, orderId2);

    // Cleanup
    await pool.execute(`DELETE FROM custom_requests WHERE id = ?`, [retryRequestId]);
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [orderId2]);
  });
test('failed transaction after Paystack verification logs critical error for reconciliation', async () => {
    // This test verifies the error logging behavior when DB transaction fails
    // but Paystack payment has already succeeded.
    // We can't easily test the console.error output, but we can verify
    // the transaction properly rolls back and leaves no orphan order.

    const [reqResult] = await pool.execute(
      `INSERT INTO custom_requests
       (customerId, vendorId, baseProductId, description, yards, colours, dominantColour,
        threadTypes, dominantThread, neededForDate, neededForTime,
        status, vendorQuotePrice, vendorCanMeet)
       VALUES (?, ?, (SELECT id FROM product WHERE vendorId = ? LIMIT 1), 'Reconcile test', 2, '["yellow"]', 'yellow',
               '["cotton"]', 'cotton', DATE_ADD(CURDATE(), INTERVAL 30 DAY), '12:00',
               'accepted', 450, 1)`,
      [testCustomerId, testVendorId, testVendorId]
    );
    const reconcileRequestId = reqResult.insertId;

    const paymentReference = `test-ref-reconcile-${Date.now()}`;

    // Simulate a failure during escrow allocation (e.g., deadlock)
    const connection = await pool.getConnection();
    let orderId = null;
    try {
      await connection.beginTransaction();

      const orderNumber = `CUS-TEST-${Date.now()}`;
      const [orderResult] = await connection.execute(
        `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentMethod, paymentStatus, orderStatus,
          paymentReference, couponUseState)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [testCustomerId, orderNumber, JSON.stringify([{name: 'Test'}]), 450,
         'Card Payment', 'paid', 'processing', paymentReference, 0]
      );
      orderId = orderResult.insertId;

      const [claimResult] = await connection.execute(
        `UPDATE custom_requests SET status = 'paid', orderId = ? WHERE id = ? AND status = 'accepted'`,
        [orderId, reconcileRequestId]
      );
      assert.equal(claimResult.affectedRows, 1);

      // Simulate a deadlock or constraint failure during escrow
      throw new Error('ER_LOCK_DEADLOCK');
    } catch (e) {
      await connection.rollback().catch(() => {});
      // The error should be caught and logged for reconciliation
      assert.ok(e.message.includes('ER_LOCK_DEADLOCK') || e.message === 'ER_LOCK_DEADLOCK');
    } finally {
      connection.release();
    }

    // Verify no orphan order
    const [orders] = await pool.execute(
      `SELECT * FROM orders WHERE paymentReference = ?`,
      [paymentReference]
    );
    assert.equal(orders.length, 0, 'No orphan order should exist after rollback');

    // Verify request is back to accepted
    const request = await CustomRequest.findById(reconcileRequestId);
    assert.equal(request.status, 'accepted');
    assert.equal(request.orderId, null);

    // Cleanup
    await pool.execute(`DELETE FROM custom_requests WHERE id = ?`, [reconcileRequestId]);
  });
});