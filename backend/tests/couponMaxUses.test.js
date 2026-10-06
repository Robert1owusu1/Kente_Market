// FILE LOCATION: backend/tests/couponMaxUses.test.js
// DESCRIPTION: N-7 / V-04 (P1) — coupon maxUses must be enforced on the MONEY,
//              not merely on the usage counter.
//
//   Before the fix, `Coupon.validate` (usesUsed < maxUses) ran long before any
//   settlement, nothing reserved a slot, and `consumeCouponForOrder` was a bare
//   `incrementUses` invoked independently by verify / webhook / admin mark-paid
//   / recovery. Two consequences:
//     * N in-flight checkouts could all validate one capped coupon and all
//       settle discounted (cap bypassed), and
//     * one order's retries could burn N slots (cap over-tightened).
//
//   The fix reserves exactly ONE use atomically when the coupon is booked onto
//   the order (orders.couponUseState = 1), settles that reservation once
//   (1 -> 2), and releases it only while the order is still unpaid.
//
// Tests (the 8 required scenarios):
//   1. maxUses = 1  -> second checkout refused, first settles.
//   2. N = 10 concurrent -> exactly 1 discounted order.
//   3. maxUses = 5, N = 20 -> exactly 5 discounted orders.
//   4. retry idempotency -> consumption increases by exactly 1.
//   5. payment callback / verification / webhook retries -> one slot.
//   6. failed payment -> reservation released, coupon reusable.
//   7. successful settlement -> slot can never be given back.
//   8. vendor-scoped coupon -> never discounts or burns capacity for Vendor B.
//
// NOTE: DB-backed; inserts and cleans up after itself. Skips without MySQL.
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
const MARK = `CPTMAX-${ts}`; // orders.notes marker so cleanup is scoped to us
const state = {
  vendorA: null,
  vendorB: null,
  customer: null,
  prodA: null,
  prodB: null,
  // one coupon per scenario so tests stay independent of each other
  c1: null,      // maxUses = 1   (test 1)
  conc: null,    // maxUses = 1   (test 2, N = 10)
  c5: null,      // maxUses = 5   (test 3, N = 20)
  cidem: null,   // maxUses = 5   (tests 4 + 5, idempotency)
  crel: null,    // maxUses = 1   (test 6, cancel releases)
  csweep: null,  // maxUses = 1   (test 6, expiry sweeper releases)
  csett: null,   // maxUses = 1   (test 7a, settled slot is permanent)
  csweep2: null, // maxUses = 1   (test 7b, sweeper cannot free a settled slot)
  cvend: null,   // vendor A, maxUses = 1 (test 8)
  codes: {},
};

const mkVendor = async (tag) => {
  const [u] = await pool.execute(
    `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
     VALUES ('CPTMAX', ?, ?, 'hashed', 'vendor', 1, 1)`,
    [tag, `cptmax-vendor-${tag}-${ts}@test.local`]
  );
  await pool.execute(
    `INSERT INTO vendors (userId, businessName, status, recipientCode)
     VALUES (?, ?, 'approved', ?)`,
    [u.insertId, `CPTMAX Vendor ${tag} ${ts}`, `RCP_${tag}${ts}`]
  );
  return u.insertId;
};

const mkProduct = async (vendorId, tag) => {
  const [r] = await pool.execute(
    `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
     VALUES (?, ?, 100.0, 'cptmax', 1000, ?, 0, 'approved')`,
    [`CPTMAX ${tag} ${ts}`, '/uploads/test.png', vendorId]
  );
  return r.insertId;
};

const mkCoupon = async (key, { maxUses, discountValue = 10, discountType = 'fixed', vendorId = null, tag }) => {
  const code = `CPT${String(ts).slice(-6)}${tag}`;
  const [r] = await pool.execute(
    `INSERT INTO coupons (code, discountType, discountValue, minPurchase, maxUses, expiresAt, isActive, vendorId)
     VALUES (?, ?, ?, 0, ?, NULL, 1, ?)`,
    [code, discountType, discountValue, maxUses, vendorId]
  );
  state[key] = r.insertId;
  state.codes[key] = code;
  return r.insertId;
};

before(async () => {
  if (!dbAvailable || !pool) return;

  const [cust] = await pool.execute(
    `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
     VALUES ('CPTMAX', 'Customer', ?, 'hashed', 'customer', 1, 1)`,
    [`cptmax-customer-${ts}@test.local`]
  );
  state.customer = cust.insertId;

  state.vendorA = await mkVendor('a');
  state.vendorB = await mkVendor('b');
  state.prodA = await mkProduct(state.vendorA, 'A');
  state.prodB = await mkProduct(state.vendorB, 'B');

  await mkCoupon('c1', { maxUses: 1, tag: '1' });
  await mkCoupon('conc', { maxUses: 1, tag: 'C' });
  await mkCoupon('c5', { maxUses: 5, tag: '5' });
  await mkCoupon('cidem', { maxUses: 5, tag: 'I' });
  await mkCoupon('crel', { maxUses: 1, tag: 'R' });
  await mkCoupon('csweep', { maxUses: 1, tag: 'S' });
  await mkCoupon('csett', { maxUses: 1, tag: 'T' });
  await mkCoupon('csweep2', { maxUses: 1, tag: 'U' });
  await mkCoupon('cvend', { maxUses: 1, vendorId: state.vendorA, tag: 'V' });
});

after(async () => {
  if (!dbAvailable || !pool) return;
  // Best-effort and per-statement: the shared DB can hiccup, and one failed
  // DELETE must not skip the rest (leaked fixtures break other suites).
  const cleanup = async (label, sql, params) => {
    try {
      await pool.execute(sql, params);
    } catch (err) {
      console.warn(` couponMaxUses cleanup (${label}) skipped: ${err.message}`);
    }
  };
  try {
    // Children first (FKs point at orders), then the orders, then fixtures.
    for (const t of [
      'authenticity_certificates', 'escrow_allocations', 'return_requests',
      'buyback_requests', 'order_vendor_marks', 'vendor_order_fulfillment',
      'vendor_order_items', 'order_items', 'stock_moves', 'financial_events',
    ]) {
      await cleanup(t,
        `DELETE FROM ${t} WHERE orderId IN (SELECT id FROM orders WHERE notes LIKE ?)`,
        [`${MARK}%`]
      );
    }
    await cleanup('orders', `DELETE FROM orders WHERE notes LIKE ?`, [`${MARK}%`]);
    const couponIds = ['c1', 'conc', 'c5', 'cidem', 'crel', 'csweep', 'csett', 'csweep2', 'cvend']
      .map((k) => state[k]).filter(Boolean);
    if (couponIds.length) {
      await cleanup('coupons',
        `DELETE FROM coupons WHERE id IN (${couponIds.map(() => '?').join(',')})`,
        couponIds
      );
    }
    if (state.prodA) await cleanup('product', `DELETE FROM product WHERE id IN (?, ?)`, [state.prodA, state.prodB]);
    for (const v of [state.vendorA, state.vendorB]) {
      await cleanup('vendors', `DELETE FROM vendors WHERE userId = ?`, [v]);
    }
    const userIds = [state.customer, state.vendorA, state.vendorB].filter(Boolean);
    if (userIds.length) {
      await cleanup('users', `DELETE FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`, userIds);
    }
  } finally {
    await pool.end();
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Drive the real order-creation controller with a minimal req/res double. */
const placeOrder = async ({ productId, couponCode, secondProductId = null }) => {
  const { addOrderItems } = await import('../controllers/orderController.js');
  const items = [{ product: productId, quantity: 1 }];
  if (secondProductId) items.push({ product: secondProductId, quantity: 1 });

  let status = 200;
  let body = null;
  const req = {
    user: { id: state.customer, role: 'customer' },
    body: {
      items,
      shippingAddress: {},
      paymentMethod: 'pending',
      notes: MARK,
      ...(couponCode ? { couponCode } : {}),
    },
  };
  const res = {
    status(code) { status = code; return this; },
    json(payload) { body = payload; return this; },
  };
  await addOrderItems(req, res);
  const orderId = body?.order?.id ?? null;
  if (status === 201 && orderId) {
    // Park the row: a fresh order still carries escrowStatus 'none' (the
    // allocation step does not update it), which makes it look like an
    // abandoned checkout to any OTHER suite's unscoped expiry sweep. Nothing
    // in these tests reads it until test 6/7 flip it deliberately.
    await pool.execute(`UPDATE orders SET escrowStatus = 'releasing' WHERE id = ?`, [orderId]);
  }
  return { status, body, orderId };
};

/** Drive the real cancellation controller (unpaid orders never hit Paystack). */
const cancelOrder = async (orderId) => {
  const { cancelOrder } = await import('../controllers/orderController.js');
  let status = 200;
  let body = null;
  const req = { params: { id: String(orderId) }, user: { id: 1, role: 'admin' } };
  const res = {
    status(code) { status = code; return this; },
    json(payload) { body = payload; return this; },
  };
  await cancelOrder(req, res);
  return { status, body };
};

const usesOf = async (couponId) => {
  const [[row]] = await pool.execute(`SELECT usesUsed FROM coupons WHERE id = ?`, [couponId]);
  return Number(row?.usesUsed ?? -1);
};

const orderRow = async (orderId) => {
  const [[row]] = await pool.execute(
    `SELECT id, couponId, couponUseState, discount, totalAmount, items, paymentStatus, orderStatus
       FROM orders WHERE id = ?`,
    [orderId]
  );
  return row ?? null;
};

const consume = async (couponId, orderId) => {
  const { consumeCouponForOrder } = await import('../Services/escrowService.js');
  return consumeCouponForOrder(couponId, orderId);
};

/**
 * Poll until fn() is truthy. A parallel test file may win the cancellation
 * claim on the same row first — whoever claims it releases the slot, so the
 * economic outcome is identical and we only need to wait for it.
 */
const waitFor = async (fn, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

// ---------------------------------------------------------------------------
// 1 — maxUses = 1: exactly one discounted order
// ---------------------------------------------------------------------------
describe('N-7/V-04 coupon cap enforced on settlement', { skip: !dbAvailable }, () => {
  test('1. maxUses=1: first order discounted, second refused', async () => {
    const cid = state.c1;
    const code = state.codes.c1;

    const a = await placeOrder({ productId: state.prodA, couponCode: code });
    assert.equal(a.status, 201, `order A should book: ${JSON.stringify(a.body)}`);
    const rowA = await orderRow(a.orderId);
    assert.ok(Number(rowA.discount) > 0, 'order A carries the discount');
    assert.equal(Number(rowA.couponId), Number(cid));
    assert.equal(Number(rowA.couponUseState), 1, 'slot RESERVED at booking');
    assert.equal(await usesOf(cid), 1, 'exactly one use taken');

    const b = await placeOrder({ productId: state.prodA, couponCode: code });
    assert.equal(b.status, 400, `order B must be refused, got ${b.status}: ${JSON.stringify(b.body)}`);
    assert.match(b.body.message, /usage limit/i);
    assert.equal(await usesOf(cid), 1, 'refused checkout must not take a slot');
    assert.equal(b.orderId, null, 'no order created for the loser');

    // Settlement of A succeeds and still costs exactly one slot.
    const settled = await consume(cid, a.orderId);
    assert.equal(settled.consumed, true, 'reserved order settles');
    assert.equal(await usesOf(cid), 1, 'settlement must not take a SECOND slot');
    assert.equal(Number((await orderRow(a.orderId)).couponUseState), 2, 'state reserved -> settled');

    const b2 = await placeOrder({ productId: state.prodA, couponCode: code });
    assert.equal(b2.status, 400, 'cap still holds after settlement');
  });

  // -------------------------------------------------------------------------
  // 2 — N = 10 concurrent, maxUses = 1
  // -------------------------------------------------------------------------
  test('2. concurrency N=10, maxUses=1 -> exactly 1 discounted order', async () => {
    const cid = state.conc;
    const before = await usesOf(cid);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => placeOrder({ productId: state.prodA, couponCode: state.codes.conc }))
    );

    const won = results.filter((r) => r.status === 201);
    const lost = results.filter((r) => r.status === 400);
    const other = results.filter((r) => r.status !== 201 && r.status !== 400);
    assert.deepEqual(
      other.map((r) => [r.status, r.body?.message]),
      [],
      'no checkout may fail with a non-cap error'
    );

    assert.equal(won.length, 1, `exactly 1 of 10 concurrent checkouts may win, got ${won.length}`);
    assert.equal(lost.length, 9, `9 must be refused, got ${lost.length}`);
    for (const l of lost) assert.match(l.body.message, /usage limit/i);

    assert.equal(await usesOf(cid), before + 1, 'counter advanced by exactly one');
    const [[cnt]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM orders WHERE couponId = ? AND notes LIKE ?`,
      [cid, `${MARK}%`]
    );
    assert.equal(Number(cnt.n), 1, 'exactly one order carries the discounted coupon');
  });

  // -------------------------------------------------------------------------
  // 3 — maxUses = 5, N = 20
  // -------------------------------------------------------------------------
  test('3. concurrency N=20, maxUses=5 -> exactly 5 discounted orders', async () => {
    const cid = state.c5;
    const before = await usesOf(cid);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => placeOrder({ productId: state.prodA, couponCode: state.codes.c5 }))
    );

    const won = results.filter((r) => r.status === 201);
    const lost = results.filter((r) => r.status === 400);
    const other = results.filter((r) => r.status !== 201 && r.status !== 400);
    assert.deepEqual(
      other.map((r) => [r.status, r.body?.message]),
      [],
      'no checkout may fail with a non-cap error'
    );

    assert.equal(won.length, 5, `exactly 5 of 20 may be discounted, got ${won.length}`);
    assert.equal(lost.length, 15, `15 must be refused, got ${lost.length}`);
    assert.equal(await usesOf(cid), before + 5, 'counter advanced by exactly maxUses');

    const [[cnt]] = await pool.execute(
      `SELECT COUNT(*) AS n, COALESCE(SUM(discount),0) AS d FROM orders WHERE couponId = ? AND notes LIKE ?`,
      [cid, `${MARK}%`]
    );
    assert.equal(Number(cnt.n), 5, 'exactly 5 discounted orders exist');
    assert.ok(Number(cnt.d) > 0, 'the winners really carry a discount');
  });

  // -------------------------------------------------------------------------
  // 4 — retry idempotency (consume, consume, consume)
  // -------------------------------------------------------------------------
  test('4. retry idempotency: consuming 3x adds exactly 1 use', async () => {
    const cid = state.cidem;
    const code = state.codes.cidem;
    const before = await usesOf(cid);

    const o = await placeOrder({ productId: state.prodA, couponCode: code });
    assert.equal(o.status, 201, JSON.stringify(o.body));
    assert.equal(await usesOf(cid), before + 1, 'booking takes one slot');

    for (let i = 0; i < 3; i += 1) {
      const r = await consume(cid, o.orderId);
      assert.equal(r.consumed, true, `retry ${i + 1} reports success`);
      assert.equal(await usesOf(cid), before + 1, `retry ${i + 1} must not take another slot`);
    }
  });

  // -------------------------------------------------------------------------
  // 5 — payment callback / verification / webhook retries (concurrent too)
  // -------------------------------------------------------------------------
  test('5. payment retries (verify + webhook + admin + reconcile) consume one slot', async () => {
    const cid = state.cidem;
    const before = await usesOf(cid);

    const o = await placeOrder({ productId: state.prodA, couponCode: state.codes.cidem });
    assert.equal(o.status, 201, JSON.stringify(o.body));
    assert.equal(await usesOf(cid), before + 1, 'booking takes one slot');

    // Same event delivered twice, concurrently: the worst case for a naive
    // `incrementUses` at settlement time.
    const concurrent = await Promise.all([
      consume(cid, o.orderId),
      consume(cid, o.orderId),
      consume(cid, o.orderId),
      consume(cid, o.orderId),
    ]);
    for (const r of concurrent) assert.equal(r.consumed, true, 'every path reports settled');

    // ...plus the sequential replay of verify, webhook and reconciliation.
    await consume(cid, o.orderId);
    await consume(cid, o.orderId);
    await consume(cid, o.orderId);

    assert.equal(await usesOf(cid), before + 1, 'exactly ONE slot for this order');
    assert.equal(Number((await orderRow(o.orderId)).couponUseState), 2, 'settled');
  });

  // -------------------------------------------------------------------------
  // 6 — failed payment releases the reservation
  // -------------------------------------------------------------------------
  test('6. failed/cancelled payment releases the slot; expiry sweeper too', async () => {
    // (a) explicit cancellation
    const cidA = state.crel;
    const a = await placeOrder({ productId: state.prodA, couponCode: state.codes.crel });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(await usesOf(cidA), 1, 'slot reserved');

    const cancel = await cancelOrder(a.orderId);
    assert.equal(cancel.status, 200, `cancel failed: ${JSON.stringify(cancel.body)}`);
    assert.equal(await usesOf(cidA), 0, 'abandoned checkout must not burn a redemption');
    assert.equal(Number((await orderRow(a.orderId)).couponUseState), 0, 'reservation returned');

    const b = await placeOrder({ productId: state.prodA, couponCode: state.codes.crel });
    assert.equal(b.status, 201, `coupon must be reusable after release: ${JSON.stringify(b.body)}`);
    assert.equal(await usesOf(cidA), 1, 'reused exactly once');
    await cancelOrder(b.orderId); // free the slot again for cleanup

    // (b) expiry sweeper (abandoned checkout, never cancelled by anyone)
    const cidB = state.csweep;
    const c = await placeOrder({ productId: state.prodA, couponCode: state.codes.csweep });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.equal(await usesOf(cidB), 1, 'slot reserved');

    const { releaseExpiredReservations } = await import('../Services/reservationService.js');
    try {
      // Make the row eligible for the sweep: stale, no escrow activity yet.
      await pool.execute(
        `UPDATE orders SET created_at = DATE_SUB(NOW(), INTERVAL 30 MINUTE), escrowStatus = 'none' WHERE id = ?`,
        [c.orderId]
      );
      // Scoped to our own fixtures: this suite must never sweep another test
      // file's orders, and vice versa.
      await releaseExpiredReservations(0, { notesLike: `${MARK}%` });

      const released = await waitFor(async () => (await usesOf(cidB)) === 0);
      assert.equal(released, true, 'expiry sweeper must release the coupon slot');
      const rowC = await orderRow(c.orderId);
      assert.equal(Number(rowC.couponUseState), 0, 'reservation returned');
      assert.equal(rowC.orderStatus, 'cancelled', 'abandoned checkout was cancelled');
    } finally {
      // Never leave a globally sweepable row behind for other suites to trip on.
      await pool.execute(
        `UPDATE orders SET escrowStatus = 'releasing', created_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [c.orderId]
      );
    }

    const d = await placeOrder({ productId: state.prodA, couponCode: state.codes.csweep });
    assert.equal(d.status, 201, `coupon reusable after expiry release: ${JSON.stringify(d.body)}`);
    assert.equal(await usesOf(cidB), 1);
  });

  // -------------------------------------------------------------------------
  // 7 — a settled discount can never be given back
  // -------------------------------------------------------------------------
  test('7. settled payment keeps its slot (retries, sweeper, direct release)', async () => {
    // (a) realistic: paid order
    const cidA = state.csett;
    const a = await placeOrder({ productId: state.prodA, couponCode: state.codes.csett });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(await usesOf(cidA), 1, 'slot reserved at booking');

    await pool.execute(`UPDATE orders SET paymentStatus = 'paid' WHERE id = ?`, [a.orderId]);
    const settled = await consume(cidA, a.orderId);
    assert.equal(settled.consumed, true);
    assert.equal(Number((await orderRow(a.orderId)).couponUseState), 2, 'settled');
    assert.equal(await usesOf(cidA), 1, 'settlement does not take a second slot');

    // payment verification retried after the webhook
    await consume(cidA, a.orderId);
    await consume(cidA, a.orderId);
    assert.equal(await usesOf(cidA), 1, 'replays cannot consume extra slots');

    // a cancellation / reconciliation attempt must not free a settled slot
    const Coupon = (await import('../models/couponModel.js')).default;
    assert.equal(await Coupon.releaseForOrder(a.orderId, cidA), false, 'CAS refuses state=2');
    const { releaseExpiredReservations } = await import('../Services/reservationService.js');
    await pool.execute(
      `UPDATE orders SET created_at = DATE_SUB(NOW(), INTERVAL 30 MINUTE), escrowStatus = 'none' WHERE id = ?`,
      [a.orderId]
    );
    await releaseExpiredReservations(0, { notesLike: `${MARK}%` });
    assert.equal(await usesOf(cidA), 1, 'sweeper must never free a settled slot');
    assert.equal((await orderRow(a.orderId)).paymentStatus, 'paid', 'paid orders are not sweepable at all');
    await pool.execute(`UPDATE orders SET escrowStatus = 'releasing' WHERE id = ?`, [a.orderId]);

    // the cap still refuses a new buyer
    const again = await placeOrder({ productId: state.prodA, couponCode: state.codes.csett });
    assert.equal(again.status, 400, 'settled slot still occupies the cap');

    // (b) the same guarantee holds for a second settled order: settle -> sweep
    // -> settle again, and the slot stays consumed.
    const cidB = state.csweep2;
    const b = await placeOrder({ productId: state.prodA, couponCode: state.codes.csweep2 });
    assert.equal(b.status, 201, JSON.stringify(b.body));
    await pool.execute(`UPDATE orders SET paymentStatus = 'paid' WHERE id = ?`, [b.orderId]);
    await consume(cidB, b.orderId);
    await consume(cidB, b.orderId);
    assert.equal(Number((await orderRow(b.orderId)).couponUseState), 2, 'settled');
    assert.equal(await usesOf(cidB), 1, 'one slot for the order, still');
    await pool.execute(
      `UPDATE orders SET created_at = DATE_SUB(NOW(), INTERVAL 30 MINUTE), escrowStatus = 'none' WHERE id = ?`,
      [b.orderId]
    );
    await releaseExpiredReservations(0, { notesLike: `${MARK}%` });
    assert.equal(await usesOf(cidB), 1, 'sweeper must never free a settled slot');
    assert.equal(await Coupon.releaseForOrder(b.orderId, cidB), false, 'CAS refuses state=2');
  });

  // -------------------------------------------------------------------------
  // 8 — vendor-scoped coupon stays tenant-isolated
  // -------------------------------------------------------------------------
  test('8. vendor A coupon never discounts Vendor B or burns capacity on B', async () => {
    const cid = state.cvend;
    const code = state.codes.cvend;
    const before = await usesOf(cid);

    // Vendor-B-only cart: refused by scope, capacity untouched.
    const bOnly = await placeOrder({ productId: state.prodB, couponCode: code });
    assert.equal(bOnly.status, 400, `B-only cart must be refused: ${JSON.stringify(bOnly.body)}`);
    assert.match(bOnly.body.message, /issuing store/);
    assert.equal(await usesOf(cid), before, 'Vendor B activity must not consume capacity');

    // Mixed cart: also refused (single-vendor coupon cannot span two stores).
    const mixed = await placeOrder({ productId: state.prodA, secondProductId: state.prodB, couponCode: code });
    assert.equal(mixed.status, 400, `mixed cart must be refused: ${JSON.stringify(mixed.body)}`);
    assert.equal(await usesOf(cid), before, 'mixed cart must not consume capacity');

    // Vendor-A-only cart: the one legitimate redemption.
    const aOnly = await placeOrder({ productId: state.prodA, couponCode: code });
    assert.equal(aOnly.status, 201, JSON.stringify(aOnly.body));
    assert.equal(await usesOf(cid), before + 1, 'exactly one capacity unit consumed');

    const row = await orderRow(aOnly.orderId);
    assert.ok(Number(row.discount) > 0, 'Vendor A order is discounted');
    const rawItems = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
    assert.ok(
      Array.isArray(rawItems) && rawItems.every((it) => Number(it.product ?? it.productId) === Number(state.prodA)),
      'the discounted order contains only Vendor A products'
    );

    // Cap now reached: no further redemption, Vendor B still never discounted.
    const again = await placeOrder({ productId: state.prodA, couponCode: code });
    assert.equal(again.status, 400, 'cap enforced after the legitimate use');
    assert.equal(await usesOf(cid), before + 1);

    const [[cnt]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM orders WHERE couponId = ? AND notes LIKE ?`,
      [cid, `${MARK}%`]
    );
    assert.equal(Number(cnt.n), 1, 'only the Vendor A order ever carried this coupon');
  });

});

// ---------------------------------------------------------------------------
// Guard rails — source-level and deliberately DB-less, so a CI run without
// MySQL still enforces the shape of the fix (N-7/V-04).
// ---------------------------------------------------------------------------
describe('N-7/V-04 source guards (no DB required)', () => {
  test('couponUseState is not client-writable and validate stays advisory', async () => {
    const fs = await import('node:fs/promises');
    const modelSrc = await fs.readFile(new URL('../models/orderModel.js', import.meta.url), 'utf8');
    const whitelist = modelSrc.match(/const allowedFields = \[([\s\S]*?)\]/);
    assert.ok(whitelist, 'Order.update field whitelist present');
    assert.ok(
      !/couponUseState/.test(whitelist[1]),
      'couponUseState must stay out of Order.update allowedFields'
    );

    const src = await fs.readFile(new URL('../controllers/orderController.js', import.meta.url), 'utf8');
    assert.match(src, /Coupon\.reserveUse\(/, 'booking path reserves atomically');
    assert.ok(
      !/Coupon\.incrementUses/.test(src),
      'the controller must never take a slot through a bare increment'
    );

    const escrow = await fs.readFile(new URL('../Services/escrowService.js', import.meta.url), 'utf8');
    assert.match(escrow, /consumeForOrderOnce\(/, 'legacy settlement takes slot + claim transactionally');
    assert.match(escrow, /state === 2/, 'idempotent fast path for already-settled orders');
  });
});
