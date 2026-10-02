// FILE LOCATION: backend/tests/couponScope.test.js
// DESCRIPTION: P0-4 (vendor coupon scope), P0-5 (usage race reports loser),
//              P0-6 (decrement frees uses). DB-backed; cleans up after itself.
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

const ts = Date.now();
const state = { vendorA: null, vendorB: null, prodA: null, prodB: null, vendorCouponId: null, cappedCouponId: null };

before(async () => {
  if (!dbAvailable || !pool) return;
  const User = (await import('../models/usersModel.js')).default;
  const mk = (tag) => User.create({
    firstName: 'Coupon', lastName: tag, email: `couponscope-${tag}-${ts}@example.com`,
    password: 'Test1234x', role: 'vendor', legalConsentAccepted: true,
  });
  const a = await mk('a');
  const b = await mk('b');
  state.vendorA = a.id;
  state.vendorB = b.id;

  const mkProd = async (vendorId, tag) => {
    const [r] = await pool.execute(
      `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'approved')`,
      [`COUPSCOPE ${ts} ${tag}`, '/uploads/test.png', 100.0, 'test', 10, vendorId]
    );
    return r.insertId;
  };
  state.prodA = await mkProd(a.id, 'A');
  state.prodB = await mkProd(b.id, 'B');

  // Vendor-A coupon (raw insert mirrors vendorController.createVendorCoupon).
  const [c1] = await pool.execute(
    `INSERT INTO coupons (code, discountType, discountValue, minPurchase, maxUses, expiresAt, isActive, vendorId)
     VALUES (?, 'percentage', 10, 0, NULL, NULL, 1, ?)`,
    [`SCOPEA${String(ts).slice(-6)}`, a.id]
  );
  state.vendorCouponId = c1.insertId;
  const [c2] = await pool.execute(
    `INSERT INTO coupons (code, discountType, discountValue, minPurchase, maxUses, expiresAt, isActive, vendorId)
     VALUES (?, 'fixed', 5, 0, 1, NULL, 1, NULL)`,
    [`CAP${String(ts).slice(-6)}`]
  );
  state.cappedCouponId = c2.insertId;
  const [[capped]] = await pool.execute(`SELECT code FROM coupons WHERE id = ?`, [c2.insertId]);
  state.cappedCode = capped.code;
  const [[scoped]] = await pool.execute(`SELECT code FROM coupons WHERE id = ?`, [c1.insertId]);
  state.scopedCode = scoped.code;
});

after(async () => {
  if (!dbAvailable || !pool) return;
  try {
    await pool.execute(`DELETE FROM product WHERE id IN (?, ?)`, [state.prodA, state.prodB]);
    await pool.execute(`DELETE FROM coupons WHERE id IN (?, ?)`, [state.vendorCouponId, state.cappedCouponId]);
    await pool.execute(`DELETE FROM users WHERE id IN (?, ?)`, [state.vendorA, state.vendorB]);
  } finally {
    await pool.end();
  }
});

describe('P0-4 vendor coupon scope', () => {
  test('vendor coupon valid for own-vendor cart only', { skip: !dbAvailable }, async () => {
    const Coupon = (await import('../models/couponModel.js')).default;
    const own = await Coupon.validate(state.scopedCode, 100, { vendorIds: [state.vendorA] });
    assert.equal(own.valid, true, `own cart should validate: ${own.message}`);
    const other = await Coupon.validate(state.scopedCode, 100, { vendorIds: [state.vendorB] });
    assert.equal(other.valid, false);
    assert.match(other.message, /issuing store/);
    const mixed = await Coupon.validate(state.scopedCode, 200, { vendorIds: [state.vendorA, state.vendorB] });
    assert.equal(mixed.valid, false, 'mixed cart must not redeem a single-vendor coupon');
  });

  test('platform coupon applies to any vendor mix', { skip: !dbAvailable }, async () => {
    const Coupon = (await import('../models/couponModel.js')).default;
    const r = await Coupon.validate(state.cappedCode, 100, { vendorIds: [state.vendorA, state.vendorB] });
    assert.equal(r.valid, true, `platform coupon should validate: ${r.message}`);
  });

  test('toPublic exposes vendorId for store messaging', { skip: !dbAvailable }, async () => {
    const Coupon = (await import('../models/couponModel.js')).default;
    const found = await Coupon.findByCode(state.scopedCode);
    assert.equal(Number(Coupon.toPublic(found).vendorId), Number(state.vendorA));
  });
});

describe('P0-5/P0-6 usage accounting', () => {
  test('maxUses=1: first consume wins, second reports consumed=false, decrement frees', { skip: !dbAvailable }, async () => {
    const Coupon = (await import('../models/couponModel.js')).default;
    const first = await Coupon.incrementUses(state.cappedCouponId);
    assert.equal(first.consumed, true);
    const second = await Coupon.incrementUses(state.cappedCouponId);
    assert.equal(second.consumed, false, 'race loser must be reported');
    // Validation now also refuses (cap reached).
    const v = await Coupon.validate(state.cappedCode, 100);
    assert.equal(v.valid, false);
    await Coupon.decrementUses(state.cappedCouponId);
    const v2 = await Coupon.validate(state.cappedCode, 100);
    assert.equal(v2.valid, true, 'released use is redeemable again');
  });
});
