// FILE LOCATION: backend/tests/referralSystem.test.js
// DESCRIPTION: Referral (ambassador) commission system — REFERRAL_SYSTEM_DESIGN.md.
//   Covers the owner's 20 required scenarios with explicit numbers. Disposable
//   DB only (testDbGuard); Paystack is stubbed (no network, test mode only).
//   Fixtures: Kwame (referrer) refers Ama (customer); vendor at 20 % platform
//   commission (vendor rule); referral standard rate 4 %.
//   Referral settings are global: they are set in before() and restored to
//   their previous values in after(). No other suite creates referred users.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.EMAIL_DISABLED = '1';
process.env.REDIS_URL = '';
process.env.PAYSTACK_SECRET_KEY ||= 'sk_test_referral_placeholder';

const ref = await import('../Services/referralService.js');

describe('referral pure helpers (no DB)', () => {
  test('canonicalEmail folds gmail dots/+tags and googlemail', () => {
    assert.equal(ref.canonicalEmail('Kwa.me+promo@GoogleMail.com'), 'kwame@gmail.com');
    assert.equal(ref.canonicalEmail('kwame+x@yahoo.com'), 'kwame@yahoo.com');
    assert.equal(ref.canonicalEmail('k.wame@yahoo.com'), 'k.wame@yahoo.com', 'dots only ignored for gmail');
  });
  test('normPhone matches +233 / 0 prefixes', () => {
    assert.equal(ref.normPhone('+233 24 123 4567'), ref.normPhone('0241234567'));
  });
  test("owner's numbers: rate x list price, capped at F - Da", () => {
    const snap = (Da) => ({ lines: [{ vendorId: 1, P: 1000, F: 200, Da }] });
    assert.deepEqual(ref.computeReferralAmount(snap(0), 0.04), { base: 1000, cap: 200, amount: 40 });
    assert.equal(ref.computeReferralAmount(snap(100), 0.04).amount, 40, 'admin coupon 10%: platform keeps 60');
    assert.equal(ref.computeReferralAmount(snap(180), 0.04).amount, 20, 'admin coupon 18%: capped, platform keeps 0');
    assert.equal(ref.computeReferralAmount(snap(200), 0.04).amount, 0, 'nothing left: no referral');
  });
  test('refund exclusions: per-vendor and full', () => {
    const snap = { lines: [{ vendorId: 1, P: 600, F: 120, Da: 0 }, { vendorId: 2, P: 400, F: 80, Da: 0 }] };
    assert.equal(ref.computeReferralAmount(snap, 0.04).amount, 40);
    assert.equal(ref.computeReferralAmount(snap, 0.04, { excludeVendorIds: new Set(['2']) }).amount, 24);
    assert.equal(ref.computeReferralAmount(snap, 0.04, { fullRefund: true }).amount, 0);
  });
  test('tampered or foreign capture tokens are rejected', () => {
    const good = ref.signVisitToken('ABCDEFGH');
    assert.equal(ref.readVisitToken(good), 'ABCDEFGH');
    assert.equal(ref.readVisitToken(good.slice(0, -2) + 'xx'), null);
    assert.equal(ref.readVisitToken('not-a-token'), null);
  });
});

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

const TS = Date.now();
const fx = { kwame: null, kwameCode: null, vendor: null, vendor2: null, product: null, product2: null, admin: null, users: [], orders: [], rules: [], coupons: [] };
let savedSettings = [];

const mockRes = () => {
  const res = { statusCode: 200, body: undefined, cookies: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.cookie = (k, v) => { res.cookies[k] = v; return res; };
  return res;
};
const cents = (v) => Math.round(Number(v) * 100);

describe('referral system against the database', { skip: !dbAvailable }, () => {
  let escrow; let payout; let Order; let refCtl; let paystack; let hooks;
  const origPaystack = {};
  let seq = 0;

  const mkUser = async (tag, { email, role = 'customer', phone = null } = {}) => {
    const [r] = await pool.execute(
      `INSERT INTO users (email, password, firstName, lastName, role, is_email_verified, phone) VALUES (?, 'x', ?, 'Test', ?, 1, ?)`,
      [email || `ref-${tag}-${TS}@example.com`, tag, role, phone]
    );
    fx.users.push(r.insertId);
    return r.insertId;
  };
  /** New account through the real signup binding, as Ama clicking Kwame's link. */
  const signUpReferred = async (tag, opts = {}) => {
    const id = await mkUser(tag, opts);
    const result = await ref.bindReferralAtSignup({
      userId: id,
      email: opts.email || `ref-${tag}-${TS}@example.com`,
      visitToken: opts.visitToken !== undefined ? opts.visitToken : ref.signVisitToken(fx.kwameCode),
      deviceId: opts.deviceId || crypto.randomBytes(16).toString('hex'),
      ip: opts.ip || `10.${TS % 200}.${seq % 200}.${Math.floor(Math.random() * 200)}`,
    });
    return { id, result };
  };
  const mkOrder = async (userId, items, { discount = 0, couponId = null } = {}) => {
    seq += 1;
    const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
    const order = await Order.create({
      userId, orderNumber: `REF-${TS}-${seq}`, items,
      totalAmount: Math.max(subtotal - discount, 0) + 150,
      shippingAddress: { fullName: 'Ama', street: `${seq} Loom Rd`, city: 'Kumasi', country: 'GH', phone: `02400${String(seq).padStart(5, '0')}` },
      billingAddress: { city: 'Kumasi', country: 'GH' }, paymentMethod: 'paystack', paymentStatus: 'pending', orderStatus: 'pending',
      shippingCost: 0, tax: 150, discount, paymentReference: `REF-REF-${TS}-${seq}`, couponId,
    });
    fx.orders.push(order.id);
    await escrow.createEscrowAllocations(order.id, items, { discount });
    return order;
  };
  /** Backend-verified payment: paid flip + the shared side effects (as webhook/verify do). */
  const pay = async (order, charge = { authorization: { signature: `sig-${order.id}` }, channel: 'card' }) => {
    await pool.execute(
      `UPDATE orders SET paymentStatus = 'paid', orderStatus = 'processing', paymentSideEffects = COALESCE(paymentSideEffects, JSON_OBJECT()) WHERE id = ?`, [order.id]
    );
    return escrow.applyPaidOrderSideEffects(order.id, { source: 'test', charge });
  };
  const complete = async (orderId) => {
    await pool.execute(`UPDATE orders SET orderStatus = 'delivered', deliveredAt = NOW() WHERE id = ?`, [orderId]);
    await pool.execute(`UPDATE escrow_allocations SET status = 'released' WHERE orderId = ? AND status IN ('pending','held')`, [orderId]);
    return ref.promoteReferralCommissions({ orderIds: [orderId] });
  };
  const commissionOf = async (orderId) => (await pool.execute(`SELECT * FROM referral_commissions WHERE orderId = ?`, [orderId]))[0];
  const wallet = (userId) => ref.getReferralWallet(userId);
  const line = (qty = 1, product = fx.product, vendorId = fx.vendor, price = 1000) => ({ product, qty, price, vendorId, name: 'Kente' });

  before(async () => {
    escrow = await import('../Services/escrowService.js');
    payout = await import('../Services/referralPayoutService.js');
    Order = (await import('../models/orderModel.js')).default;
    refCtl = await import('../controllers/referralController.js');
    paystack = (await import('../Services/paystackservices.js')).default;
    hooks = (await import('../Services/transferReconciliationService.js')).transferReconciliationHooks;
    origPaystack.initiateTransfer = paystack.initiateTransfer;
    origPaystack.verify = hooks.verifyTransfer;

    [savedSettings] = await pool.execute(`SELECT settingKey, settingValue FROM settings WHERE settingKey LIKE 'referral.%'`);
    for (const [k, v] of [['referral.enabled', 'true'], ['referral.standardRate', '0.04'], ['referral.windowDays', '30']]) {
      await pool.execute(`INSERT INTO settings (settingKey, settingValue) VALUES (?, ?) ON DUPLICATE KEY UPDATE settingValue = VALUES(settingValue)`, [k, v]);
    }
    fx.admin = await mkUser('admin', { role: 'admin' });
    fx.kwame = await mkUser('kwame', { email: `kwame.ref+${TS}@gmail.com`, phone: '0201112233' });
    fx.kwameCode = await ref.ensureReferralCode(fx.kwame);
    fx.vendor = await mkUser('vendor', { role: 'vendor' });
    fx.vendor2 = await mkUser('vendor2', { role: 'vendor' });
    for (const v of [fx.vendor, fx.vendor2]) {
      await pool.execute(`INSERT INTO vendors (userId, businessName, status, recipientCode) VALUES (?, ?, 'approved', ?)`, [v, `Ref vendor ${v}`, `RCP_REF_${v}`]);
      const [r] = await pool.execute(`INSERT INTO commission_rules (scope, targetId, rate, priority, isActive) VALUES ('vendor', ?, 0.2, 0, 1)`, [String(v)]);
      fx.rules.push(r.insertId);
    }
    const mkP = async (v) => (await pool.execute(
      `INSERT INTO product (title, img, price, category, stock, vendorId, approvalStatus, madeToOrder) VALUES (?, '/x.png', 1000, 'general', 1000, ?, 'approved', 0)`,
      [`Ref kente ${TS}-${v}`, v]
    ))[0].insertId;
    fx.product = await mkP(fx.vendor);
    fx.product2 = await mkP(fx.vendor2);
  });

  after(async () => {
    paystack.initiateTransfer = origPaystack.initiateTransfer;
    hooks.verifyTransfer = origPaystack.verify;
    try {
      for (const { settingKey, settingValue } of savedSettings) {
        await pool.execute(`UPDATE settings SET settingValue = ? WHERE settingKey = ?`, [settingValue, settingKey]);
      }
      if (fx.orders.length) {
        await pool.query(`DELETE FROM referral_commissions WHERE orderId IN (?)`, [fx.orders]);
        await pool.query(`DELETE FROM wallet_transactions WHERE allocationId IN (SELECT id FROM escrow_allocations WHERE orderId IN (?))`, [fx.orders]);
        await pool.query(`DELETE FROM financial_events WHERE orderId IN (?) OR allocationId IN (SELECT id FROM escrow_allocations WHERE orderId IN (?))`, [fx.orders, fx.orders]);
        await pool.query(`DELETE FROM escrow_allocations WHERE orderId IN (?)`, [fx.orders]);
        await pool.query(`DELETE FROM platform_revenue WHERE orderId IN (?)`, [fx.orders]);
        await pool.query(`DELETE FROM stock_moves WHERE orderId IN (?)`, [fx.orders]).catch(() => {});
        await pool.query(`DELETE FROM order_items WHERE orderId IN (?)`, [fx.orders]);
        await pool.query(`DELETE FROM orders WHERE id IN (?)`, [fx.orders]);
      }
      await pool.query(`DELETE FROM referral_ledger WHERE userId IN (?)`, [fx.users]);
      await pool.query(`DELETE FROM referral_withdrawals WHERE userId IN (?)`, [fx.users]);
      await pool.query(`DELETE FROM referral_wallets WHERE userId IN (?)`, [fx.users]);
      await pool.query(`DELETE FROM user_devices WHERE userId IN (?)`, [fx.users]);
      await pool.query(`DELETE FROM user_addresses WHERE userId IN (?)`, [fx.users]);
      await pool.query(`DELETE FROM admin_audit_log WHERE actorId IN (?)`, [fx.users]);
      await pool.query(`DELETE FROM notifications WHERE userId IN (?)`, [fx.users]);
      if (fx.coupons.length) await pool.query(`DELETE FROM coupons WHERE id IN (?)`, [fx.coupons]);
      if (fx.rules.length) await pool.query(`DELETE FROM commission_rules WHERE id IN (?)`, [fx.rules]);
      await pool.query(`DELETE FROM vendor_wallets WHERE vendorId IN (?)`, [[fx.vendor, fx.vendor2]]);
      await pool.query(`DELETE FROM product WHERE id IN (?)`, [[fx.product, fx.product2]]);
      await pool.query(`DELETE FROM vendors WHERE userId IN (?)`, [[fx.vendor, fx.vendor2]]);
      await pool.query(`UPDATE users SET referredBy = NULL WHERE id IN (?)`, [fx.users]);
      await pool.query(`DELETE FROM users WHERE id IN (?)`, [fx.users]);
    } catch (err) {
      console.error(`referralSystem cleanup failed: ${err.message}`);
    }
    await pool.end();
  });

  test('1 + 10 + 12: signup binds a valid link only; invalid code, self, email alias and same device are refused', async () => {
    const ok = await signUpReferred('ama1');
    assert.equal(ok.result.bound, true);
    const [[u]] = await pool.execute(`SELECT referredBy FROM users WHERE id = ?`, [ok.id]);
    assert.equal(u.referredBy, fx.kwame);
    assert.equal((await pool.execute(`SELECT COUNT(*) n FROM referral_commissions WHERE customerId = ?`, [ok.id]))[0][0].n, 0, 'registration earns nothing');

    assert.equal((await signUpReferred('bad1', { visitToken: ref.signVisitToken('ZZZZZZZZ') })).result.bound, false, 'unknown code');
    assert.equal((await signUpReferred('bad2', { visitToken: 'forged.token.value' })).result.reason, 'invalid_token');
    const alias = await signUpReferred('alias', { email: `kwameref+other${TS}@googlemail.com` });
    // canonical of kwame.ref+TS@gmail.com is kwameref@gmail.com
    assert.equal(alias.result.reason, 'email_alias');
    const dev = crypto.randomBytes(16).toString('hex');
    await ref.recordDevice(fx.kwame, dev);
    assert.equal((await signUpReferred('samedev', { deviceId: dev })).result.reason, 'same_device');
    const self = await ref.bindReferralAtSignup({ userId: fx.kwame, email: `kwame.ref+${TS}@gmail.com`, visitToken: ref.signVisitToken(fx.kwameCode) });
    assert.equal(self.reason, 'self');
  });

  test('existing customers cannot be referred (first link wins, account already bound)', async () => {
    const id = await mkUser('existing');
    await mkOrder(id, [line()]);
    const r = await ref.bindReferralAtSignup({ userId: id, email: `ref-existing-${TS}@example.com`, visitToken: ref.signVisitToken(fx.kwameCode) });
    assert.equal(r.bound, false);
    assert.equal(r.reason, 'already_bound_or_existing_customer');
  });

  test('2: a link click alone sets a capture cookie (first link wins) and earns nothing', async () => {
    const res = mockRes();
    await refCtl.captureReferralVisit({ body: { code: fx.kwameCode }, cookies: {} }, res);
    assert.ok(res.cookies[ref.REFERRAL_COOKIE], 'cookie set');
    const res2 = mockRes();
    await refCtl.captureReferralVisit({ body: { code: fx.kwameCode }, cookies: { [ref.REFERRAL_COOKIE]: res.cookies[ref.REFERRAL_COOKIE] } }, res2);
    assert.equal(res2.cookies[ref.REFERRAL_COOKIE], undefined, 'an existing capture is never replaced');
    const res3 = mockRes();
    await refCtl.captureReferralVisit({ body: { code: 'NOPE' }, cookies: {} }, res3);
    assert.deepEqual([res3.body, res3.cookies[ref.REFERRAL_COOKIE]], [{ ok: true }, undefined], 'same reply, no cookie for invalid code');
  });

  test('3 + 4 + 5 + 15: abandoned, failed, pending and cancelled orders create no commission', async () => {
    const { id } = await signUpReferred('ama2');
    const abandoned = await mkOrder(id, [line()]);
    assert.equal(await ref.recordReferralForOrder(abandoned.id), true);
    const failed = await mkOrder(id, [line()]);
    await pool.execute(`UPDATE orders SET paymentStatus = 'failed' WHERE id = ?`, [failed.id]);
    await ref.recordReferralForOrder(failed.id);
    const cancelled = await mkOrder(id, [line()]);
    await pool.execute(`UPDATE orders SET paymentStatus = 'paid', orderStatus = 'cancelled' WHERE id = ?`, [cancelled.id]);
    await ref.recordReferralForOrder(cancelled.id);
    for (const o of [abandoned, failed, cancelled]) assert.equal((await commissionOf(o.id)).length, 0);
    assert.equal(await ref.promoteReferralCommissions({ orderIds: [abandoned.id, failed.id, cancelled.id] }), 0);
  });

  test("6 + 16 + 17: verified GH₵1,000 purchase -> GH₵40 pending; platform 200 - 40 = 160; seller 800; server values only", async () => {
    const { id } = await signUpReferred('ama3');
    const order = await mkOrder(id, [line()]);
    // Tampering with the stored items after checkout must not change anything (snapshot is authoritative).
    await pool.execute(`UPDATE orders SET items = JSON_SET(items, '$[0].price', 99999) WHERE id = ?`, [order.id]);
    const effects = await pay(order);
    assert.equal(effects.errors.length, 0, effects.errors.join('; '));
    const [c] = await commissionOf(order.id);
    assert.deepEqual([c.status, Number(c.base), Number(c.rate), Number(c.cap), Number(c.amount)], ['pending', 1000, 0.04, 200, 40]);
    const [[a]] = await pool.execute(`SELECT amount, platformFee, payoutAmount FROM escrow_allocations WHERE orderId = ?`, [order.id]);
    assert.deepEqual([Number(a.amount), Number(a.platformFee), Number(a.payoutAmount)], [1000, 200, 800]);
    assert.equal(cents(a.payoutAmount) + cents(a.platformFee) - cents(c.amount) + cents(c.amount), 100000, 'seller + platform net + referral = goods');
    assert.ok(cents(a.platformFee) - cents(c.amount) >= 0, 'platform never negative');
    assert.deepEqual(await wallet(fx.kwame), { balance: 0, reserved: 0, totalEarned: 0, totalWithdrawn: 0, totalSpent: 0 }, 'pending is not withdrawable');
  });

  test("Scenario G with the owner's coupons: admin 10% -> referral 40, platform 60; admin 18% -> referral 20, platform 0; seller 10% -> referral 40, seller 700", async () => {
    const { id } = await signUpReferred('ama4');
    const adminCoupon = await mkOrder(id, [line()], { discount: 100 });
    await pay(adminCoupon);
    const [[a1]] = await pool.execute(`SELECT platformFee, payoutAmount FROM escrow_allocations WHERE orderId = ?`, [adminCoupon.id]);
    assert.equal(Number((await commissionOf(adminCoupon.id))[0].amount), 40);
    assert.deepEqual([Number(a1.platformFee), Number(a1.payoutAmount)], [100, 800], 'seller protected; platform 100 - 40 = 60 after referral');

    const { id: id2 } = await signUpReferred('ama5');
    const big = await mkOrder(id2, [line()], { discount: 180 });
    await pay(big);
    assert.equal(Number((await commissionOf(big.id))[0].amount), 20, 'capped at F - Da = 20');

    const [cp] = await pool.execute(
      `INSERT INTO coupons (code, discountType, discountValue, minPurchase, maxUses, isActive, vendorId) VALUES (?, 'fixed', 100, 0, 5, 1, ?)`, [`REFSELL${TS}`, fx.vendor]
    );
    fx.coupons.push(cp.insertId);
    const { id: id3 } = await signUpReferred('ama6');
    const sellerCoupon = await mkOrder(id3, [line()], { discount: 100, couponId: cp.insertId });
    await pay(sellerCoupon);
    const [[a3]] = await pool.execute(`SELECT platformFee, payoutAmount FROM escrow_allocations WHERE orderId = ?`, [sellerCoupon.id]);
    assert.deepEqual([Number(a3.platformFee), Number(a3.payoutAmount)], [200, 700]);
    assert.equal(Number((await commissionOf(sellerCoupon.id))[0].amount), 40);
  });

  test('7 + 8 + 9: duplicate webhooks, repeated verification and 10 concurrent workers create exactly one commission; promotion credits once', async () => {
    const { id } = await signUpReferred('ama7');
    const order = await mkOrder(id, [line()]);
    await pay(order);
    await pay(order); // duplicate webhook / verify
    await Promise.all(Array.from({ length: 10 }, () => ref.recordReferralForOrder(order.id)));
    assert.equal((await commissionOf(order.id)).length, 1);
    const before = await wallet(fx.kwame);
    await pool.execute(`UPDATE orders SET orderStatus = 'delivered', deliveredAt = NOW() WHERE id = ?`, [order.id]);
    await pool.execute(`UPDATE escrow_allocations SET status = 'released' WHERE orderId = ?`, [order.id]);
    await Promise.all(Array.from({ length: 5 }, () => ref.promoteReferralCommissions({ orderIds: [order.id] })));
    const after = await wallet(fx.kwame);
    assert.equal(cents(after.balance) - cents(before.balance), 4000, 'credited GH₵40 exactly once');
    assert.equal((await commissionOf(order.id))[0].status, 'available');
  });

  test('availability waits for a completed order (escrow released), not payment', async () => {
    const { id } = await signUpReferred('ama8');
    const order = await mkOrder(id, [line()]);
    await pay(order);
    assert.equal(await ref.promoteReferralCommissions({ orderIds: [order.id] }), 0, 'held escrow: still pending');
    assert.equal(await complete(order.id), 1);
  });

  test('13: full refund after availability reverses once (wallet debited GH₵40, repeated refund paths add nothing)', async () => {
    const { id } = await signUpReferred('ama9');
    const order = await mkOrder(id, [line()]);
    await pay(order);
    await complete(order.id);
    const w0 = await wallet(fx.kwame);
    await pool.execute(`UPDATE escrow_allocations SET status = 'failed', reason = 'voided (order cancelled/refunded)' WHERE orderId = ?`, [order.id]);
    await pool.execute(`UPDATE orders SET paymentStatus = 'refunded', orderStatus = 'cancelled' WHERE id = ?`, [order.id]);
    await escrow.reversePlatformRevenueForRefund(order.id, 'cancel');
    await escrow.reversePlatformRevenueForRefund(order.id, 'cancel');
    await ref.adjustReferralForRefund(order.id);
    await ref.reconcileReferralRefunds();
    const [c] = await commissionOf(order.id);
    assert.deepEqual([c.status, Number(c.currentAmount), Number(c.amount)], ['reversed', 0, 40], 'original amount kept for audit');
    assert.equal(cents(w0.balance) - cents((await wallet(fx.kwame)).balance), 4000);
    const [[n]] = await pool.execute(`SELECT COUNT(*) n FROM referral_ledger WHERE commissionId = ? AND type = 'reverse'`, [c.id]);
    assert.equal(Number(n.n), 1);
  });

  test('13b: refund after the commission was WITHDRAWN: reversed once into wallet debt, payout untouched, debt blocks withdrawal and is offset by the next earning', async () => {
    // Own referrer so the shared fixture wallet is not disturbed.
    const amb = await mkUser('amb13b');
    const code = await ref.ensureReferralCode(amb);
    await pool.execute(`UPDATE users SET referralRecipientCode = 'RCP_TEST_13B' WHERE id = ?`, [amb]);
    const { id: buyer } = await signUpReferred('ama13b', { visitToken: ref.signVisitToken(code) });
    const order = await mkOrder(buyer, [line()]);
    await pay(order);
    await complete(order.id);
    assert.equal(cents((await wallet(amb)).balance), 4000, 'commission available');

    paystack.initiateTransfer = async (amount, recipient, reason, reference) =>
      ({ data: { status: 'success', amount: Math.round(amount * 100), currency: 'GHS', reference, transfer_code: 'TRF_13B' } });
    const wd = await payout.requestReferralWithdrawal({ userId: amb, amountMinor: 4000, requestKey: `rk13b-${TS}` });
    assert.equal(wd.status, 202);
    let w = await wallet(amb);
    assert.deepEqual([cents(w.balance), cents(w.reserved), cents(w.totalWithdrawn)], [0, 0, 4000], 'paid out');

    // Full refund, applied by every refund path that can reach it.
    await pool.execute(`UPDATE escrow_allocations SET status = 'failed', reason = 'voided (order cancelled/refunded)' WHERE orderId = ?`, [order.id]);
    await pool.execute(`UPDATE orders SET paymentStatus = 'refunded', orderStatus = 'cancelled' WHERE id = ?`, [order.id]);
    await ref.adjustReferralForRefund(order.id);
    await ref.adjustReferralForRefund(order.id);
    await ref.reconcileReferralRefunds();

    const [c] = await commissionOf(order.id);
    assert.deepEqual([c.status, Number(c.currentAmount)], ['reversed', 0]);
    w = await wallet(amb);
    assert.deepEqual([cents(w.balance), cents(w.totalWithdrawn)], [-4000, 4000], 'debt recorded; the completed payout is not rewritten');
    const [[rev]] = await pool.execute(`SELECT COUNT(*) n FROM referral_ledger WHERE commissionId = ? AND type = 'reverse'`, [c.id]);
    assert.equal(Number(rev.n), 1, 'reversed exactly once');
    const [[wrow]] = await pool.execute(`SELECT status FROM referral_withdrawals WHERE userId = ?`, [amb]);
    assert.equal(wrow.status, 'paid');

    const blocked = await payout.requestReferralWithdrawal({ userId: amb, amountMinor: 1000, requestKey: `rk13b2-${TS}` });
    assert.equal(blocked.status, 400, 'no withdrawal while in debt');

    // The next qualifying earning pays the debt off first.
    const { id: buyer2 } = await signUpReferred('ama13c', { visitToken: ref.signVisitToken(code) });
    const order2 = await mkOrder(buyer2, [line()]);
    await pay(order2);
    await complete(order2.id);
    assert.equal(cents((await wallet(amb)).balance), 0, 'debt offset by the next commission');
  });

  test('14: partial refund of one vendor reduces the commission proportionally (GH₵40 -> GH₵24), once', async () => {
    const { id } = await signUpReferred('ama10');
    // vendor A: 600 (3 x 200), vendor B: 400 (2 x 200); 4% -> 24 + 16
    const order = await mkOrder(id, [line(3, fx.product, fx.vendor, 200), line(2, fx.product2, fx.vendor2, 200)]);
    await pay(order);
    assert.equal(Number((await commissionOf(order.id))[0].amount), 40);
    await escrow.voidVendorEscrow(order.id, fx.vendor2);
    await escrow.voidVendorEscrow(order.id, fx.vendor2);
    const [c] = await commissionOf(order.id);
    assert.deepEqual([c.status, Number(c.currentAmount)], ['pending', 24]);
  });

  test('refund while pending cancels without touching the wallet', async () => {
    const { id } = await signUpReferred('ama11');
    const order = await mkOrder(id, [line()]);
    await pay(order);
    const w0 = await wallet(fx.kwame);
    await escrow.voidEscrowForOrder(order.id);
    await pool.execute(`UPDATE orders SET paymentStatus = 'refunded', orderStatus = 'cancelled' WHERE id = ?`, [order.id]);
    await escrow.reversePlatformRevenueForRefund(order.id, 'cancel');
    assert.equal((await commissionOf(order.id))[0].status, 'cancelled');
    assert.deepEqual(await wallet(fx.kwame), w0);
  });

  test('window: an order after the 30-day window earns nothing; a 1-year setting includes it', async () => {
    const { id } = await signUpReferred('ama12');
    await pool.execute(`UPDATE users SET referredAt = DATE_SUB(NOW(), INTERVAL 40 DAY) WHERE id = ?`, [id]);
    const late = await mkOrder(id, [line()]);
    await pay(late);
    assert.equal((await commissionOf(late.id)).length, 0);
    await pool.execute(`UPDATE settings SET settingValue = '365' WHERE settingKey = 'referral.windowDays'`);
    try {
      const later = await mkOrder(id, [line()]);
      await pay(later);
      assert.equal((await commissionOf(later.id)).length, 1);
    } finally {
      await pool.execute(`UPDATE settings SET settingValue = '30' WHERE settingKey = 'referral.windowDays'`);
    }
  });

  test('abuse signals park the commission under_review; admin approve/reject is audited and needs a note', async () => {
    const { id } = await signUpReferred('ama13', { phone: '+233 20 111 2233' }); // same phone as Kwame
    const order = await mkOrder(id, [line()]);
    await pay(order);
    const [c] = await commissionOf(order.id);
    assert.equal(c.status, 'under_review');
    assert.ok(JSON.parse(JSON.stringify(c.reviewReasons)).includes('same_phone'));
    assert.equal(await ref.promoteReferralCommissions({ orderIds: [order.id] }), 0);
    const adminReq = (body, params) => ({ body, params, user: { id: fx.admin, role: 'admin', email: 'a@example.com' }, ip: '127.0.0.1', get: () => 't' });
    const r1 = mockRes();
    await refCtl.adminReviewCommission(adminReq({ decision: 'approve', note: '' }, { id: String(c.id) }), r1);
    assert.equal(r1.statusCode, 400);
    const r2 = mockRes();
    await refCtl.adminReviewCommission(adminReq({ decision: 'reject', note: 'Same household phone, self-referral' }, { id: String(c.id) }), r2);
    assert.equal(r2.statusCode, 200);
    assert.equal((await commissionOf(order.id))[0].status, 'cancelled');
    const [[audit]] = await pool.execute(`SELECT action FROM admin_audit_log WHERE actorId = ? AND entityId = ? ORDER BY id DESC LIMIT 1`, [fx.admin, String(c.id)]);
    assert.equal(audit.action, 'referral.commission.reject');
  });

  test('same payment card as the referrer is a review signal', async () => {
    const own = await mkOrder(fx.kwame, [line()]);
    await pay(own, { authorization: { signature: `SHARED-${TS}` }, channel: 'card' });
    const { id } = await signUpReferred('ama14');
    const order = await mkOrder(id, [line()]);
    await pay(order, { authorization: { signature: `SHARED-${TS}` }, channel: 'card' });
    const [c] = await commissionOf(order.id);
    assert.equal(c.status, 'under_review');
    assert.ok(JSON.parse(JSON.stringify(c.reviewReasons)).includes('same_payment_instrument'));
  });

  test('11: rates are server-validated (<= platform commission) and admin-only; settings changes are audited', async () => {
    const adminReq = (body, params = {}) => ({ body, params, user: { id: fx.admin, role: 'admin', email: 'a@example.com' }, ip: '127.0.0.1', get: () => 't' });
    for (const body of [{ standardRate: 0.2 }, { standardRate: '0.04abc' }, { windowDays: 90 }, { enabled: 'yes' }]) {
      const r = mockRes();
      await refCtl.adminUpdateReferralSettings(adminReq(body), r);
      assert.equal(r.statusCode, 400, JSON.stringify(body));
    }
    const sup = mockRes();
    await refCtl.adminUpdateAmbassador(adminReq({ tier: 'super', rate: 0.2 }, { userId: String(fx.kwame) }), sup);
    assert.equal(sup.statusCode, 400, 'super rate above the 10% global platform commission refused');
    const okRes = mockRes();
    await refCtl.adminUpdateAmbassador(adminReq({ tier: 'super', rate: 0.06 }, { userId: String(fx.kwame) }), okRes);
    assert.equal(okRes.statusCode, 200);
    await pool.execute(`UPDATE users SET ambassadorTier = 'standard', ambassadorRate = NULL WHERE id = ?`, [fx.kwame]);

    // Over HTTP: a signed-in customer cannot reach the admin router.
    const express = (await import('express')).default;
    const cookieParser = (await import('cookie-parser')).default;
    const { adminReferralRouter } = await import('../routes/referralRoutes.js');
    const { errorHandeler } = await import('../middleware/errorMiddleware.js');
    const { signUserToken } = await import('../utils/generateToken.js');
    const { startServer } = await import('./helpers/httpHarness.js');
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/admin/referrals', adminReferralRouter);
    app.use(errorHandeler);
    const server = await startServer(app);
    try {
      const [[u]] = await pool.execute(`SELECT id, tokenVersion FROM users WHERE id = ?`, [fx.kwame]);
      const cookie = `jwt=${signUserToken(u)}`;
      const put = await fetch(`${server.baseUrl}/api/admin/referrals/settings`, {
        method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ standardRate: 0.05 }),
      });
      assert.equal(put.status, 403);
      const anon = await fetch(`${server.baseUrl}/api/admin/referrals/ambassadors/${fx.kwame}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tier: 'super', rate: 0.09 }),
      });
      assert.equal(anon.status, 401);
    } finally {
      await server.close();
    }
    assert.equal((await ref.getReferralSettings()).standardRate, 0.04, 'unchanged');
  });

  test('19: an ambassador sees only their own commissions, with the buyer masked', async () => {
    const other = await mkUser('otheramb');
    const res = mockRes();
    await refCtl.getMyReferrals({ user: { id: other } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.commissions.length, 0);
    const mine = mockRes();
    await refCtl.getMyReferrals({ user: { id: fx.kwame } }, mine);
    assert.ok(mine.body.commissions.length > 0);
    for (const c of mine.body.commissions) {
      assert.match(c.customer, /^[A-Z]\*\*\*$|^Customer$/);
      assert.match(c.order, /^•••/);
      assert.equal(JSON.stringify(c).includes('@'), false, 'no email');
    }
  });

  test('18 + 20: withdrawal is "paid" only on matching Paystack evidence; timeout keeps funds reserved; reconciler settles once', async () => {
    await pool.execute(`UPDATE users SET referralRecipientCode = 'RCP_TEST_KWAME' WHERE id = ?`, [fx.kwame]);
    const w0 = await wallet(fx.kwame);
    assert.ok(w0.balance >= 30, `fixture balance ${w0.balance}`);

    // Initiate times out (no provider answer): reserved, not paid, not returned.
    paystack.initiateTransfer = async () => { throw Object.assign(new Error('timeout'), { hadProviderResponse: false }); };
    const r = await payout.requestReferralWithdrawal({ userId: fx.kwame, amountMinor: 1500, requestKey: `rk-${TS}-1` });
    assert.equal(r.status, 202);
    const again = await payout.requestReferralWithdrawal({ userId: fx.kwame, amountMinor: 1500, requestKey: `rk-${TS}-1` });
    assert.equal(again.body.message, 'Withdrawal already submitted', 'double-click returns the same withdrawal');
    let w = await wallet(fx.kwame);
    assert.deepEqual([cents(w0.balance) - cents(w.balance), cents(w.reserved) - cents(w0.reserved)], [1500, 1500]);
    const [[row]] = await pool.execute(`SELECT * FROM referral_withdrawals WHERE userId = ? AND idempotencyKey = ?`, [fx.kwame, `rk-${TS}-1`]);
    assert.equal(row.status, 'processing');

    // Webhook with the wrong amount: parked for review, never paid.
    assert.equal(await payout.settleReferralWithdrawal(row.reference, 'success', { amountMinor: 999, currency: 'GHS' }), 'review');
    assert.equal((await pool.execute(`SELECT status FROM referral_withdrawals WHERE id = ?`, [row.id]))[0][0].status, 'reconciliation_required');

    // A second withdrawal settled by the reconciler from Paystack evidence, twice -> once.
    const r2 = await payout.requestReferralWithdrawal({ userId: fx.kwame, amountMinor: 1000, requestKey: `rk-${TS}-2` });
    assert.equal(r2.status, 202);
    const [[row2]] = await pool.execute(`SELECT * FROM referral_withdrawals WHERE userId = ? AND idempotencyKey = ?`, [fx.kwame, `rk-${TS}-2`]);
    hooks.verifyTransfer = async () => ({ data: { data: { status: 'success', amount: 1000, currency: 'GHS' } } });
    await payout.reconcileReferralWithdrawals({ ids: [row2.id], minAgeMinutes: 0 });
    await payout.reconcileReferralWithdrawals({ ids: [row2.id], minAgeMinutes: 0 });
    assert.equal(await payout.settleReferralWithdrawal(row2.reference, 'success', { amountMinor: 1000, currency: 'GHS' }), 'already');
    w = await wallet(fx.kwame);
    assert.equal(cents(w.totalWithdrawn) - cents(w0.totalWithdrawn), 1000, 'paid exactly once');

    // A definite provider rejection returns the money immediately.
    paystack.initiateTransfer = async () => { throw Object.assign(new Error('invalid recipient'), { hadProviderResponse: true, providerStatus: 400 }); };
    const before3 = await wallet(fx.kwame);
    const r3 = await payout.requestReferralWithdrawal({ userId: fx.kwame, amountMinor: 1000, requestKey: `rk-${TS}-3` });
    assert.equal(r3.status, 502);
    assert.equal(cents((await wallet(fx.kwame)).balance), cents(before3.balance), 'balance restored');
  });

  test('concurrent withdrawals on one wallet: one reserves, the rest are refused cleanly (no deadlock 500)', async () => {
    // The wallet row was created with INSERT IGNORE inside the transaction:
    // on an existing row that takes a shared lock the FOR UPDATE must upgrade,
    // so parallel requests deadlocked and the losers threw (HTTP 500).
    const u = await mkUser('wdrace');
    await pool.execute(`UPDATE users SET referralRecipientCode = 'RCP_TEST_RACE' WHERE id = ?`, [u]);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await ref.postReferralLedger(conn, { userId: u, type: 'earn', balance: 50, earned: 50, dedupeKey: `test.seed:${u}` });
      await conn.commit();
    } finally { conn.release(); }
    paystack.initiateTransfer = async () => { throw Object.assign(new Error('timeout'), { hadProviderResponse: false }); };
    const settled = await Promise.allSettled([1, 2, 3, 4, 5, 6].map((i) =>
      payout.requestReferralWithdrawal({ userId: u, amountMinor: 4000, requestKey: `race-${TS}-${i}` })));
    const thrown = settled.filter((s) => s.status === 'rejected').map((s) => /** @type {any} */ (s).reason?.code || String(/** @type {any} */ (s).reason));
    assert.deepEqual(thrown, [], 'no request may fail with a database error');
    const statuses = settled.map((s) => /** @type {any} */ (s).value.status).sort();
    assert.deepEqual(statuses, [202, 400, 400, 400, 400, 400]);
    const w = await wallet(u);
    assert.deepEqual([cents(w.balance), cents(w.reserved)], [1000, 4000]);
  });

  test('pay with earnings: whole order only; final (cancel refused); earns no referral for the buyer\'s referrer', async () => {
    // Give Ama-15 (referred by Kwame) earnings of her own via a referral she made.
    const { id: buyer } = await signUpReferred('ama15');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await ref.postReferralLedger(conn, { userId: buyer, type: 'earn', balance: 500, earned: 500, dedupeKey: `test.seed:${buyer}` });
      await conn.commit();
    } finally { conn.release(); }
    const tooBig = await mkOrder(buyer, [line()]); // 1000 + 150 tax
    await pool.execute(`UPDATE orders SET paymentReference = NULL WHERE id = ?`, [tooBig.id]);
    const r1 = await payout.payOrderWithReferralCredit({ userId: buyer, orderId: tooBig.id });
    assert.equal(r1.status, 400, 'earnings must cover the full total');

    const small = await mkOrder(buyer, [line(1, fx.product, fx.vendor, 300)]); // 300 + 150 = 450
    await pool.execute(`UPDATE orders SET paymentReference = NULL WHERE id = ?`, [small.id]);
    const notMine = await payout.payOrderWithReferralCredit({ userId: fx.kwame, orderId: small.id });
    assert.equal(notMine.status, 404);
    const r2 = await payout.payOrderWithReferralCredit({ userId: buyer, orderId: small.id });
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    const r3 = await payout.payOrderWithReferralCredit({ userId: buyer, orderId: small.id });
    assert.equal(r3.status, 409, 'cannot pay twice');
    assert.equal(cents((await wallet(buyer)).balance), 5000, '500 - 450');
    const [[o]] = await pool.execute(`SELECT paymentStatus, paymentMethod FROM orders WHERE id = ?`, [small.id]);
    assert.deepEqual([o.paymentStatus, o.paymentMethod], ['paid', 'referral_credit']);
    const [[held]] = await pool.execute(`SELECT status FROM escrow_allocations WHERE orderId = ?`, [small.id]);
    assert.equal(held.status, 'held', 'seller is paid through normal escrow');
    assert.equal((await commissionOf(small.id)).length, 0, 'no referral on an earnings-paid order');

    const { cancelOrder } = await import('../controllers/orderController.js');
    const res = mockRes();
    await cancelOrder({ params: { id: String(small.id) }, user: { id: fx.admin, role: 'admin' }, body: {} }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'REFERRAL_CREDIT_FINAL');
  });

  test("seller as ambassador: a seller who brings a buyer earns the reward, even on the seller's own product, and the sale payout is unchanged", async () => {
    // Owner rule (2026-10-12): sellers drag their customers to the platform and are rewarded for it.
    const sellerCode = await ref.ensureReferralCode(fx.vendor);
    const { id: buyer, result } = await signUpReferred('sellerbuyer', { visitToken: ref.signVisitToken(sellerCode) });
    assert.equal(result.bound, true);
    assert.equal(result.referrerId, fx.vendor);
    const order = await mkOrder(buyer, [line()]); // the seller's own GH₵1,000 product
    await pay(order);
    const [c] = await commissionOf(order.id);
    assert.deepEqual([c.referrerId, c.status, Number(c.amount)], [fx.vendor, 'pending', 40]);
    const [[a]] = await pool.execute(`SELECT platformFee, payoutAmount FROM escrow_allocations WHERE orderId = ?`, [order.id]);
    assert.deepEqual([Number(a.platformFee), Number(a.payoutAmount)], [200, 800], 'sale payout untouched; referral comes from the platform 200');
    const before = await wallet(fx.vendor);
    await complete(order.id);
    assert.equal(cents((await wallet(fx.vendor)).balance) - cents(before.balance), 4000, 'seller referral wallet +40');
  });

  test('20: a paid order whose referral step never ran is picked up by the safety-net job (idempotent)', async () => {
    const { id } = await signUpReferred('ama16');
    const order = await mkOrder(id, [line()]);
    // Paid flip without the side effects (simulates a crash right after the flip).
    await pool.execute(
      `UPDATE orders SET paymentStatus = 'paid', orderStatus = 'processing', paymentSideEffects = JSON_OBJECT(), updated_at = DATE_SUB(NOW(), INTERVAL 20 MINUTE) WHERE id = ?`, [order.id]
    );
    assert.equal((await commissionOf(order.id)).length, 0);
    await ref.recordMissingReferralCommissions();
    await ref.recordMissingReferralCommissions();
    const rows = await commissionOf(order.id);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].amount), 40);
  });
});
