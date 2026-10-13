// @ts-check
// FILE LOCATION: backend/tests/paymentLifecycleRecovery.test.js
// DESCRIPTION: Regression tests for F-1, F-4, F-5 payment lifecycle fixes
// - F-1: Payment processing completion tracking
// - F-4: Fallback verification platform revenue tracking
// - F-5: Gross/net platform revenue accounting
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/db.js';
import { trackPlatformRevenue, holdEscrowForOrder, consumeCouponForOrder, checkPaymentSideEffects, markPaymentSideEffect } from '../Services/escrowService.js';
import Order from '../models/orderModel.js';
import Coupon from '../models/couponModel.js';

let dbAvailable = true;
let dbPool = pool;
try {
  await dbPool.query('SELECT 1');
} catch {
  dbAvailable = false;
  dbPool = null;
}

const ts = Date.now();
/**
 * Fixture ids populated in `before()` (users, products, coupon). Typed as a
 * loose record so `// @ts-check` does not flag every key before assignment;
 * runtime behaviour is unchanged.
 * @type {Record<string, any>}
 */
const state = {};

before(async () => {
  if (!dbAvailable || !dbPool) return;
  // Create test users
  const User = (await import('../models/usersModel.js')).default;
  const buyer = await User.create({
    firstName: 'Test', lastName: 'Buyer', email: `buyer-${ts}@example.com`,
    password: 'Test1234x', role: 'customer', legalConsentAccepted: true,
  });
  const vendor = await User.create({
    firstName: 'Test', lastName: 'Vendor', email: `vendor-${ts}@example.com`,
    password: 'Test1234x', role: 'vendor', legalConsentAccepted: true,
  });
  const admin = await User.create({
    firstName: 'Test', lastName: 'Admin', email: `admin-${ts}@example.com`,
    password: 'Test1234x', role: 'admin', legalConsentAccepted: true,
  });
  // Fixture precondition: every test user must exist before we reference ids.
  if (!buyer || !vendor || !admin) {
    throw new Error('test fixture setup failed: could not create test users');
  }
  state.buyerId = buyer.id;
  state.vendorId = vendor.id;
  state.adminId = admin.id;

  // Create vendor profile
  await dbPool.execute(
    `INSERT INTO vendors (userId, businessName, contactPhone, recipientCode, recipientType, platformFeeRate, status)
     VALUES (?, 'Test Vendor', '+233500000000', 'rec_test', 'nuban', 0.1, 'approved')`,
    [vendor.id]
  );

  // Create platform-owned product (no vendorId)
  const [p1] = await dbPool.execute(
    `INSERT INTO product (title, img, price, category, stock, vendorId, approvalStatus, madeToOrder)
     VALUES (?, ?, ?, ?, ?, NULL, 'approved', 0)`,
    [`Platform Product ${ts}`, '/uploads/test.png', 100.0, 'test', 10]
  );
  state.platformProductId = p1.insertId;

  // Create vendor-owned product
  const [p2] = await dbPool.execute(
    `INSERT INTO product (title, img, price, category, stock, vendorId, approvalStatus, madeToOrder)
     VALUES (?, ?, ?, ?, ?, ?, 'approved', 0)`,
    [`Vendor Product ${ts}`, '/uploads/test.png', 200.0, 'test', 5, vendor.id]
  );
  state.vendorProductId = p2.insertId;

  // Create a coupon
  const [c] = await dbPool.execute(
    `INSERT INTO coupons (code, discountType, discountValue, minPurchase, maxUses, isActive, vendorId)
     VALUES (?, 'percentage', 10, 0, 100, 1, NULL)`,
    [`TESTCPN${ts}`]
  );
  state.couponId = c.insertId;
});

after(async () => {
  if (!dbAvailable || !dbPool) return;
  try {
    await dbPool.execute(`DELETE FROM platform_revenue WHERE orderId IN (SELECT id FROM orders WHERE userId = ?)`, [state.buyerId]);
    await dbPool.execute(`DELETE FROM financial_events WHERE orderId IN (SELECT id FROM orders WHERE userId = ?)`, [state.buyerId]);
    await dbPool.execute(`DELETE FROM escrow_allocations WHERE orderId IN (SELECT id FROM orders WHERE userId = ?)`, [state.buyerId]);
    await dbPool.execute(`DELETE FROM orders WHERE userId = ?`, [state.buyerId]);
    await dbPool.execute(`DELETE FROM coupons WHERE id = ?`, [state.couponId]);
    await dbPool.execute(`DELETE FROM product WHERE id IN (?, ?)`, [state.platformProductId, state.vendorProductId]);
    await dbPool.execute(`DELETE FROM vendors WHERE userId = ?`, [state.vendorId]);
    await dbPool.execute(`DELETE FROM users WHERE id IN (?, ?, ?)`, [state.buyerId, state.vendorId, state.adminId]);
  } finally {
    await dbPool.end();
  }
});

// Helper to create a test order
/**
 * @param {object} opts
 * @param {number} opts.userId
 * @param {Array<{product?: number, qty: number, price: number, vendorId?: number | string | null}>} opts.items
 * @param {number} [opts.discount]
 * @param {string} [opts.paymentRef]
 * @param {number | null} [opts.couponId]
 */
async function createTestOrder({ userId, items, discount = 0, paymentRef, couponId = null }) {
  const orderNumber = `TEST-ORD-${ts}-${Math.random().toString(36).slice(2, 8)}`;
  const subtotal = items.reduce((sum, it) => sum + it.price * it.qty, 0);
  const tax = round2(subtotal * 0.125);
  const shipping = 0;
  const totalAmount = round2(Math.max(subtotal + tax + shipping - discount, 0));
  const orderData = {
    userId,
    orderNumber,
    items,
    totalAmount,
    shippingAddress: { city: 'Accra', region: 'Greater Accra', country: 'Ghana', addressLine1: 'Test St', phone: '+233500000000' },
    billingAddress: { city: 'Accra', region: 'Greater Accra', country: 'Ghana', addressLine1: 'Test St', phone: '+233500000000' },
    paymentMethod: 'paystack',
    paymentStatus: 'pending',
    orderStatus: 'pending',
    shippingCost: shipping,
    tax,
    discount,
    paymentReference: paymentRef,
    couponId,
    couponUseState: couponId ? 1 : 0,
  };
  const order = await Order.create(orderData);
  return order;
}

/** @param {number} n */
function round2(n) { return Math.round(n * 100) / 100; }

describe('F-1: Payment processing completion tracking', () => {
  test('paymentSideEffects column exists on orders table', { skip: !dbAvailable }, async () => {
    const [[row]] = await dbPool.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'paymentSideEffects'`
    );
    assert.ok(row, 'paymentSideEffects column should exist');
  });

  test('markPaymentSideEffect marks effect as completed', { skip: !dbAvailable }, async () => {
    const items = [{ product: state.platformProductId, qty: 1, price: 100, vendorId: null }];
    const order = await createTestOrder({ userId: state.buyerId, items, paymentRef: `ref-${ts}-1` });
    
    // Mark escrow held
    const changed = await markPaymentSideEffect(order.id, 'escrowHeld');
    assert.equal(changed, true);
    
    // Second call should not change (idempotent)
    const changedAgain = await markPaymentSideEffect(order.id, 'escrowHeld');
    assert.equal(changedAgain, false);
    
    // Verify in DB
    const [[row]] = await dbPool.execute(`SELECT paymentSideEffects FROM orders WHERE id = ?`, [order.id]);
    const effects = row.paymentSideEffects;
    assert.equal(effects.escrowHeld, true);
  });

  test('checkPaymentSideEffects reports missing effects', { skip: !dbAvailable }, async () => {
    const items = [{ product: state.platformProductId, qty: 1, price: 100, vendorId: null }];
    const order = await createTestOrder({ userId: state.buyerId, items, paymentRef: `ref-${ts}-2` });
    
    const result = await checkPaymentSideEffects(order.id);
    assert.equal(result.complete, false);
    assert.ok(result.missing.length > 0);
    assert.ok(result.missing.includes('escrowHeld'));
    assert.ok(result.missing.includes('stockDecremented'));
  });

  test('manual recovery steps complete missing side effects for a specific order', { skip: !dbAvailable }, async () => {
    const items = [{ product: state.platformProductId, qty: 2, price: 100, vendorId: null }];
    const order = await createTestOrder({ userId: state.buyerId, items, paymentRef: `ref-${ts}-3`, discount: 10, couponId: state.couponId });
    
    // Manually mark as paid but without side effects
    await dbPool.execute(`UPDATE orders SET paymentStatus = 'paid', orderStatus = 'processing' WHERE id = ?`, [order.id]);
    await holdEscrowForOrder(order.id); // This creates allocations
    
    // Verify incomplete
    let check = await checkPaymentSideEffects(order.id);
    assert.equal(check.complete, false);
    assert.ok(check.missing.includes('stockDecremented'));
    assert.ok(check.missing.includes('platformRevenueTracked'));
    
    // Manually run the recovery steps for JUST this order (avoid global scan)
    // This tests the idempotent recovery logic without scanning all orders
    await markPaymentSideEffect(order.id, 'escrowHeld');
    
    const { decrementStockForOrder } = await import('../controllers/orderController.js');
    await decrementStockForOrder(items, order.id);
    await markPaymentSideEffect(order.id, 'stockDecremented');
    
    if (order.couponId) {
      await consumeCouponForOrder(order.couponId, order.id);
      await markPaymentSideEffect(order.id, 'couponConsumed');
    }
    
    const { recordFinancialEvent } = await import('../Services/ledgerService.js');
    const { buildChargeSnapshot } = await import('../Services/paymentCurrency.js');
    await recordFinancialEvent({
      eventType: 'charge.collected',
      direction: 'in',
      amount: parseFloat(order.totalAmount) || 0,
      currency: 'GHS',
      orderId: order.id,
      reference: order.paymentReference,
      providerReference: order.paymentReference,
      dedupeKey: `charge.collected:${order.paymentReference}`,
      payload: buildChargeSnapshot({ amount: Math.round(parseFloat(order.totalAmount) * 100), currency: 'GHS' }, 'recovery'),
    });
    await markPaymentSideEffect(order.id, 'financialEventRecorded');
    
    await trackPlatformRevenue(order.id, items, parseFloat(order.discount ?? 0) || 0);
    await markPaymentSideEffect(order.id, 'platformRevenueTracked');
    
    // Verify complete
    check = await checkPaymentSideEffects(order.id);
    console.log('DEBUG: check result for order', order.id, ':', JSON.stringify(check));
    if (!check.complete) {
      console.log('Missing effects for test order:', check.missing);
    }
    assert.equal(check.complete, true);
  });

  test('no-coupon order completes without couponConsumed', { skip: !dbAvailable }, async () => {
    const items = [{ product: state.platformProductId, qty: 1, price: 100, vendorId: null }];
    const order = await createTestOrder({ userId: state.buyerId, items, paymentRef: `ref-${ts}-nocpn` });
    assert.equal(order.couponId, null, 'fixture order must carry no coupon');

    // Nothing recorded yet: still incomplete — but couponConsumed is NOT one
    // of the gaps, because this order has no coupon to consume.
    let check = await checkPaymentSideEffects(order.id);
    assert.equal(check.complete, false, 'an untouched order must never look complete');
    assert.ok(check.missing.includes('escrowHeld'));
    assert.ok(check.missing.includes('stockDecremented'));
    assert.ok(
      !check.missing.includes('couponConsumed'),
      'couponConsumed must not be a required effect for a coupon-free order'
    );

    // Record the four effects that actually apply to a coupon-free order.
    for (const effect of ['escrowHeld', 'stockDecremented', 'financialEventRecorded', 'platformRevenueTracked']) {
      await markPaymentSideEffect(order.id, effect);
    }

    check = await checkPaymentSideEffects(order.id);
    assert.deepEqual(
      check.missing, [],
      `coupon-free order must be complete after its four effects, missing=${JSON.stringify(check.missing)}`
    );
    assert.equal(check.complete, true);
  });

  test('coupon order still requires couponConsumed', { skip: !dbAvailable }, async () => {
    const items = [{ product: state.platformProductId, qty: 1, price: 100, vendorId: null }];
    const order = await createTestOrder({
      userId: state.buyerId, items, paymentRef: `ref-${ts}-withcpn`, discount: 10, couponId: state.couponId,
    });
    assert.equal(Number(order.couponId), Number(state.couponId), 'fixture order must carry the coupon');

    for (const effect of ['escrowHeld', 'stockDecremented', 'financialEventRecorded', 'platformRevenueTracked']) {
      await markPaymentSideEffect(order.id, effect);
    }

    // All non-coupon effects done, coupon NOT consumed => still incomplete.
    let check = await checkPaymentSideEffects(order.id);
    assert.equal(check.complete, false, 'a coupon order must stay incomplete until the coupon is consumed');
    assert.deepEqual(check.missing, ['couponConsumed']);

    // Consume the coupon for real (same call production/recovery use), then
    // record the marker exactly as production does.
    const consumed = await consumeCouponForOrder(state.couponId, order.id);
    assert.equal(consumed.consumed, true, 'coupon consumption must succeed');
    await markPaymentSideEffect(order.id, 'couponConsumed');

    check = await checkPaymentSideEffects(order.id);
    assert.equal(check.complete, true, `expected complete, missing=${JSON.stringify(check.missing)}`);
    assert.deepEqual(check.missing, []);
  });

  test('no-coupon sentinels (couponId = 0) and unknown orders are handled safely', { skip: !dbAvailable }, async () => {
    const items = [{ product: state.platformProductId, qty: 1, price: 100, vendorId: null }];
    const order = await createTestOrder({ userId: state.buyerId, items, paymentRef: `ref-${ts}-sentinel` });
    // Malformed/explicit "no coupon" value: 0 must not require couponConsumed.
    await dbPool.execute(`UPDATE orders SET couponId = 0 WHERE id = ?`, [order.id]);

    for (const effect of ['escrowHeld', 'stockDecremented', 'financialEventRecorded', 'platformRevenueTracked']) {
      await markPaymentSideEffect(order.id, effect);
    }
    const check = await checkPaymentSideEffects(order.id);
    assert.equal(check.complete, true, `couponId=0 must be treated as coupon-free, missing=${JSON.stringify(check.missing)}`);
    assert.ok(!check.missing.includes('couponConsumed'));

    // Unknown order: fail closed rather than reporting a clean bill of health.
    const unknown = await checkPaymentSideEffects(999999999);
    assert.equal(unknown.complete, false, 'an unknown order must never be reported complete');
    assert.ok(unknown.missing.length > 0);
  });
});

describe('F-4: Fallback verification tracks platform revenue', () => {
  // All four paid-flip paths now share applyPaidOrderSideEffects (C-3), so the
  // guarantee is: each path calls the shared routine, and the routine tracks
  // platform revenue. Behaviour is covered end to end in paidSideEffects.test.js.
  /** @param {string} rel */
  const read = async (rel) => (await import('node:fs/promises')).readFile(new URL(`../${rel}`, import.meta.url), 'utf8');

  test('verify-paystack and webhook paths run the shared side effects with the provider charge', async () => {
    const src = await read('routes/paymentRoutes.js');
    assert.match(src, /flipped\) \{[\s\S]*?applyPaidOrderSideEffects\(orderId, \{ source: 'verify', charge: data \}\)/,
      'verify-paystack must run the shared side effects after its own flip');
    // FV-13: the call moved out of the retry loop (after the attempt's
    // connection is released) and is keyed on the id THIS delivery flipped.
    assert.match(src, /webhookFlippedOrderId = orderId;[\s\S]*?if \(webhookFlippedOrderId\) \{[\s\S]*?applyPaidOrderSideEffects\(webhookFlippedOrderId, \{ source: 'webhook', charge: event\.data \}\)/,
      'webhook must run the shared side effects after its own flip');
    assert.equal(/trackPlatformRevenue\(|decrementStockForOrder\(|consumeCouponForOrder\(/.test(src), false,
      'no path may run an individual side effect outside the shared, marker-tracked routine');
  });

  test('admin mark-paid path runs the shared side effects', async () => {
    const src = await read('controllers/orderController.js');
    assert.match(src, /applyPaidOrderSideEffects\(req\.params\.id, \{ source: 'admin-mark-paid' \}\)/);
    assert.equal(/trackPlatformRevenue\(|consumeCouponForOrder\(/.test(src), false);
  });

  test('the shared routine and the recovery job track platform revenue', async () => {
    const src = await read('Services/escrowService.js');
    assert.match(src, /export const applyPaidOrderSideEffects[\s\S]*?step\('platformRevenueTracked'[\s\S]*?trackPlatformRevenue\(/);
    assert.match(src, /export const recoverIncompletePaidOrders[\s\S]*?applyPaidOrderSideEffects\(id, \{ source: 'recovery' \}\)/);
    assert.match(src, /export const recoverStuckPendingOrders[\s\S]*?applyPaidOrderSideEffects\(order\.id, \{ source: 'stuck-recovery', charge: tx \}\)/);
  });
});

describe('F-5: Gross/net platform revenue accounting', () => {
  test('trackPlatformRevenue records gross, discount, and net amounts', { skip: !dbAvailable }, async () => {
    const items = [
      { product: state.platformProductId, qty: 2, price: 100, vendorId: null },
    ];
    const orderId = 999999; // Use a non-existent orderId for isolated test
    
    // Call trackPlatformRevenue with discount
    await trackPlatformRevenue(orderId, items, 20); // 20 GHS discount on 200 GHS gross
    
    const [[row]] = await dbPool.execute(
      `SELECT amount, grossAmount, discountAmount FROM platform_revenue WHERE orderId = ?`,
      [orderId]
    );
    
    assert.ok(row, 'platform_revenue row should exist');
    assert.equal(parseFloat(row.grossAmount), 200, 'grossAmount should be 200 (2 * 100)');
    assert.equal(parseFloat(row.discountAmount), 20, 'discountAmount should be 20 (pro-rata)');
    assert.equal(parseFloat(row.amount), 180, 'amount (net) should be 180');
    
    // Cleanup
    await dbPool.execute(`DELETE FROM platform_revenue WHERE orderId = ?`, [orderId]);
  });

  test('trackPlatformRevenue with zero discount records gross = net', { skip: !dbAvailable }, async () => {
    const items = [
      { product: state.platformProductId, qty: 1, price: 150, vendorId: null },
    ];
    const orderId = 999998;
    
    await trackPlatformRevenue(orderId, items, 0);
    
    const [[row]] = await dbPool.execute(
      `SELECT amount, grossAmount, discountAmount FROM platform_revenue WHERE orderId = ?`,
      [orderId]
    );
    
    assert.equal(parseFloat(row.grossAmount), 150);
    assert.equal(parseFloat(row.discountAmount), 0);
    assert.equal(parseFloat(row.amount), 150);
    
    await dbPool.execute(`DELETE FROM platform_revenue WHERE orderId = ?`, [orderId]);
  });

  test('trackPlatformRevenue only tracks platform-owned items', { skip: !dbAvailable }, async () => {
    const items = [
      { product: state.platformProductId, qty: 1, price: 100, vendorId: null },
      { product: state.vendorProductId, qty: 1, price: 200, vendorId: state.vendorId },
    ];
    const orderId = 999997;
    
    await trackPlatformRevenue(orderId, items, 0);
    
    const [[row]] = await dbPool.execute(
      `SELECT amount, grossAmount FROM platform_revenue WHERE orderId = ?`,
      [orderId]
    );
    
    assert.equal(parseFloat(row.grossAmount), 100, 'Only platform product (100) should be tracked');
    assert.equal(parseFloat(row.amount), 100);
    
    await dbPool.execute(`DELETE FROM platform_revenue WHERE orderId = ?`, [orderId]);
  });

  test('platform_revenue schema has grossAmount and discountAmount columns', { skip: !dbAvailable }, async () => {
    const [cols] = await dbPool.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_revenue' AND COLUMN_NAME IN ('grossAmount', 'discountAmount')`
    );
    const names = /** @type {Array<{ COLUMN_NAME: string }>} */ (cols).map(c => c.COLUMN_NAME);
    assert.ok(names.includes('grossAmount'));
    assert.ok(names.includes('discountAmount'));
  });
});

describe('Payment lifecycle integration', () => {
  /** @param {string} rel */
  const read = async (rel) => (await import('node:fs/promises')).readFile(new URL(`../${rel}`, import.meta.url), 'utf8');

  test('charge.collected is journaled from exactly one place, used by every paid path', async () => {
    const routes = await read('routes/paymentRoutes.js');
    const orders = await read('controllers/orderController.js');
    const escrow = await read('Services/escrowService.js');
    assert.equal((escrow.match(/eventType: 'charge\.collected'/g) || []).length, 1,
      'one charge.collected write site (inside applyPaidOrderSideEffects)');
    assert.equal(/eventType: 'charge\.collected'/.test(routes), false, 'routes do not journal charges directly');
    assert.equal(/eventType: 'charge\.collected'/.test(orders), false, 'admin mark-paid does not journal charges directly');
    assert.equal((routes.match(/applyPaidOrderSideEffects\(/g) || []).length, 2, 'webhook + verify both call the shared routine');
  });
});

describe('Concurrency and idempotency', () => {
  test('concurrent webhook and verify-paystack do not double-track revenue', { skip: !dbAvailable }, async () => {
    // The dedupeKey `charge.collected:${reference}` in financial_events
    // and the affectedRows guard in trackPlatformRevenue (via ON DUPLICATE KEY)
    // prevent double-tracking
    const fs = await import('node:fs/promises');
    const src1 = await fs.readFile(new URL('../routes/paymentRoutes.js', import.meta.url), 'utf8');
    const src2 = await fs.readFile(new URL('../Services/escrowService.js', import.meta.url), 'utf8');
    
    // Both paths use ON DUPLICATE KEY UPDATE for platform_revenue
    assert.ok(src2.includes('ON DUPLICATE KEY UPDATE amount = VALUES(amount)'));
    
    // Both paths reach the single journal write, keyed per Paystack reference
    // (same `charge.collected:<reference>` value as the historical rows).
    assert.ok(src2.includes('`charge.collected:${order.paymentReference}`'));
    assert.equal((src1.match(/applyPaidOrderSideEffects\(/g) || []).length, 2);
  });

});