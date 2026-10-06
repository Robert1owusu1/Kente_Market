// FILE LOCATION: backend/tests/rb04-inventory-double-restore.test.js
// DESCRIPTION: Regression tests for RB-04 inventory double restoration.
//   1. cancel + expiration sweeper concurrent (no double restore)
//   2. repeated cancellation is idempotent
//   3. sweeper retries are idempotent
//   4. atomic conditional updates and affectedRows checks
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
const state = { vendorId: null, userId: null, productId: null };

before(async () => {
  if (!dbAvailable || !pool) return;

  // Create a test vendor user
  const [vendorRes] = await pool.execute(
    `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
     VALUES ('RB04', 'Vendor', ?, ?, 'vendor', 1, 1)`,
    [`rb04-vendor-${baseTs}@test.local`, 'hashedpass']
  );
  state.vendorId = vendorRes.insertId;

  await pool.execute(
    `INSERT INTO vendors (userId, businessName, status, recipientCode)
     VALUES (?, ?, 'approved', 'RCP_test')`,
    [state.vendorId, `RB04 Vendor ${baseTs}`]
  );

  // Create a test customer user
  const [userRes] = await pool.execute(
    `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
     VALUES ('RB04', 'Customer', ?, ?, 'customer', 1, 1)`,
    [`rb04-customer-${baseTs}@test.local`, 'hashedpass']
  );
  state.userId = userRes.insertId;

  // Create a test product with stock = 10
  const [pRes] = await pool.execute(
    `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'approved')`,
    [`RB04 Product ${baseTs}`, 'test.png', 100.0, 'test', 10, state.vendorId]
  );
  state.productId = pRes.insertId;
});

after(async () => {
  if (!dbAvailable || !pool) return;
  try {
    if (state.productId) {
      await pool.execute(`DELETE FROM product WHERE id = ?`, [state.productId]);
    }
    if (state.vendorId) {
      await pool.execute(`DELETE FROM vendors WHERE userId = ?`, [state.vendorId]);
      await pool.execute(`DELETE FROM users WHERE id = ?`, [state.vendorId]);
    }
    if (state.userId) {
      await pool.execute(`DELETE FROM users WHERE id = ?`, [state.userId]);
    }
    // Clean up any test orders
    await pool.execute(`DELETE FROM escrow_allocations WHERE orderId IN (SELECT id FROM orders WHERE notes LIKE 'RB04%')`);
    await pool.execute(`DELETE FROM order_items WHERE orderId IN (SELECT id FROM orders WHERE notes LIKE 'RB04%')`);
    await pool.execute(`DELETE FROM orders WHERE notes LIKE 'RB04%'`);
  } finally {
    await pool.end();
  }
});

// Helper to generate unique test values per test
let testCounter = 0;
const genTs = () => `${Date.now()}-${++testCounter}-${Math.random().toString(36).slice(2, 8)}`;

const getStock = async (productId) => {
  const [[row]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [productId]);
  return Number(row?.stock ?? 0);
};

describe('RB-04: Inventory double restoration', { skip: !dbAvailable }, () => {
  test('1. cancel + expiration sweeper concurrent (no double restore)', async () => {
    const { reserveStockForItems } = await import('../Services/reservationService.js');
    const Order = (await import('../models/orderModel.js')).default;
    const { createEscrowAllocations } = await import('../Services/escrowService.js');
    const { cancelOrder } = await import('../controllers/orderController.js');
    const { releaseExpiredReservations } = await import('../Services/reservationService.js');

    const ts = genTs();
    // Reset stock to 10
    await pool.execute(`UPDATE product SET stock = 10 WHERE id = ?`, [state.productId]);
    const initialStock = await getStock(state.productId);
    assert.equal(initialStock, 10);

    // Reserve 3 units
    const { reserved } = await reserveStockForItems([
      { productId: state.productId, quantity: 3, madeToOrder: false, stock: 10 },
    ]);
    assert.equal(reserved.get(state.productId), 3);

    const afterReserve = await getStock(state.productId);
    assert.equal(afterReserve, 7, 'stock should be 7 after reservation');

    // Create an old pending order (older than 45 min) - this will be picked up by sweeper
    const items = [{
      product: state.productId,
      name: 'RB04 Product',
      qty: 3,
      price: 100,
      vendorId: state.vendorId,
      reserved: 3,
    }];
    const [oRes] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentMethod, shippingAddress, billingAddress, shippingCost, tax, discount, notes, created_at)
       VALUES (?, ?, ?, ?, 'pending', 'pending', 'none', 'pending', '{}', '{}', 0, 0, 0, 'RB04-TEST-1', DATE_SUB(NOW(), INTERVAL 2 HOUR))`,
      [state.userId, `RB04-TEST-${ts}`, JSON.stringify(items), 300.0]
    );
    const orderId = oRes.insertId;

    // Create escrow allocations
    await createEscrowAllocations(orderId, items, { discount: 0 });

    // Now run cancel AND sweeper concurrently
    const mockReq = { params: { id: String(orderId) }, user: { id: 1, role: 'admin' } };
    let cancelResponse = null;
    const mockRes = {
      status() { return this; },
      json(payload) { cancelResponse = payload; return this; },
    };

    // Run both concurrently
    const [_cancelResult] = await Promise.all([
      cancelOrder(mockReq, mockRes),
      releaseExpiredReservations(0)
    ]);

    const afterBoth = await getStock(state.productId);
    // Should be 10 (restored once), not 13 (double restored)
    assert.equal(afterBoth, 10, 'stock should be 10 (restored once, not double restored)');
    
    console.log(`Cancel result:`, cancelResponse?.message);
  });

  test('2. repeated cancellation is idempotent (no double restore)', async () => {
    const { reserveStockForItems } = await import('../Services/reservationService.js');
    const Order = (await import('../models/orderModel.js')).default;
    const { createEscrowAllocations } = await import('../Services/escrowService.js');
    const { cancelOrder } = await import('../controllers/orderController.js');

    const ts = genTs();
    // Reset stock to 10
    await pool.execute(`UPDATE product SET stock = 10 WHERE id = ?`, [state.productId]);
    const initialStock = await getStock(state.productId);
    assert.equal(initialStock, 10);

    // Reserve 2 units
    const { reserved } = await reserveStockForItems([
      { productId: state.productId, quantity: 2, madeToOrder: false, stock: 10 },
    ]);
    assert.equal(reserved.get(state.productId), 2);

    const afterReserve = await getStock(state.productId);
    assert.equal(afterReserve, 8, 'stock should be 8 after reservation');

    // Create a pending order
    const items = [{
      product: state.productId,
      name: 'RB04 Product',
      qty: 2,
      price: 100,
      vendorId: state.vendorId,
      reserved: 2,
    }];
    const [oRes] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentMethod, shippingAddress, billingAddress, shippingCost, tax, discount, notes, created_at)
       VALUES (?, ?, ?, ?, 'pending', 'pending', 'none', 'pending', '{}', '{}', 0, 0, 0, 'RB04-TEST-2', NOW())`,
      [state.userId, `RB04-TEST-${ts}`, JSON.stringify(items), 200.0]
    );
    const orderId = oRes.insertId;

    // Create escrow allocations
    await createEscrowAllocations(orderId, items, { discount: 0 });

    // First cancellation
    const mockReq = { params: { id: String(orderId) }, user: { id: 1, role: 'admin' } };
    let _cancelResponse1 = null;
    const mockRes1 = {
      status() { return this; },
      json(payload) { _cancelResponse1 = payload; return this; },
    };
    await cancelOrder(mockReq, mockRes1);

    const afterFirstCancel = await getStock(state.productId);
    assert.equal(afterFirstCancel, 10, 'stock should be 10 after first cancel');

    // Second cancellation (idempotent - should not restore again)
    let _cancelResponse2 = null;
    const mockRes2 = {
      status() { return this; },
      json(payload) { _cancelResponse2 = payload; return this; },
    };
    await cancelOrder(mockReq, mockRes2);

    const afterSecondCancel = await getStock(state.productId);
    // Should still be 10 (not 12 from double restore)
    assert.equal(afterSecondCancel, 10, 'stock should remain 10 after second cancel (idempotent)');
  });

  test('3. sweeper retries are idempotent (no double restore on retry)', async () => {
    const { releaseExpiredReservations } = await import('../Services/reservationService.js');

    const ts = genTs();
    // Reset stock to 10
    await pool.execute(`UPDATE product SET stock = 10 WHERE id = ?`, [state.productId]);
    const initialStock = await getStock(state.productId);
    assert.equal(initialStock, 10);

    // Create TWO old pending orders with reservations
    const items1 = [{ product: state.productId, name: 'RB04 Product', qty: 2, price: 100, vendorId: state.vendorId, reserved: 2 }];
    const items2 = [{ product: state.productId, name: 'RB04 Product', qty: 3, price: 100, vendorId: state.vendorId, reserved: 3 }];

    const [oRes1] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentMethod, shippingAddress, billingAddress, shippingCost, tax, discount, notes, created_at)
       VALUES (?, ?, ?, ?, 'pending', 'pending', 'none', 'pending', '{}', '{}', 0, 0, 0, 'RB04-TEST-3A', DATE_SUB(NOW(), INTERVAL 2 HOUR))`,
      [state.userId, `RB04-TEST-${ts}-A`, JSON.stringify(items1), 200.0]
    );
    const orderId1 = oRes1.insertId;

    const [oRes2] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentMethod, shippingAddress, billingAddress, shippingCost, tax, discount, notes, created_at)
       VALUES (?, ?, ?, ?, 'pending', 'pending', 'none', 'pending', '{}', '{}', 0, 0, 0, 'RB04-TEST-3B', DATE_SUB(NOW(), INTERVAL 2 HOUR))`,
      [state.userId, `RB04-TEST-${ts}-B`, JSON.stringify(items2), 300.0]
    );
    const orderId2 = oRes2.insertId;

    // Manually set stock to simulate reservations already taken
    await pool.execute(`UPDATE product SET stock = 5 WHERE id = ?`, [state.productId]); // 10 - 2 - 3 = 5

    // First sweeper run
    const released1 = await releaseExpiredReservations(0);
    assert.ok(released1 >= 2, 'should release both orders');

    const afterFirstSweep = await getStock(state.productId);
    assert.equal(afterFirstSweep, 10, 'stock should be 10 after first sweeper run');

    // Second sweeper run (should be idempotent - orders already cancelled)
    const released2 = await releaseExpiredReservations(0);
    assert.equal(released2, 0, 'second sweeper run should release 0 orders');

    const afterSecondSweep = await getStock(state.productId);
    // Should still be 10 (not 15 from double restore)
    assert.equal(afterSecondSweep, 10, 'stock should remain 10 after second sweeper run');

    // Cleanup
    await pool.execute(`DELETE FROM orders WHERE id IN (?, ?)`, [orderId1, orderId2]);
  });

  test('4. atomic conditional updates prevent race conditions', async () => {
    const { reserveStockForItems } = await import('../Services/reservationService.js');
    const Order = (await import('../models/orderModel.js')).default;
    const { createEscrowAllocations } = await import('../Services/escrowService.js');
    const { cancelOrder } = await import('../controllers/orderController.js');
    const { releaseExpiredReservations } = await import('../Services/reservationService.js');

    const ts = genTs();
    // Reset stock to 10
    await pool.execute(`UPDATE product SET stock = 10 WHERE id = ?`, [state.productId]);
    const initialStock = await getStock(state.productId);
    assert.equal(initialStock, 10);

    // Reserve 4 units
    const { reserved } = await reserveStockForItems([
      { productId: state.productId, quantity: 4, madeToOrder: false, stock: 10 },
    ]);
    assert.equal(reserved.get(state.productId), 4);

    const afterReserve = await getStock(state.productId);
    assert.equal(afterReserve, 6, 'stock should be 6 after reservation');

    // Create an old pending order
    const items = [{
      product: state.productId,
      name: 'RB04 Product',
      qty: 4,
      price: 100,
      vendorId: state.vendorId,
      reserved: 4,
    }];
    const [oRes] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentMethod, shippingAddress, billingAddress, shippingCost, tax, discount, notes, created_at)
       VALUES (?, ?, ?, ?, 'pending', 'pending', 'none', 'pending', '{}', '{}', 0, 0, 0, 'RB04-TEST-4', DATE_SUB(NOW(), INTERVAL 2 HOUR))`,
      [state.userId, `RB04-TEST-${ts}`, JSON.stringify(items), 400.0]
    );
    const orderId = oRes.insertId;

    // Create escrow allocations
    await createEscrowAllocations(orderId, items, { discount: 0 });

    // Simulate race: cancel and sweeper at the same time
    const mockReq = { params: { id: String(orderId) }, user: { id: 1, role: 'admin' } };
    let _cancelResponse = null;
    const mockRes = {
      status() { return this; },
      json(payload) { _cancelResponse = payload; return this; },
    };

    // Run 10 times concurrently to test race condition
    const promises = [];
    for (let i = 0; i < 10; i++) {
      // Alternate between cancel and sweeper
      if (i % 2 === 0) {
        promises.push(cancelOrder(mockReq, mockRes));
      } else {
        promises.push(releaseExpiredReservations(0));
      }
    }

    await Promise.all(promises);

    const afterRace = await getStock(state.productId);
    // Should be 10 (restored once), not more
    assert.equal(afterRace, 10, 'stock should be 10 after concurrent cancel/sweeper (no double restore)');
  });
});