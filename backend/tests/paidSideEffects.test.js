// FILE LOCATION: backend/tests/paidSideEffects.test.js
// DESCRIPTION: Behaviour of the shared post-payment side effects (C-3 / B-3 / B-4).
//
//   Before: four paid-flip paths each ran their own copy of the side effects,
//   none recorded completion, and recoverIncompletePaidOrders (unwired) read
//   markers it never SELECTed — so it would have re-run stock, coupon and
//   revenue for EVERY historical paid order. Now:
//   - every flip opts the order into tracking (paymentSideEffects = {}),
//   - applyPaidOrderSideEffects applies each missing effect once and marks it,
//   - recovery is bounded, skips untracked/terminal/fresh orders, and caps attempts,
//   - stock is taken once per product even across a crash mid-decrement,
//   - the order discount is apportioned over the whole order (B-3).
//
// Runs against the disposable DB only (tests/helpers/testDbGuard.mjs); the
// webhook test signs with a placeholder secret and never reaches Paystack.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.EMAIL_DISABLED = '1';
process.env.REDIS_URL = '';
process.env.PAYSTACK_SECRET_KEY ||= 'sk_test_paid_side_effects_placeholder';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

const TS = Date.now();
const fx = { buyer: null, vendor: null, admin: null, platformProduct: null, vendorProduct: null, coupon: null, orders: [] };
let svc;
let Order;
let seq = 0;

const stockOf = async (productId) => Number((await pool.execute(`SELECT stock FROM product WHERE id = ?`, [productId]))[0][0].stock);
const effectsOf = async (orderId) => {
  const [[row]] = await pool.execute(`SELECT paymentSideEffects FROM orders WHERE id = ?`, [orderId]);
  const raw = row.paymentSideEffects;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
};
const countRows = async (sql, params) => Number((await pool.execute(sql, params))[0][0].n);

/**
 * A pending order with escrow allocations, then flipped to paid the way the
 * real paths do it. `tracked` = flipped by current code; `ageMinutes` moves
 * updated_at back so recovery's grace period has passed.
 */
const mkPaidOrder = async ({ items, discount = 0, couponId = null, tracked = true, ageMinutes = 30, orderStatus = 'processing' }) => {
  seq += 1;
  const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
  const order = await Order.create({
    userId: fx.buyer,
    orderNumber: `PSE-${TS}-${seq}`,
    items,
    totalAmount: Math.max(subtotal - discount, 0),
    shippingAddress: { city: 'Accra', country: 'GH' },
    billingAddress: { city: 'Accra', country: 'GH' },
    paymentMethod: 'paystack',
    paymentStatus: 'pending',
    orderStatus: 'pending',
    shippingCost: 0,
    tax: 0,
    discount,
    paymentReference: `PSE-REF-${TS}-${seq}`,
    couponId,
    couponUseState: couponId ? 1 : 0,
  });
  fx.orders.push(order.id);
  await svc.createEscrowAllocations(order.id, items, { discount });
  await pool.execute(
    `UPDATE orders SET paymentStatus = 'paid', orderStatus = ?,
       paymentSideEffects = ${tracked ? 'JSON_OBJECT()' : 'NULL'},
       updated_at = DATE_SUB(NOW(), INTERVAL ? MINUTE)
     WHERE id = ?`,
    [orderStatus, ageMinutes, order.id]
  );
  return order;
};

const lines = (platformQty = 1, vendorQty = 2) => [
  { product: fx.platformProduct, qty: platformQty, price: 100, vendorId: null, name: 'platform' },
  { product: fx.vendorProduct, qty: vendorQty, price: 100, vendorId: fx.vendor, name: 'vendor' },
];

describe('shared paid-order side effects and bounded recovery', { skip: !dbAvailable }, () => {
  before(async () => {
    const mkUser = async (role, tag) => (await pool.execute(
      `INSERT INTO users (email, password, firstName, lastName, role, is_email_verified)
       VALUES (?, 'x', 'PSE', ?, ?, 1)`, [`pse-${tag}-${TS}@example.com`, tag, role]
    ))[0].insertId;
    fx.buyer = await mkUser('customer', 'buyer');
    fx.vendor = await mkUser('vendor', 'vendor');
    fx.admin = await mkUser('admin', 'admin');
    await pool.execute(
      `INSERT INTO vendors (userId, businessName, status, recipientCode) VALUES (?, ?, 'approved', ?)`,
      [fx.vendor, `PSE vendor ${TS}`, `RCP_PSE_${TS}`]
    );
    const mkProduct = async (vendorId) => (await pool.execute(
      `INSERT INTO product (title, img, price, category, stock, vendorId, approvalStatus, madeToOrder)
       VALUES (?, '/x.png', 100, 'test', 100, ?, 'approved', 0)`, [`PSE product ${TS}-${vendorId ?? 'p'}`, vendorId]
    ))[0].insertId;
    fx.platformProduct = await mkProduct(null);
    fx.vendorProduct = await mkProduct(fx.vendor);
    fx.coupon = (await pool.execute(
      `INSERT INTO coupons (code, discountType, discountValue, minPurchase, maxUses, isActive, vendorId)
       VALUES (?, 'fixed', 30, 0, 100, 1, NULL)`, [`PSE${TS}`]
    ))[0].insertId;

    svc = await import('../Services/escrowService.js');
    Order = (await import('../models/orderModel.js')).default;
  });

  after(async () => {
    if (!dbAvailable) return;
    try {
      for (const id of fx.orders) {
        await pool.execute(`DELETE FROM financial_events WHERE orderId = ?`, [id]);
        await pool.execute(`DELETE FROM platform_revenue WHERE orderId = ?`, [id]);
        await pool.execute(`DELETE FROM stock_moves WHERE orderId = ?`, [id]);
        await pool.execute(`DELETE FROM escrow_allocations WHERE orderId = ?`, [id]);
        await pool.execute(`DELETE FROM order_items WHERE orderId = ?`, [id]);
        await pool.execute(`DELETE FROM webhook_events WHERE reference IN (SELECT paymentReference FROM orders WHERE id = ?)`, [id]);
        await pool.execute(`DELETE FROM orders WHERE id = ?`, [id]);
      }
      await pool.execute(`DELETE FROM notifications WHERE userId = ?`, [fx.admin]);
      await pool.execute(`DELETE FROM stock_moves WHERE productId IN (?, ?)`, [fx.platformProduct, fx.vendorProduct]);
      await pool.execute(`DELETE FROM coupons WHERE id = ?`, [fx.coupon]);
      await pool.execute(`DELETE FROM product WHERE id IN (?, ?)`, [fx.platformProduct, fx.vendorProduct]);
      await pool.execute(`DELETE FROM vendors WHERE userId = ?`, [fx.vendor]);
      await pool.execute(`DELETE FROM users WHERE id IN (?, ?, ?)`, [fx.buyer, fx.vendor, fx.admin]);
    } catch (err) {
      console.error(`paidSideEffects cleanup failed: ${err.message}`);
    }
    await pool.end();
  });

  test('recovery completes a tracked order exactly once (stock, journal, revenue, escrow)', async () => {
    const order = await mkPaidOrder({ items: lines(1, 2) });
    const p0 = await stockOf(fx.platformProduct);
    const v0 = await stockOf(fx.vendorProduct);

    await svc.recoverIncompletePaidOrders();
    await pool.execute(`UPDATE orders SET updated_at = DATE_SUB(NOW(), INTERVAL 30 MINUTE) WHERE id = ?`, [order.id]);
    await svc.recoverIncompletePaidOrders(); // must be a no-op now

    assert.equal(await stockOf(fx.platformProduct), p0 - 1, 'platform stock taken once');
    assert.equal(await stockOf(fx.vendorProduct), v0 - 2, 'vendor stock taken once');
    assert.equal(await countRows(`SELECT COUNT(*) AS n FROM financial_events WHERE dedupeKey = ?`, [`charge.collected:${order.paymentReference}`]), 1);
    assert.equal(await countRows(`SELECT COUNT(*) AS n FROM platform_revenue WHERE orderId = ?`, [order.id]), 1);
    assert.equal(await countRows(`SELECT COUNT(*) AS n FROM escrow_allocations WHERE orderId = ? AND status <> 'held'`, [order.id]), 0,
      'all allocations held');
    const effects = await effectsOf(order.id);
    for (const k of ['financialEventRecorded', 'escrowHeld', 'platformRevenueTracked', 'stockDecremented']) {
      assert.equal(effects[k], true, `${k} marked`);
    }
    const check = await svc.checkPaymentSideEffects(order.id);
    assert.equal(check.complete, true, `missing=${JSON.stringify(check.missing)}`);
  });

  test('a crash mid-decrement is finished without taking already-taken stock again', async () => {
    const order = await mkPaidOrder({ items: lines(1, 2) });
    // Simulate the crashed request: platform line was decremented (and
    // ledgered) by decrementStockForOrder, then the process died.
    const { decrementStockForOrder } = await import('../controllers/orderController.js');
    await decrementStockForOrder([lines(1, 2)[0]], order.id);
    const p0 = await stockOf(fx.platformProduct);
    const v0 = await stockOf(fx.vendorProduct);

    await svc.recoverIncompletePaidOrders();

    assert.equal(await stockOf(fx.platformProduct), p0, 'platform line is NOT taken a second time');
    assert.equal(await stockOf(fx.vendorProduct), v0 - 2, 'the missing vendor line is taken');
    assert.equal((await effectsOf(order.id)).stockDecremented, true);
  });

  test('untracked (pre-tracking, historical) paid orders are never re-processed', async () => {
    const order = await mkPaidOrder({ items: lines(1, 1), tracked: false });
    const p0 = await stockOf(fx.platformProduct);

    await svc.recoverIncompletePaidOrders();
    const direct = await svc.applyPaidOrderSideEffects(order.id, { source: 'test' });

    assert.equal(direct.skipped, 'untracked');
    assert.equal(await stockOf(fx.platformProduct), p0, 'historical stock untouched');
    assert.equal(await countRows(`SELECT COUNT(*) AS n FROM financial_events WHERE orderId = ?`, [order.id]), 0);
    assert.equal(await countRows(`SELECT COUNT(*) AS n FROM platform_revenue WHERE orderId = ?`, [order.id]), 0);
    const [[row]] = await pool.execute(`SELECT paymentSideEffects FROM orders WHERE id = ?`, [order.id]);
    assert.equal(row.paymentSideEffects, null);
  });

  test('cancelled orders and orders inside the grace period are left alone', async () => {
    const cancelled = await mkPaidOrder({ items: lines(1, 0).slice(0, 1), orderStatus: 'cancelled' });
    const fresh = await mkPaidOrder({ items: lines(1, 0).slice(0, 1), ageMinutes: 0 });
    const p0 = await stockOf(fx.platformProduct);

    await svc.recoverIncompletePaidOrders();

    assert.equal(await stockOf(fx.platformProduct), p0, 'neither order took stock');
    assert.deepEqual(await effectsOf(cancelled.id), {}, 'cancelled order untouched');
    assert.deepEqual(await effectsOf(fresh.id), {}, 'a just-flipped order is left to the request that flipped it');
  });

  test('an order at the attempt cap is no longer retried', async () => {
    const order = await mkPaidOrder({ items: lines(1, 0).slice(0, 1) });
    await pool.execute(
      `UPDATE orders SET paymentSideEffects = JSON_OBJECT('recoveryAttempts', 5),
         updated_at = DATE_SUB(NOW(), INTERVAL 30 MINUTE) WHERE id = ?`, [order.id]
    );
    const p0 = await stockOf(fx.platformProduct);
    await svc.recoverIncompletePaidOrders();
    assert.equal(await stockOf(fx.platformProduct), p0);
    assert.deepEqual(await effectsOf(order.id), { recoveryAttempts: 5 });
  });

  test('coupon orders settle the reserved coupon slot once', async () => {
    const order = await mkPaidOrder({ items: lines(1, 0).slice(0, 1), discount: 30, couponId: fx.coupon });
    const [[c0]] = await pool.execute(`SELECT usesUsed FROM coupons WHERE id = ?`, [fx.coupon]);

    await svc.recoverIncompletePaidOrders();
    await pool.execute(`UPDATE orders SET updated_at = DATE_SUB(NOW(), INTERVAL 30 MINUTE) WHERE id = ?`, [order.id]);
    await svc.recoverIncompletePaidOrders();

    const [[row]] = await pool.execute(`SELECT couponUseState FROM orders WHERE id = ?`, [order.id]);
    assert.equal(Number(row.couponUseState), 2, 'reserved slot settled');
    assert.equal((await effectsOf(order.id)).couponConsumed, true);
    const [[c1]] = await pool.execute(`SELECT usesUsed FROM coupons WHERE id = ?`, [fx.coupon]);
    assert.equal(Number(c1.usesUsed), Number(c0.usesUsed), 'settling a reserved slot takes no extra use');
  });

  test('B-3: on a mixed, discounted order vendor escrow + platform revenue + discount == gross', async () => {
    // 100 platform + 200 vendor, 30 off the whole order (10%).
    const order = await mkPaidOrder({ items: lines(1, 2), discount: 30 });
    const result = await svc.applyPaidOrderSideEffects(order.id, { source: 'test' });
    assert.equal(result.complete, true, result.errors.join('; '));

    const [[alloc]] = await pool.execute(`SELECT COALESCE(SUM(amount), 0) AS s FROM escrow_allocations WHERE orderId = ?`, [order.id]);
    const [[rev]] = await pool.execute(`SELECT amount, grossAmount, discountAmount FROM platform_revenue WHERE orderId = ?`, [order.id]);
    assert.equal(Number(alloc.s), 180, 'vendor carries 10% of its 200');
    assert.equal(Number(rev.grossAmount), 100);
    assert.equal(Number(rev.discountAmount), 10, 'platform carries 10% of its 100 — not the whole 30');
    assert.equal(Number(rev.amount), 90);
    assert.equal(Number(alloc.s) + Number(rev.amount) + 30, 300, 'gross reconciles');
  });

  test('webhook flip runs the shared side effects and marks the order complete', async () => {
    const order = await mkPaidOrder({ items: lines(1, 1) });
    // Put it back to pending so the webhook performs the real flip.
    await pool.execute(`UPDATE orders SET paymentStatus = 'pending', orderStatus = 'pending', paymentSideEffects = NULL WHERE id = ?`, [order.id]);
    const p0 = await stockOf(fx.platformProduct);

    const express = (await import('express')).default;
    const paymentRoutes = (await import('../routes/paymentRoutes.js')).default;
    const { startServer } = await import('./helpers/httpHarness.js');
    const app = express();
    app.use(express.json({ verify: (req, res, buf) => { req.rawBody = Buffer.from(buf); } }));
    app.use('/api/payments', paymentRoutes);
    const server = await startServer(app);
    try {
      const body = JSON.stringify({
        event: 'charge.success',
        data: { reference: order.paymentReference, amount: Math.round(Number(order.totalAmount) * 100), currency: 'GHS', status: 'success', channel: 'card' },
      });
      const sig = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(body).digest('hex');
      const send = () => fetch(`${server.baseUrl}/api/payments/paystack-webhook`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-paystack-signature': sig }, body,
      });
      assert.equal((await send()).status, 200);
      assert.equal((await send()).status, 200, 'redelivery is acknowledged');
    } finally {
      await server.close();
    }

    const check = await svc.checkPaymentSideEffects(order.id);
    assert.equal(check.complete, true, `missing=${JSON.stringify(check.missing)}`);
    assert.equal(await stockOf(fx.platformProduct), p0 - 1, 'stock taken once across the redelivery');
    const [[ev]] = await pool.execute(`SELECT payload FROM financial_events WHERE dedupeKey = ?`, [`charge.collected:${order.paymentReference}`]);
    const payload = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : ev.payload;
    assert.equal(payload.capturedBy, 'webhook', 'journal snapshot is the provider payload captured by the webhook');
  });
});
