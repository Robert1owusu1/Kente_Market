// FILE LOCATION: backend/tests/commissionEngine.test.js
// DESCRIPTION: Commission engine regression suite (COM-2, COM-3, COM-5, COM-6).
//
//   Commission base = the vendor's goods value after the order discount is
//   apportioned pro rata over the whole order gross. Tax and shipping are never
//   in the base. Each LINE is rated on its own (product > vendor > category >
//   global > vendor.platformFeeRate > PLATFORM_FEE_RATE); a vendor's fee is
//   round2(amount x line-weighted rate) and is frozen on the allocation row.
//
//   The DB tests never commit a change to the global rule (other suites run in
//   parallel and rely on the seeded 10% rule): global-fallback cases run inside
//   a transaction that is rolled back.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.EMAIL_DISABLED = '1';
process.env.REDIS_URL = '';

const {
  buildAllocationRows,
  computeCommissionLines,
  allocationFees,
} = await import('../Services/commissionService.js');
const { parseRate } = await import('../controllers/commissionController.js');

const byType = (rows, t) => rows.find((r) => r.allocationType === t);
/** Lines -> allocation rows through the same two steps checkout uses. */
const alloc = (lines, opts = {}) => buildAllocationRows(computeCommissionLines(lines, opts).lines, opts);

describe('commission accounting — pure (no DB)', () => {
  test('single rate: 2 x 100 at 10% -> amount 200, fee 20, payout 180 (unchanged formula)', () => {
    assert.deepEqual(alloc([{ vendorId: 7, gross: 200, rate: 0.1 }]),
      [{ vendorId: 7, allocationType: 'standard', amount: 200, platformFeeRate: 0.1, platformFee: 20, payoutAmount: 180 }]);
  });

  test('per-line rates: 100 @ 15% + 300 @ 5% -> fee 15 + 15 = 30 (not 400 x first line rate)', () => {
    const [row] = alloc([{ vendorId: 7, gross: 100, rate: 0.15 }, { vendorId: 7, gross: 300, rate: 0.05 }]);
    assert.deepEqual([row.amount, row.platformFee, row.payoutAmount, row.platformFeeRate], [400, 30, 370, 0.075]);
  });

  test("owner's example, ADMIN coupon: 1000 @ 20%, coupon 100 -> customer 900, seller 800 (protected), platform 100", () => {
    const [row] = alloc([{ vendorId: 7, gross: 1000, rate: 0.2 }], { discount: 100, couponVendorId: null });
    assert.deepEqual([row.amount, row.platformFee, row.payoutAmount], [900, 100, 800]);
  });

  test("owner's example, SELLER coupon: 1000 @ 20%, coupon 100 -> customer 900, seller 700, platform 200 (protected)", () => {
    const [row] = alloc([{ vendorId: 7, gross: 1000, rate: 0.2 }], { discount: 100, couponVendorId: 7 });
    assert.deepEqual([row.amount, row.platformFee, row.payoutAmount], [900, 200, 700]);
  });

  test('admin coupon is split by platform commission, so no seller funds it (mixed rates + platform item)', () => {
    // F: 15 + 15 (vendor) + 10 (platform item, notional) = 40; coupon 20 -> Da 7.5, 7.5, 5
    const { lines, appliedDiscount } = computeCommissionLines([
      { vendorId: 7, gross: 100, rate: 0.15 },
      { vendorId: 7, gross: 300, rate: 0.05 },
      { vendorId: null, gross: 100, rate: 0.1 },
    ], { discount: 20 });
    assert.equal(appliedDiscount, 20);
    assert.deepEqual(lines.map((l) => l.Da), [7.5, 7.5, 5]);
    const [row] = buildAllocationRows(lines);
    assert.deepEqual([row.amount, row.platformFee, row.payoutAmount], [385, 15, 370], 'seller still gets 400 - 30');
  });

  test('R7 cap: an admin coupon above the platform commission is cut to it (platform never pays out of pocket)', () => {
    const { appliedDiscount, lines } = computeCommissionLines([{ vendorId: 7, gross: 1000, rate: 0.2 }], { discount: 300 });
    assert.equal(appliedDiscount, 200);
    const [row] = buildAllocationRows(lines);
    assert.deepEqual([row.amount, row.platformFee, row.payoutAmount], [800, 0, 800]);
  });

  test('R7 cap: a seller coupon above the seller proceeds is cut to them (platform fee still 200)', () => {
    const { appliedDiscount, lines } = computeCommissionLines([{ vendorId: 7, gross: 1000, rate: 0.2 }], { discount: 900, couponVendorId: 7 });
    assert.equal(appliedDiscount, 800);
    const [row] = buildAllocationRows(lines);
    assert.deepEqual([row.amount, row.platformFee, row.payoutAmount], [200, 200, 0]);
  });

  test('an admin coupon on a 0% commission order applies nothing (no platform commission to fund it)', () => {
    const { appliedDiscount } = computeCommissionLines([{ vendorId: 7, gross: 80, rate: 0 }], { discount: 10 });
    assert.equal(appliedDiscount, 0);
  });

  test('two vendors each keep their own rate', () => {
    const rows = alloc([{ vendorId: 1, gross: 250, rate: 0.12 }, { vendorId: 2, gross: 250, rate: 0.08 }]);
    assert.equal(rows.find((r) => r.vendorId === 1).platformFee, 30);
    assert.equal(rows.find((r) => r.vendorId === 2).platformFee, 20);
  });

  test('advance split: 300 at 10%, ratio 0.5 -> 150/15/135 twice', () => {
    const rows = alloc([{ vendorId: 7, gross: 300, rate: 0.1 }], { advanceRatio: 0.5 });
    assert.deepEqual(byType(rows, 'advance'), { vendorId: 7, allocationType: 'advance', amount: 150, platformFeeRate: 0.1, platformFee: 15, payoutAmount: 135 });
    assert.deepEqual(byType(rows, 'balance'), { vendorId: 7, allocationType: 'balance', amount: 150, platformFeeRate: 0.1, platformFee: 15, payoutAmount: 135 });
  });

  test('product advanceRatio overrides the order-level ratio', () => {
    const rows = alloc([{ vendorId: 7, gross: 100, rate: 0.1, advanceRatio: 0.3 }], { advanceRatio: 0.5 });
    assert.equal(byType(rows, 'advance').amount, 30);
    assert.equal(byType(rows, 'balance').amount, 70);
  });

  test('rounding to pesewas: 3 x 33.33 at 12.5% -> amount 99.99, fee 12.50, payout 87.49; fee + payout == amount', () => {
    const [row] = alloc([{ vendorId: 7, gross: 3 * 33.33, rate: 0.125 }]);
    assert.deepEqual([row.amount, row.platformFee, row.payoutAmount], [99.99, 12.5, 87.49]);
    assert.equal(Math.round(row.platformFee * 100) + Math.round(row.payoutAmount * 100), Math.round(row.amount * 100));
  });

  test('0% rate is honoured (vendor keeps 100%)', () => {
    const [row] = alloc([{ vendorId: 7, gross: 80, rate: 0 }]);
    assert.deepEqual([row.platformFee, row.payoutAmount], [0, 80]);
  });
});

describe('allocationFees — release uses the fee frozen at order time (COM-5)', () => {
  test('stored fee wins over the stored (rounded, 4 dp) rate', () => {
    // A blended 0.07505 rate is stored as 0.0751; 10000 x 0.0751 = 751, but the
    // fee booked at checkout was 750.50. Release must pay 9249.50.
    assert.deepEqual(allocationFees({ amount: '10000.00', platformFee: '750.50', platformFeeRate: '0.0751' }), { platformFee: 750.5, payoutAmount: 9249.5 });
  });
  test('rows with no fee fall back to the stored rate', () => {
    assert.deepEqual(allocationFees({ amount: 200, platformFee: null, platformFeeRate: 0.1 }), { platformFee: 20, payoutAmount: 180 });
  });
  test('an impossible stored fee (> amount, negative) is not trusted', () => {
    assert.deepEqual(allocationFees({ amount: 100, platformFee: 150, platformFeeRate: 0.1 }), { platformFee: 10, payoutAmount: 90 });
    assert.deepEqual(allocationFees({ amount: 100, platformFee: -5, platformFeeRate: 0.1 }), { platformFee: 10, payoutAmount: 90 });
  });
});

describe('parseRate — strict admin rate parsing (COM-6)', () => {
  test('accepts plain decimals in 0..0.5 with <= 4 dp', () => {
    for (const [raw, want] of [[0.12, 0.12], ['0.12', 0.12], ['0.0825', 0.0825], [0, 0], ['0.5', 0.5]]) {
      assert.equal(parseRate(raw), want, String(raw));
    }
  });
  test('rejects junk, percent-style, out-of-range and over-precise values', () => {
    for (const raw of ['0.1abc', '', ' ', '12', 12, 0.51, -0.1, '1e-1', [0.1], null, undefined, true, NaN, Infinity, '0.12345', 0.12345]) {
      assert.equal(parseRate(raw), null, JSON.stringify(raw));
    }
  });
});

// ---------------------------------------------------------------------------
// DB-backed: rule precedence, category tier, per-line rating, historical
// stability, admin API validation + audit.
// ---------------------------------------------------------------------------
let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

const TS = Date.now();
const CAT = `ComCat${TS}`;
const fx = { admin: null, buyer: null, vendor: null, vendor2: null, pA: null, pB: null, pOther: null, rules: [], orders: [], coupons: [] };

const mockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};

describe('commission engine against the database', { skip: !dbAvailable }, () => {
  let svc;
  let commissions;
  let resolveCommissionRate;
  let Order;
  let seq = 0;

  const addRule = async (scope, targetId, rate, { priority = 0, isActive = 1 } = {}) => {
    const [r] = await pool.execute(
      `INSERT INTO commission_rules (scope, targetId, rate, priority, isActive) VALUES (?, ?, ?, ?, ?)`,
      [scope, targetId === null ? null : String(targetId), rate, priority, isActive]
    );
    fx.rules.push(r.insertId);
    return r.insertId;
  };
  const dropRules = async () => {
    if (fx.rules.length) await pool.query(`DELETE FROM commission_rules WHERE id IN (?)`, [fx.rules]);
    fx.rules = [];
  };

  const mkOrder = async (items, { discount = 0, couponId = null } = {}) => {
    seq += 1;
    const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
    const order = await Order.create({
      userId: fx.buyer,
      orderNumber: `COM-${TS}-${seq}`,
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
      paymentReference: `COM-REF-${TS}-${seq}`,
      couponId,
    });
    fx.orders.push(order.id);
    await svc.createEscrowAllocations(order.id, items, { discount });
    const [rows] = await pool.execute(
      `SELECT * FROM escrow_allocations WHERE orderId = ? ORDER BY vendorId, allocationType`, [order.id]
    );
    return { order, rows };
  };

  before(async () => {
    svc = await import('../Services/escrowService.js');
    commissions = await import('../controllers/commissionController.js');
    ({ resolveCommissionRate } = await import('../Services/commissionService.js'));
    Order = (await import('../models/orderModel.js')).default;
    const mkUser = async (role, tag) => (await pool.execute(
      `INSERT INTO users (email, password, firstName, lastName, role, is_email_verified)
       VALUES (?, 'x', 'COM', ?, ?, 1)`, [`com-${tag}-${TS}@example.com`, tag, role]
    ))[0].insertId;
    fx.admin = await mkUser('admin', 'admin');
    fx.buyer = await mkUser('customer', 'buyer');
    fx.vendor = await mkUser('vendor', 'vendor');
    fx.vendor2 = await mkUser('vendor', 'vendor2');
    for (const v of [fx.vendor, fx.vendor2]) {
      await pool.execute(
        `INSERT INTO vendors (userId, businessName, status, recipientCode, platformFeeRate) VALUES (?, ?, 'approved', ?, 0.07)`,
        [v, `COM vendor ${v} ${TS}`, `RCP_COM_${v}_${TS}`]
      );
    }
    const mkProduct = async (vendorId, category) => (await pool.execute(
      `INSERT INTO product (title, img, price, category, stock, vendorId, approvalStatus, madeToOrder)
       VALUES (?, '/x.png', 100, ?, 100, ?, 'approved', 0)`, [`COM product ${TS}-${Math.random()}`, category, vendorId]
    ))[0].insertId;
    fx.pA = await mkProduct(fx.vendor, CAT);
    fx.pB = await mkProduct(fx.vendor, 'general');
    fx.pOther = await mkProduct(fx.vendor2, CAT);
  });

  after(async () => {
    try {
      await dropRules();
      for (const id of fx.orders) {
        await pool.execute(`DELETE FROM wallet_transactions WHERE allocationId IN (SELECT id FROM escrow_allocations WHERE orderId = ?)`, [id]);
        await pool.execute(`DELETE FROM financial_events WHERE orderId = ? OR allocationId IN (SELECT id FROM escrow_allocations WHERE orderId = ?)`, [id, id]);
        await pool.execute(`DELETE FROM escrow_allocations WHERE orderId = ?`, [id]);
        await pool.execute(`DELETE FROM order_items WHERE orderId = ?`, [id]);
        await pool.execute(`DELETE FROM orders WHERE id = ?`, [id]);
      }
      await pool.execute(`DELETE FROM admin_audit_log WHERE actorId = ?`, [fx.admin]);
      if (fx.coupons.length) await pool.query(`DELETE FROM coupons WHERE id IN (?)`, [fx.coupons]);
      await pool.query(`DELETE FROM vendor_wallets WHERE vendorId IN (?)`, [[fx.vendor, fx.vendor2]]);
      await pool.query(`DELETE FROM product WHERE id IN (?)`, [[fx.pA, fx.pB, fx.pOther]]);
      await pool.query(`DELETE FROM vendors WHERE userId IN (?)`, [[fx.vendor, fx.vendor2]]);
      await pool.query(`DELETE FROM users WHERE id IN (?)`, [[fx.admin, fx.buyer, fx.vendor, fx.vendor2]]);
    } catch (err) {
      console.error(`commissionEngine cleanup failed: ${err.message}`);
    }
    await pool.end();
  });

  test('precedence: product > vendor > category > global; inactive rules ignored; priority breaks ties', async () => {
    const at = () => resolveCommissionRate({ productId: fx.pA, vendorId: fx.vendor, category: CAT });
    assert.equal(await at(), 0.1, 'seeded 10% global rule');
    await addRule('category', CAT, 0.11);
    assert.equal(await at(), 0.11, 'category beats global');
    await addRule('vendor', fx.vendor, 0.09);
    assert.equal(await at(), 0.09, 'vendor beats category');
    await addRule('product', fx.pA, 0.15, { isActive: 0 });
    assert.equal(await at(), 0.09, 'inactive product rule ignored');
    await addRule('product', fx.pA, 0.14);
    await addRule('product', fx.pA, 0.13, { priority: 5 });
    assert.equal(await at(), 0.13, 'product beats vendor; higher priority wins within a scope');
    await dropRules();
  });

  test('global fallback chain (inside a rolled-back transaction): global rule -> vendor.platformFeeRate -> PLATFORM_FEE_RATE', async () => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(`UPDATE commission_rules SET isActive = 0 WHERE scope = 'global'`);
      assert.equal(await resolveCommissionRate({ productId: fx.pB, vendorId: fx.vendor }, conn), 0.07, "vendor's own rate");
      const { PLATFORM_FEE_RATE } = await import('../config/businessConfig.js');
      assert.equal(await resolveCommissionRate({ productId: fx.pB }, conn), PLATFORM_FEE_RATE, 'env default');
    } finally {
      await conn.rollback();
      conn.release();
    }
    assert.equal(await resolveCommissionRate({ productId: fx.pB, vendorId: fx.vendor }), 0.1, 'global rule intact for everyone else');
  });

  test('COM-2: a category rule now applies at checkout (was unreachable)', async () => {
    await addRule('category', CAT, 0.12);
    const { rows } = await mkOrder([{ product: fx.pOther, qty: 2, price: 100, vendorId: fx.vendor2 }]);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].amount), 200);
    assert.equal(Number(rows[0].platformFee), 24, '200 x 12% category rate, not the 10% global');
    assert.equal(Number(rows[0].payoutAmount), 176);
    await dropRules();
  });

  test('COM-3: each line is rated on its own product — a product rule does not leak to sibling lines', async () => {
    await addRule('product', fx.pB, 0.2); // only pB; pA falls to global 10%
    // pA listed first: the old code used the first product's rate (10%) for both.
    const { rows } = await mkOrder([
      { product: fx.pA, qty: 1, price: 100, vendorId: fx.vendor },
      { product: fx.pB, qty: 1, price: 100, vendorId: fx.vendor },
    ]);
    assert.equal(rows.length, 1, 'still one allocation per vendor');
    assert.equal(Number(rows[0].amount), 200);
    assert.equal(Number(rows[0].platformFee), 30, '100 x 10% + 100 x 20%');
    assert.equal(Number(rows[0].payoutAmount), 170);
    assert.equal(Number(rows[0].platformFeeRate), 0.15);
    await dropRules();
  });

  test('admin-coupon multi-vendor order: split by platform commission; seller proceeds + platform + discount == goods gross', async () => {
    await addRule('vendor', fx.vendor2, 0.08);
    // V1 3 x 100 @ 10% (F 30), V2 2 x 100 @ 8% (F 16); admin coupon 23 -> Da 15 / 8
    const { order, rows } = await mkOrder([
      { product: fx.pA, qty: 3, price: 100, vendorId: fx.vendor },
      { product: fx.pOther, qty: 2, price: 100, vendorId: fx.vendor2 },
    ], { discount: 23 });
    const a = rows.find((r) => r.vendorId === fx.vendor);
    const b = rows.find((r) => r.vendorId === fx.vendor2);
    assert.deepEqual([Number(a.amount), Number(a.platformFee), Number(a.payoutAmount)], [285, 15, 270], 'V1 keeps 300 - 30');
    assert.deepEqual([Number(b.amount), Number(b.platformFee), Number(b.payoutAmount)], [192, 8, 184], 'V2 keeps 200 - 16');
    const sum = (k) => rows.reduce((s, r) => s + Math.round(Number(r[k]) * 100), 0);
    assert.equal(sum('payoutAmount') + sum('platformFee') + 2300, 50000);
    const [[o]] = await pool.execute(`SELECT commissionSnapshot FROM orders WHERE id = ?`, [order.id]);
    const snap = typeof o.commissionSnapshot === 'string' ? JSON.parse(o.commissionSnapshot) : o.commissionSnapshot;
    assert.equal(snap.funder, 'platform');
    assert.deepEqual(snap.lines.map((l) => l.Da), [15, 8], 'snapshot freezes the split');
    await dropRules();
  });

  test('seller-coupon order: the seller funds it, platform fee protected (coupon owner read from orders.couponId)', async () => {
    const [c] = await pool.execute(
      `INSERT INTO coupons (code, discountType, discountValue, minPurchase, maxUses, isActive, vendorId) VALUES (?, 'fixed', 20, 0, 10, 1, ?)`,
      [`COMSELL${TS}`, fx.vendor]
    );
    fx.coupons.push(c.insertId);
    const { rows } = await mkOrder([{ product: fx.pA, qty: 2, price: 100, vendorId: fx.vendor }], { discount: 20, couponId: c.insertId });
    assert.deepEqual([Number(rows[0].amount), Number(rows[0].platformFee), Number(rows[0].payoutAmount)], [180, 20, 160]);
  });

  test('checkout cap (R7): capCouponDiscount limits admin and seller coupons on real rules', async () => {
    const { capCouponDiscount } = await import('../Services/commissionService.js');
    const items = [{ product: fx.pA, qty: 1, price: 100, vendorId: fx.vendor }]; // global 10% -> F 10
    assert.equal(await capCouponDiscount(pool, items, 25, null), 10, 'admin coupon <= platform commission');
    assert.equal(await capCouponDiscount(pool, items, 25, fx.vendor), 25, 'seller coupon within proceeds');
    assert.equal(await capCouponDiscount(pool, items, 95, fx.vendor), 90, 'seller coupon <= seller proceeds');
  });

  test('historical stability: changing a rule after checkout never changes that order (release pays the frozen payout)', async () => {
    const ruleId = await addRule('vendor', fx.vendor, 0.1);
    const { order, rows } = await mkOrder([{ product: fx.pA, qty: 1, price: 100, vendorId: fx.vendor }]);
    assert.equal(Number(rows[0].platformFee), 10);
    // Admin raises the vendor's rate to 25% after the order was placed.
    await pool.execute(`UPDATE commission_rules SET rate = 0.25 WHERE id = ?`, [ruleId]);
    // Simulate a stored rate that no longer reproduces the fee (as for a blended rate).
    await pool.execute(`UPDATE escrow_allocations SET platformFeeRate = 0.2500 WHERE id = ?`, [rows[0].id]);
    await pool.execute(`UPDATE orders SET paymentStatus = 'paid', orderStatus = 'delivered' WHERE id = ?`, [order.id]);
    await pool.execute(`UPDATE escrow_allocations SET status = 'held' WHERE id = ?`, [rows[0].id]);
    const [[held]] = await pool.execute(`SELECT * FROM escrow_allocations WHERE id = ?`, [rows[0].id]);
    const result = await svc.releaseAllocation(held);
    assert.equal(result.status, 'available', result.reason);
    const [[after]] = await pool.execute(`SELECT platformFee, payoutAmount FROM escrow_allocations WHERE id = ?`, [rows[0].id]);
    assert.equal(Number(after.platformFee), 10);
    assert.equal(Number(after.payoutAmount), 90);
    const [[credit]] = await pool.execute(`SELECT amount FROM wallet_transactions WHERE allocationId = ? AND type = 'credit'`, [rows[0].id]);
    assert.equal(Number(credit.amount), 90, 'wallet credited at the rate in force when the order was placed');
    await dropRules();
  });

  test('refunds reverse commission: per-vendor partial refund drops only that vendor; full cancel drops all, wallet clawed back exactly', async () => {
    // Earned commission = sum(platformFee) over allocations that are not 'failed'.
    const earned = async (orderId) => Number((await pool.execute(
      `SELECT COALESCE(SUM(platformFee), 0) AS f FROM escrow_allocations WHERE orderId = ? AND status <> 'failed'`, [orderId]
    ))[0][0].f);
    await addRule('vendor', fx.vendor2, 0.08);
    const { order, rows } = await mkOrder([
      { product: fx.pA, qty: 2, price: 100, vendorId: fx.vendor },    // 200 @ 10% -> 20
      { product: fx.pOther, qty: 1, price: 100, vendorId: fx.vendor2 }, // 100 @ 8%  -> 8
    ]);
    await pool.execute(`UPDATE orders SET paymentStatus = 'paid', orderStatus = 'delivered' WHERE id = ?`, [order.id]);
    await pool.execute(`UPDATE escrow_allocations SET status = 'held' WHERE orderId = ?`, [order.id]);
    assert.equal(await earned(order.id), 28);

    // vendor's allocation is released (credited 180) before the refunds.
    const a = rows.find((r) => r.vendorId === fx.vendor);
    const [[heldA]] = await pool.execute(`SELECT * FROM escrow_allocations WHERE id = ?`, [a.id]);
    assert.equal((await svc.releaseAllocation(heldA)).status, 'available');
    const wallet = async (v) => Number((await pool.execute(`SELECT available_balance AS b FROM vendor_wallets WHERE vendorId = ?`, [v]))[0][0]?.b ?? 0);
    const before = await wallet(fx.vendor);

    await svc.voidVendorEscrow(order.id, fx.vendor2);
    assert.equal(await earned(order.id), 20, "vendor2's 8 reversed, vendor's 20 untouched");

    await svc.voidEscrowForOrder(order.id);
    assert.equal(await earned(order.id), 0, 'no commission kept on a fully refunded order');
    assert.equal(Math.round((before - (await wallet(fx.vendor))) * 100), 18000, 'exactly the credited 180 clawed back, once');
    await svc.voidEscrowForOrder(order.id);
    assert.equal(Math.round((before - (await wallet(fx.vendor))) * 100), 18000, 'a repeated void claws back nothing more');
    await dropRules();
  });

  test('admin API: validates scope/target/rate, records full before/after audit, and update re-validates the pair', async () => {
    const adminReq = (body, params = {}) => ({ body, params, user: { id: fx.admin, role: 'admin', email: 'a@example.com' }, ip: '127.0.0.1', get: () => 'test' });
    const bad = [
      [{ scope: 'category', target: CAT, rate: 0.1 }, /target is required/i], // the old UI field name
      [{ scope: 'category', targetId: 'NoSuchCategory-zzz', rate: 0.1 }, /Unknown category/],
      [{ scope: 'vendor', targetId: '999999999', rate: 0.1 }, /not found/],
      [{ scope: 'product', targetId: '12abc', rate: 0.1 }, /valid id/],
      [{ scope: 'vendor', targetId: String(fx.vendor), rate: '0.1abc' }, /Rate must be/],
      [{ scope: 'vendor', targetId: String(fx.vendor), rate: 12 }, /Rate must be/],
      [{ scope: 'weird', rate: 0.1 }, /Scope must be/],
    ];
    for (const [body, msg] of bad) {
      const res = mockRes();
      await commissions.createCommissionRule(adminReq(body), res);
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.match(res.body.message, msg);
    }

    const res = mockRes();
    await commissions.createCommissionRule(adminReq({ scope: 'category', targetId: ` ${CAT} `, rate: '0.125' }), res);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    const ruleId = res.body.rule.id;
    fx.rules.push(ruleId);
    assert.equal(res.body.rule.targetId, CAT);
    assert.equal(res.body.rule.rate, 0.125);

    // Changing only the scope must re-validate the existing target against it.
    const r2 = mockRes();
    await commissions.updateCommissionRule(adminReq({ scope: 'product' }, { id: String(ruleId) }), r2);
    assert.equal(r2.statusCode, 400, 'a category name is not a product id');

    const r3 = mockRes();
    await commissions.updateCommissionRule(adminReq({ rate: 0.13 }, { id: String(ruleId) }), r3);
    assert.equal(r3.statusCode, 200);
    const [[audit]] = await pool.execute(
      `SELECT beforeVal, afterVal FROM admin_audit_log WHERE actorId = ? AND action = 'commission.update' AND entityId = ? ORDER BY id DESC LIMIT 1`,
      [fx.admin, String(ruleId)]
    );
    const before = typeof audit.beforeVal === 'string' ? JSON.parse(audit.beforeVal) : audit.beforeVal;
    const afterVal = typeof audit.afterVal === 'string' ? JSON.parse(audit.afterVal) : audit.afterVal;
    assert.equal(before.rate, 0.125, 'audit keeps the previous rate (was only {id})');
    assert.equal(before.targetId, CAT);
    assert.equal(afterVal.rate, 0.13);
    await dropRules();
  });
});
