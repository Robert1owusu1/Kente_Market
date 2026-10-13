// F-2 / F-3 regression suite: cancellation, refunds, escrow void/clawback,
// automatic release, withdrawal guards, admin-transition guards, races.
//
// DISPOSABLE DATABASE ONLY. These tests MUST NOT run against the shared
// TiDB Cloud database. They used to hard-wire 127.0.0.1:3307 as root, which
// made them fail in CI (MySQL on 3306) and in CI's DB-less run alike; they
// now use the configured database, refuse anything that is not on this
// machine (tests/helpers/testDbGuard.mjs enforces the same for the whole
// suite), and skip — like every other DB suite — when no database answers.
import { describe, test, before, after } from 'node:test';
import { assertDisposableDb } from './helpers/disposableDb.mjs';
import assert from 'node:assert/strict';

let dbAvailable = true;
{
  const probe = (await import('../config/db.js')).default;
  try {
    await probe.query('SELECT 1');
  } catch {
    dbAvailable = false;
  }
}

/** @type {any} */ let pool;
/** @type {any} */ let cancelOrder, updateOrder, updateOrderToPaid;
/** @type {any} */ let releaseAllocation, releaseEscrowForOrder, releaseVendorEscrow;
/** @type {any} */ let autoReleaseExpiredEscrows, autoReleaseExpiredVendorEscrows;
/** @type {any} */ let voidEscrowForOrder, cancelEscrowForOrder, assertOrderReleasable;
/** @type {any} */ let payoutAllocation, getAvailableAllocationsForVendor, creditVendorBalance;
/** @type {any} */ let paystackServices;

const TS = Date.now();
const tag = (s) => `f2f3-${s}-${TS}`;
const state = { users: [], orders: [], allocs: [] };
let seq = 0;

const mockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};
const adminReq = (params = {}, body = {}) => ({
  params, body,
  user: { id: 1, role: 'admin', email: 'admin@test.local' },
  headers: {}, ip: '127.0.0.1',
});

async function mkUser(role, name) {
  const email = `${tag(name)}@test.local`;
  const [r] = await pool.execute(
    `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
     VALUES ('F2F3', ?, ?, 'x', ?, 1, 1)`,
    [name, email, role]
  );
  state.users.push(r.insertId);
  return r.insertId;
}

async function mkVendor(name = 'vendor') {
  const userId = await mkUser('vendor', name);
  await pool.execute(
    `INSERT INTO vendors (userId, businessName, status, recipientCode) VALUES (?, ?, 'approved', ?)`,
    [userId, tag(name), `RCP_${tag(name)}`.slice(0, 30)]
  );
  return userId;
}

async function mkProduct(vendorId, stock = 10, price = 100) {
  const [r] = await pool.execute(
    `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
     VALUES (?, 't.png', ?, 'test', ?, ?, 0, 'approved')`,
    [tag('prod'), price, stock, vendorId]
  );
  return r.insertId;
}

async function mkOrder(userId, opts = {}) {
  seq += 1;
  const {
    paymentStatus = 'pending', orderStatus = 'pending', escrowStatus = 'none',
    totalAmount = 100, paymentReference = null, items = null,
  } = opts;
  const orderItems = items || [{ product: 0, name: 'x', qty: 1, price: totalAmount, vendorId: null }];
  const [r] = await pool.execute(
    `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
       paymentMethod, paymentStatus, orderStatus, shippingCost, tax, discount, notes,
       paymentReference, couponId, escrowStatus)
     VALUES (?, ?, ?, ?, '{}', '{}', 'card', ?, ?, 0, 0, 0, NULL, ?, NULL, ?)`,
    [userId, `F2F3-${TS}-${seq}`, JSON.stringify(orderItems), totalAmount,
     paymentStatus, orderStatus, paymentReference, escrowStatus]
  );
  state.orders.push(r.insertId);
  return r.insertId;
}

async function mkAlloc(orderId, vendorId, opts = {}) {
  const { status = 'pending', amount = 90, payoutAmount = 81 } = opts;
  const [r] = await pool.execute(
    `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status)
     VALUES (?, ?, ?, 0.1, 9, ?, ?)`,
    [orderId, vendorId, amount, payoutAmount, status]
  );
  state.allocs.push(r.insertId);
  return r.insertId;
}

const allocRow = async (id) => (await pool.execute(`SELECT * FROM escrow_allocations WHERE id = ?`, [id]))[0][0];
const orderRow = async (id) => (await pool.execute(`SELECT * FROM orders WHERE id = ?`, [id]))[0][0];
const count = async (sql, params) => (await pool.execute(`SELECT COUNT(*) AS c FROM (${sql}) t`, params))[0][0].c;

let paystackRefundCalls = 0;
let origRefund;

before(async () => {
  if (!dbAvailable) return;
  const db = await import('../config/db.js');
  pool = db.default;
  // SAFETY INTERLOCK: only a database on this machine (disposable by policy).
  await assertDisposableDb(pool);

  const escrow = await import('../Services/escrowService.js');
  ({ releaseAllocation, releaseEscrowForOrder, releaseVendorEscrow,
     autoReleaseExpiredEscrows, autoReleaseExpiredVendorEscrows,
     voidEscrowForOrder, cancelEscrowForOrder, assertOrderReleasable,
     payoutAllocation, getAvailableAllocationsForVendor } = escrow);
  ({ creditVendorBalance } = await import('../Services/walletService.js'));
  const oc = await import('../controllers/orderController.js');
  ({ cancelOrder, updateOrder, updateOrderToPaid } = oc);
  ({ default: paystackServices } = await import('../Services/paystackservices.js'));

  // No real funds, no network: stub the Paystack refund call.
  origRefund = paystackServices.refundTransaction;
  paystackServices.refundTransaction = async () => {
    paystackRefundCalls += 1;
    return { status: true, message: 'mocked refund', data: {} };
  };
});

after(async () => {
  if (!dbAvailable) {
    await (await import('../config/db.js')).default.end().catch(() => {});
    return;
  }
  paystackServices.refundTransaction = origRefund;
  // Disposable-DB teardown (reverse FK order).
  if (state.allocs.length) await pool.execute(`DELETE FROM escrow_allocations WHERE id IN (${state.allocs.map(() => '?').join(',')})`, state.allocs).catch(() => {});
  await pool.execute(`DELETE FROM payout_attempts WHERE vendorId IN (SELECT userId FROM users WHERE email LIKE 'f2f3-%')`).catch(() => {});
  await pool.execute(`DELETE FROM wallet_transactions WHERE vendorId IN (SELECT id FROM users WHERE email LIKE 'f2f3-%')`).catch(() => {});
  await pool.execute(`DELETE FROM financial_events WHERE orderId IN (SELECT id FROM orders WHERE orderNumber LIKE 'F2F3-%')`).catch(() => {});
  await pool.execute(`DELETE FROM vendor_order_fulfillment WHERE orderId IN (SELECT id FROM orders WHERE orderNumber LIKE 'F2F3-%')`).catch(() => {});
  if (state.orders.length) await pool.execute(`DELETE FROM orders WHERE id IN (${state.orders.map(() => '?').join(',')})`, state.orders).catch(() => {});
  await pool.execute(`DELETE FROM product WHERE title LIKE 'f2f3-%'`).catch(() => {});
  await pool.execute(`DELETE FROM vendors WHERE businessName LIKE 'f2f3-%'`).catch(() => {});
  await pool.execute(`DELETE FROM vendor_wallets WHERE vendorId IN (SELECT id FROM users WHERE email LIKE 'f2f3-%')`).catch(() => {});
  await pool.execute(`DELETE FROM users WHERE email LIKE 'f2f3-%'`).catch(() => {});
  await pool.end();
});

describe('F-2: cancellation escrow lifecycle', { skip: !dbAvailable }, () => {
  test('1. cancellation with held escrow voids allocations, no withdrawal', async () => {
    const vendor = await mkVendor('v-held');
    const buyer = await mkUser('customer', 'b-held');
    const prodId = await mkProduct(vendor, 10, 100);
    // Simulate the payment-time decrement (fixtures insert orders directly).
    await pool.execute(`UPDATE product SET stock = stock - 1 WHERE id = ?`, [prodId]);
    const orderId = await mkOrder(buyer, { paymentStatus: 'paid', orderStatus: 'processing', escrowStatus: 'held', totalAmount: 100, paymentReference: tag('pay-held'), items: [{ product: prodId, name: 'x', qty: 1, price: 100, vendorId: vendor }] });
    const allocId = await mkAlloc(orderId, vendor, { status: 'held' });

    paystackRefundCalls = 0;
    const res = mockRes();
    await cancelOrder(adminReq({ id: orderId }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    const alloc = await allocRow(allocId);
    assert.equal(alloc.status, 'failed', 'held allocation must be voided');
    const ord = await orderRow(orderId);
    assert.equal(ord.orderStatus, 'cancelled');
    assert.equal(ord.paymentStatus, 'refunded');
    const [[prod]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [prodId]);
    assert.equal(Number(prod.stock), 10, 'paid-order stock must be restored on cancel');
    // No wallet credit was ever created for this allocation.
    assert.equal(await count(`SELECT id FROM wallet_transactions WHERE allocationId = ${allocId}`), 0);
    // Refund journal exactly once.
    assert.equal(await count(`SELECT id FROM financial_events WHERE dedupeKey = 'refund:${orderId}'`), 1);
    assert.equal(paystackRefundCalls, 1, 'exactly one provider refund');
    // Nothing withdrawable remains.
    assert.equal((await getAvailableAllocationsForVendor(vendor)).length, 0);
  });

  test('2. cancellation with available escrow claws back the wallet', async () => {
    const vendor = await mkVendor('v-avail');
    const buyer = await mkUser('customer', 'b-avail');
    const orderId = await mkOrder(buyer, { paymentStatus: 'paid', orderStatus: 'processing', escrowStatus: 'held', totalAmount: 100, paymentReference: tag('pay-avail') });
    const allocId = await mkAlloc(orderId, vendor, { status: 'held', payoutAmount: 81 });
    // Release for real: available + wallet credit + journal.
    const rel = await releaseAllocation((await allocRow(allocId)));
    assert.equal(rel.status, 'available');
    const [[w0]] = await pool.execute(`SELECT available_balance FROM vendor_wallets WHERE vendorId = ?`, [vendor]);

    paystackRefundCalls = 0;
    const res = mockRes();
    await cancelOrder(adminReq({ id: orderId }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    const alloc = await allocRow(allocId);
    assert.equal(alloc.status, 'failed', 'available allocation must be clawed back, not left withdrawable');
    const [[w1]] = await pool.execute(`SELECT available_balance FROM vendor_wallets WHERE vendorId = ?`, [vendor]);
    assert.equal(Number(w1.available_balance), Number(w0.available_balance) - 81, 'wallet debited by the clawback');
    assert.equal(await count(`SELECT id FROM wallet_transactions WHERE type='clawback' AND reference = 'clawback:${allocId}'`), 1);
    assert.equal(await count(`SELECT id FROM financial_events WHERE dedupeKey = 'escrow.clawback:${allocId}'`), 1);
    assert.equal(await count(`SELECT id FROM financial_events WHERE dedupeKey = 'refund:${orderId}'`), 1);
    assert.equal((await getAvailableAllocationsForVendor(vendor)).length, 0);
  });

  test('3. cancellation with no escrow succeeds as a no-op void', async () => {
    const buyer = await mkUser('customer', 'b-none');
    const orderId = await mkOrder(buyer, { paymentStatus: 'pending', orderStatus: 'pending', escrowStatus: 'none' });
    const res = mockRes();
    await cancelOrder(adminReq({ id: orderId }), res);
    assert.equal(res.statusCode, 200);
    const ord = await orderRow(orderId);
    assert.equal(ord.orderStatus, 'cancelled');
    assert.equal(ord.paymentStatus, 'pending', 'unpaid cancellation must not fabricate a refund');
  });

  test('4. refund after allocation is journaled once; repeat cancel cannot re-refund', async () => {
    const vendor = await mkVendor('v-repeat');
    const buyer = await mkUser('customer', 'b-repeat');
    const orderId = await mkOrder(buyer, { paymentStatus: 'paid', orderStatus: 'processing', escrowStatus: 'held', totalAmount: 120, paymentReference: tag('pay-repeat') });
    await mkAlloc(orderId, vendor, { status: 'held' });

    paystackRefundCalls = 0;
    const r1 = mockRes();
    await cancelOrder(adminReq({ id: orderId }), r1);
    assert.equal(r1.statusCode, 200);
    const r2 = mockRes();
    await cancelOrder(adminReq({ id: orderId }), r2);
    assert.notEqual(r2.statusCode, 200, 'second cancel must be rejected');
    assert.equal(paystackRefundCalls, 1, 'provider refunded exactly once');
    assert.equal(await count(`SELECT id FROM financial_events WHERE dedupeKey = 'refund:${orderId}'`), 1);
  });

  test('15. repeated void operations are idempotent', async () => {
    const vendor = await mkVendor('v-void3');
    const buyer = await mkUser('customer', 'b-void3');
    const orderId = await mkOrder(buyer, { paymentStatus: 'paid', orderStatus: 'processing', escrowStatus: 'held', totalAmount: 100, paymentReference: tag('pay-void3') });
    const allocId = await mkAlloc(orderId, vendor, { status: 'held', payoutAmount: 81 });
    await releaseAllocation(await allocRow(allocId));

    await voidEscrowForOrder(orderId);
    await voidEscrowForOrder(orderId);
    await cancelEscrowForOrder(orderId);
    await voidEscrowForOrder(orderId);

    const alloc = await allocRow(allocId);
    assert.equal(alloc.status, 'failed');
    assert.equal(await count(`SELECT id FROM wallet_transactions WHERE type='clawback' AND reference = 'clawback:${allocId}'`), 1, 'single clawback ledger row');
    assert.equal(await count(`SELECT id FROM financial_events WHERE dedupeKey = 'escrow.clawback:${allocId}'`), 1, 'single clawback journal row');
  });
});

describe('F-3: automatic release eligibility', { skip: !dbAvailable }, () => {
  async function eligibleSetup(sfx) {
    const vendor = await mkVendor(`v-auto-${sfx}`);
    const buyer = await mkUser('customer', `b-auto-${sfx}`);
    const orderId = await mkOrder(buyer, { paymentStatus: 'paid', orderStatus: 'delivered', escrowStatus: 'held', totalAmount: 100, paymentReference: tag(`pay-${sfx}`) });
    const allocId = await mkAlloc(orderId, vendor, { status: 'held', payoutAmount: 81 });
    await pool.execute(`UPDATE orders SET escrowReleaseDeadline = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?`, [orderId]);
    return { vendor, buyer, orderId, allocId };
  }

  test('5. automatic release pays an eligible order exactly once', async () => {
    const { orderId, allocId } = await eligibleSetup('ok');
    await autoReleaseExpiredEscrows();
    const alloc = await allocRow(allocId);
    assert.equal(alloc.status, 'available');
    assert.equal(await count(`SELECT id FROM wallet_transactions WHERE type='credit' AND allocationId = ${allocId}`), 1);
    const ord = await orderRow(orderId);
    assert.equal(ord.escrowStatus, 'released');
  });

  test('10. duplicate automatic-release execution cannot double-pay', async () => {
    const { allocId } = await eligibleSetup('dup');
    await autoReleaseExpiredEscrows();
    await autoReleaseExpiredEscrows();
    // Second pass released nothing: still exactly one credit + one journal.
    assert.equal((await allocRow(allocId)).status, 'available');
    assert.equal(await count(`SELECT id FROM wallet_transactions WHERE type='credit' AND allocationId = ${allocId}`), 1);
    assert.equal(await count(`SELECT id FROM financial_events WHERE dedupeKey = 'escrow.release:${allocId}'`), 1);
  });

  test('6. automatic release skips a cancelled order (guard-removal proof)', async () => {
    const { orderId, allocId } = await eligibleSetup('cancelled');
    await pool.execute(`UPDATE orders SET orderStatus = 'cancelled' WHERE id = ?`, [orderId]);
    await autoReleaseExpiredEscrows();
    const alloc = await allocRow(allocId);
    assert.equal(alloc.status, 'held', 'held allocation must NOT release for a cancelled order');
    assert.equal(await count(`SELECT id FROM wallet_transactions WHERE allocationId = ${allocId}`), 0);
    // Allocation-level refusal: would pay out if assertOrderReleasable were removed.
    const direct = await releaseAllocation(await allocRow(allocId));
    assert.notEqual(direct.status, 'available');
    assert.match(String(direct.reason || ''), /not releasable/i);
  });

  test('7. automatic release skips a refunded order', async () => {
    const { orderId, allocId } = await eligibleSetup('refunded');
    await pool.execute(`UPDATE orders SET paymentStatus = 'refunded' WHERE id = ?`, [orderId]);
    await autoReleaseExpiredEscrows();
    assert.equal((await allocRow(allocId)).status, 'held');
    assert.equal(await count(`SELECT id FROM wallet_transactions WHERE allocationId = ${allocId}`), 0);
  });

  test('assertOrderReleasable truth table (guard-removal proof)', async () => {
    const buyer = await mkUser('customer', 'b-guard');
    const mk = (ps, os) => mkOrder(buyer, { paymentStatus: ps, orderStatus: os, escrowStatus: 'held', totalAmount: 50, paymentReference: tag(`pay-g-${ps}-${os}-${Math.random()}`) });
    assert.equal((await assertOrderReleasable(await mk('paid', 'delivered'))).ok, true);
    assert.equal((await assertOrderReleasable(await mk('paid', 'processing'))).ok, true);
    assert.equal((await assertOrderReleasable(await mk('paid', 'delivered'))).ok, true);
    const c = await mk('paid', 'processing');
    await pool.execute(`UPDATE orders SET orderStatus = 'cancelled' WHERE id = ?`, [c]);
    assert.equal((await assertOrderReleasable(c)).ok, false, 'cancelled must refuse');
    const r = await mk('paid', 'processing');
    await pool.execute(`UPDATE orders SET paymentStatus = 'refunded' WHERE id = ?`, [r]);
    assert.equal((await assertOrderReleasable(r)).ok, false, 'refunded must refuse');
    const u = await mk('pending', 'pending');
    assert.equal((await assertOrderReleasable(u)).ok, false, 'unpaid must refuse');
    assert.equal((await assertOrderReleasable(999999999)).ok, false, 'missing order must refuse');
  });

  test('releaseVendorEscrow pays an eligible vendor, refuses a cancelled order', async () => {
    const vendor = await mkVendor('v-relv');
    const vendor2 = await mkVendor('v-relv2');
    const buyer = await mkUser('customer', 'b-relv');
    const orderId = await mkOrder(buyer, { paymentStatus: 'paid', orderStatus: 'delivered', escrowStatus: 'held', totalAmount: 200, paymentReference: tag('pay-relv') });
    const allocId = await mkAlloc(orderId, vendor, { status: 'held', payoutAmount: 81 });
    const allocId2 = await mkAlloc(orderId, vendor2, { status: 'held', payoutAmount: 81 });
    const okOut = await releaseVendorEscrow(orderId, vendor);
    assert.equal((await allocRow(allocId)).status, 'available');
    assert.equal(await count(`SELECT id FROM wallet_transactions WHERE type='credit' AND allocationId = ${allocId}`), 1);
    void okOut;
    await pool.execute(`UPDATE orders SET orderStatus = 'cancelled' WHERE id = ?`, [orderId]);
    const badOut = await releaseVendorEscrow(orderId, vendor2);
    assert.equal((await allocRow(allocId2)).status, 'held', 'no release after cancel');
    assert.ok(String(badOut.skipped || '').includes('not releasable'));
  });

  test('releaseEscrowForOrder refuses a cancelled order wholesale', async () => {
    const vendor = await mkVendor('v-relw');
    const buyer = await mkUser('customer', 'b-relw');
    const orderId = await mkOrder(buyer, { paymentStatus: 'paid', orderStatus: 'processing', escrowStatus: 'held', totalAmount: 100, paymentReference: tag('pay-relw') });
    const allocId = await mkAlloc(orderId, vendor, { status: 'held' });
    await pool.execute(`UPDATE orders SET orderStatus = 'cancelled' WHERE id = ?`, [orderId]);
    const out = await releaseEscrowForOrder(orderId);
    assert.equal((await allocRow(allocId)).status, 'held');
    assert.ok(String(out.skipped || '').includes('not releasable'));
  });

  test('vendor auto-release skips cancelled orders', async () => {
    const vendor = await mkVendor('v-vauto');
    const buyer = await mkUser('customer', 'b-vauto');
    const orderId = await mkOrder(buyer, { paymentStatus: 'paid', orderStatus: 'processing', escrowStatus: 'held', totalAmount: 100, paymentReference: tag('pay-vauto') });
    const allocId = await mkAlloc(orderId, vendor, { status: 'held', payoutAmount: 81 });
    await pool.execute(
      `INSERT INTO vendor_order_fulfillment (orderId, vendorId, status, deliveredAt, escrowReleaseDeadline)
       VALUES (?, ?, 'delivered', DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY))`,
      [orderId, vendor]
    );
    await pool.execute(`UPDATE orders SET orderStatus = 'cancelled' WHERE id = ?`, [orderId]);
    await autoReleaseExpiredVendorEscrows();
    assert.equal((await allocRow(allocId)).status, 'held');
    assert.equal(await count(`SELECT id FROM wallet_transactions WHERE allocationId = ${allocId}`), 0);
  });
});

describe('F-2/F-3 races (real concurrent workers, invariant assertions)', { skip: !dbAvailable }, () => {
  test('8. cancellation racing automatic release cannot double-spend', async () => {
    for (let i = 0; i < 3; i++) {
      const vendor = await mkVendor(`v-race${i}`);
      const buyer = await mkUser('customer', `b-race${i}`);
      const orderId = await mkOrder(buyer, { paymentStatus: 'paid', orderStatus: 'processing', escrowStatus: 'held', totalAmount: 100, paymentReference: tag(`pay-race${i}`) });
      const allocId = await mkAlloc(orderId, vendor, { status: 'held', payoutAmount: 81 });
      paystackRefundCalls = 0;
      const res = mockRes();
      const [cancelResult, rel] = await Promise.all([
        cancelOrder(adminReq({ id: orderId }), res).then(() => res.statusCode),
        releaseAllocation(await allocRow(allocId)),
      ]);
      void cancelResult; void rel;
      const alloc = await allocRow(allocId);
      // Cancel always voids at the end; release cannot claim past the flip.
      assert.equal(alloc.status, 'failed', `iteration ${i}: allocation must end failed, got ${alloc.status}`);
      assert.ok((await count(`SELECT id FROM wallet_transactions WHERE type='credit' AND allocationId = ${allocId}`)) <= 1);
      const claws = await count(`SELECT id FROM wallet_transactions WHERE type='clawback' AND reference = 'clawback:${allocId}'`);
      const credits = await count(`SELECT id FROM wallet_transactions WHERE type='credit' AND allocationId = ${allocId}`);
      if (credits === 1) assert.equal(claws, 1, `iteration ${i}: credited funds must be clawed back`);
      assert.equal(await count(`SELECT id FROM financial_events WHERE dedupeKey = 'refund:${orderId}'`), 1);
      assert.equal(paystackRefundCalls, 1);
    }
  });

  test('9. refund-void racing automatic release converges to failed, single journal', async () => {
    for (let i = 0; i < 5; i++) {
      const vendor = await mkVendor(`v-vrace${i}`);
      const buyer = await mkUser('customer', `b-vrace${i}`);
      const orderId = await mkOrder(buyer, { paymentStatus: 'paid', orderStatus: 'processing', escrowStatus: 'held', totalAmount: 100, paymentReference: tag(`pay-vrace${i}`) });
      const allocId = await mkAlloc(orderId, vendor, { status: 'held', payoutAmount: 81 });
      await Promise.all([
        voidEscrowForOrder(orderId),
        releaseAllocation(await allocRow(allocId)),
      ]);
      const alloc = await allocRow(allocId);
      assert.equal(alloc.status, 'failed', `iteration ${i}: got ${alloc.status}`);
      assert.ok((await count(`SELECT id FROM wallet_transactions WHERE type='credit' AND allocationId = ${allocId}`)) <= 1);
      assert.ok((await count(`SELECT id FROM financial_events WHERE dedupeKey = 'escrow.clawback:${allocId}'`)) <= 1);
      const credits = await count(`SELECT id FROM wallet_transactions WHERE type='credit' AND allocationId = ${allocId}`);
      if (credits === 1) {
        const claws = await count(`SELECT id FROM financial_events WHERE dedupeKey = 'escrow.clawback:${allocId}'`);
        assert.equal(claws, 1, `iteration ${i}: credited funds must carry a clawback journal`);
      }
    }
  });

  test('concurrent duplicate cancel refunds exactly once (refund CAS race)', async () => {
    const vendor = await mkVendor('v-casrace');
    const buyer = await mkUser('customer', 'b-casrace');
    const orderId = await mkOrder(buyer, { paymentStatus: 'paid', orderStatus: 'processing', escrowStatus: 'held', totalAmount: 100, paymentReference: tag('pay-casrace') });
    await mkAlloc(orderId, vendor, { status: 'held' });
    paystackRefundCalls = 0;
    const [a, b] = await Promise.all([
      (async () => { const r = mockRes(); await cancelOrder(adminReq({ id: orderId }), r); return r.statusCode; })(),
      (async () => { const r = mockRes(); await cancelOrder(adminReq({ id: orderId }), r); return r.statusCode; })(),
    ]);
    assert.ok([a, b].includes(200), 'one cancel must succeed');
    assert.ok([a, b].some((s) => s !== 200), 'the loser must be refused');
    assert.equal(paystackRefundCalls, 1, 'provider refunded exactly once');
    assert.equal(await count(`SELECT id FROM financial_events WHERE dedupeKey = 'refund:${orderId}'`), 1);
  });
});

describe('F-2: withdrawal and admin-transition guards', { skip: !dbAvailable }, () => {
  test('11. vendor withdrawal after cancellation is refused (guard-removal proof)', async () => {
    for (const flip of [['cancelled', 'paid'], ['processing', 'refunded']]) {
      const vendor = await mkVendor(`v-wd-${flip[0]}`);
      const buyer = await mkUser('customer', `b-wd-${flip[0]}`);
      const orderId = await mkOrder(buyer, { paymentStatus: 'paid', orderStatus: 'processing', escrowStatus: 'held', totalAmount: 100, paymentReference: tag(`pay-wd-${flip[0]}`) });
      const allocId = await mkAlloc(orderId, vendor, { status: 'held', payoutAmount: 81 });
      const rel = await releaseAllocation(await allocRow(allocId));
      assert.equal(rel.status, 'available');
      // Simulate the pre-fix window: funds available while the order is dead.
      await pool.execute(`UPDATE orders SET orderStatus = ?, paymentStatus = ? WHERE id = ?`, [flip[0], flip[1], orderId]);

      const attempt = await payoutAllocation({ ...(await allocRow(allocId)), recipientCode: 'RCP_TEST' });
      assert.equal(attempt.paid, false, `withdrawal on ${flip} order must not pay`);
      assert.equal(await count(`SELECT id FROM payout_attempts WHERE allocationId = ${allocId}`), 0, 'no payout attempt may be persisted');
      assert.equal((await getAvailableAllocationsForVendor(vendor)).length, 0, 'dead-order funds must be invisible to withdrawal');
      const alloc = await allocRow(allocId);
      assert.equal(alloc.status, 'available', 'refused withdrawal must not consume the allocation');
    }
  });

  test('12. administrative attempts to bypass the cancellation flow are rejected', async () => {
    const buyer = await mkUser('customer', 'b-bypass');
    const orderId = await mkOrder(buyer, { paymentStatus: 'paid', orderStatus: 'processing', escrowStatus: 'held', totalAmount: 100, paymentReference: tag('pay-bypass') });

    const r1 = mockRes();
    await updateOrder(adminReq({ id: orderId }, { orderStatus: 'cancelled' }), r1);
    assert.equal(r1.statusCode, 400);
    assert.equal(r1.body.code, 'CANCEL_VIA_CANCEL_ENDPOINT');

    const r2 = mockRes();
    await updateOrder(adminReq({ id: orderId }, { paymentStatus: 'refunded' }), r2);
    assert.equal(r2.statusCode, 400);
    assert.equal(r2.body.code, 'REFUND_VIA_REFUND_FLOW');

    // Order untouched by the bypass attempts: still live, still paid.
    const ord = await orderRow(orderId);
    assert.equal(ord.orderStatus, 'processing');
    assert.equal(ord.paymentStatus, 'paid');

    // Resurrection of a terminal order is rejected (the legacy RB-03 block
    // already refuses processing/paid flips; the terminal-immutability guard
    // covers every other forward move, e.g. cancelled -> delivered).
    await pool.execute(`UPDATE orders SET orderStatus = 'cancelled' WHERE id = ?`, [orderId]);
    const r3 = mockRes();
    await updateOrder(adminReq({ id: orderId }, { orderStatus: 'processing' }), r3);
    assert.equal(r3.statusCode, 400);
    const r4 = mockRes();
    await updateOrder(adminReq({ id: orderId }, { orderStatus: 'delivered' }), r4);
    assert.equal(r4.statusCode, 400);
    assert.equal(r4.body.code, 'TERMINAL_ORDER_IMMUTABLE');
    const ord2 = await orderRow(orderId);
    assert.equal(ord2.orderStatus, 'cancelled', 'terminal order must stay terminal');
  });

  test('13. invalid payment-status transitions are rejected; paid mark is idempotent', async () => {
    const buyer = await mkUser('customer', 'b-trans');
    const orderId = await mkOrder(buyer, { paymentStatus: 'paid', orderStatus: 'processing', escrowStatus: 'held', totalAmount: 100, paymentReference: tag('pay-trans') });
    await mkAlloc(orderId, await mkVendor('v-trans'), { status: 'held' });

    // Mark-paid on a live paid order is a safe no-op (no duplicate holds).
    const r1 = mockRes();
    await updateOrderToPaid(adminReq({ id: orderId }), r1);
    assert.ok([200, 400].includes(r1.statusCode), JSON.stringify(r1.body));

    // Mark-paid on a cancelled order is refused.
    await pool.execute(`UPDATE orders SET orderStatus = 'cancelled' WHERE id = ?`, [orderId]);
    const r2 = mockRes();
    await updateOrderToPaid(adminReq({ id: orderId }), r2);
    assert.equal(r2.statusCode, 400, 'cancelled orders must never be markable paid');
  });

  test('14. clawback failure leaves an auditable manual-recovery trail, never a crash', async () => {
    const vendor = await mkVendor('v-clawfail');
    const buyer = await mkUser('customer', 'b-clawfail');
    const orderId = await mkOrder(buyer, { paymentStatus: 'paid', orderStatus: 'processing', escrowStatus: 'held', totalAmount: 100, paymentReference: tag('pay-clawfail') });
    const allocId = await mkAlloc(orderId, vendor, { status: 'available', payoutAmount: 81 });
    const credited = await creditVendorBalance(vendor, allocId, 81, 'F2F3-14');
    assert.equal(credited, true, 'setup credit must land');
    // Drain the wallet while the credit row still proves funds were credited:
    // the clawback debit must fail safely, not take other money, not throw.
    await pool.execute(`UPDATE vendor_wallets SET available_balance = 0 WHERE vendorId = ?`, [vendor]);

    await voidEscrowForOrder(orderId);

    const alloc = await allocRow(allocId);
    assert.equal(alloc.status, 'failed');
    assert.match(String(alloc.reason || ''), /manual recovery needed/);
    assert.equal(await count(`SELECT id FROM wallet_transactions WHERE type='clawback' AND reference = 'clawback:${allocId}'`), 0, 'no partial debit may be recorded');
  });
});
