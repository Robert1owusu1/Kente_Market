// FILE LOCATION: backend/tests/verification-fixes.test.js
// DESCRIPTION: Second-stage verification regression coverage. Each test is
// designed to FAIL if the vulnerability returns (not merely assert current SQL).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  pool = null;
}

// ---- Static source guards (fail if fix is reverted) ----

describe('V-STATIC: source guards survive', () => {
  test('RB-07: User model maps lockout columns', () => {
    const src = readSrc('models/usersModel.js');
    assert.ok(src.includes('failedLoginAttempts'), 'constructor must map failedLoginAttempts');
    assert.ok(src.includes('lockedUntil'), 'constructor must map lockedUntil');
  });

  test('RB-06: app state JWT is passed to Google as OAuth state', () => {
    const src = readSrc('routes/authRoutes.js');
    assert.ok(src.includes('state: stateToken'), 'initiation must pass stateToken to passport.authenticate');
  });

  test('RB-06: Passport session state store disabled (no dual-state conflict)', () => {
    const src = readSrc('config/passPort.js');
    assert.ok(/state:\s*false/.test(src), 'strategy must set state:false');
    assert.ok(!/state:\s*true/.test(src), 'strategy must not set state:true');
  });

  test('RB-06: Google login path does not allow silent creation', () => {
    const src = readSrc('config/passPort.js');
    assert.ok(src.includes('allowCreate'), 'findOrCreate must gate creation on allowCreate');
    assert.ok(src.includes('if (!allowCreate)'), 'login path must return null for unknown identity');
  });

  test('RB-03: webhook + verify + recovery use orderStatus guard', () => {
    const routes = readSrc('routes/paymentRoutes.js');
    const guards = routes.match(/orderStatus NOT IN \('cancelled', 'refunded'\)/g) || [];
    assert.ok(guards.length >= 2, `expected >=2 guarded paid-flips in paymentRoutes, got ${guards.length}`);
    const escrow = readSrc('Services/escrowService.js');
    assert.ok(escrow.includes("AND orderStatus NOT IN ('cancelled', 'refunded')"), 'recoverStuckPendingOrders must guard orderStatus');
    const ctrl = readSrc('controllers/orderController.js');
    assert.ok(ctrl.includes("AND orderStatus NOT IN ('cancelled', 'refunded')"), 'updateOrderToPaid must use conditional guarded flip');
  });

  test('RB-02: void marks reason; retry skips void/clawback/refund', () => {
    const src = readSrc('Services/escrowService.js');
    assert.ok(src.includes('voided (order cancelled/refunded)'), 'voidEscrowForOrder must stamp reason');
    assert.ok(src.includes('voided (partial vendor refund)'), 'voidVendorEscrow must stamp reason');
    assert.ok(src.includes("reason.includes('void')"), 'retry must skip voided allocations');
    assert.ok(src.includes("reason.includes('clawback')"), 'retry must skip clawed-back allocations');
  });

  test('Email HTML escaping present', () => {
    const src = readSrc('utils/orderEmailService.js');
    assert.ok(src.includes('escapeHtml'), 'orderEmailService must escape user-controlled fields');
  });

  test('Suspended-vendor checkout gate present', () => {
    const src = readSrc('controllers/orderController.js');
    assert.ok(src.includes('Suspended-vendor gate'), 'addOrderItems must check vendor status');
  });
});

// ---- Unit tests (no DB) ----

describe('V-UNIT: lockout mapping + escaping (no DB)', () => {
  test('User constructor preserves lockout fields from aliased row', async () => {
    const { default: User } = await import('../models/usersModel.js');
    const u = new User({ id: 1, failedLoginAttempts: 9, lockedUntil: '2030-01-01 00:00:00' });
    assert.equal(u.failedLoginAttempts, 9);
    assert.ok(u.lockedUntil);
    const u2 = new User({ id: 2, failed_login_attempts: 4, locked_until: null });
    assert.equal(u2.failedLoginAttempts, 4);
  });

  test('escapeHtml neutralizes markup', async () => {
    const { escapeHtml } = await import('../utils/orderEmailService.js');
    assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(escapeHtml('"quoted" & \'apos\''), '&quot;quoted&quot; &amp; &#39;apos&#39;');
  });
});

// ---- DB-backed functional tests (real code paths) ----

describe('V-DB: real code paths', { skip: !dbAvailable }, () => {
  const ts = Date.now();
  const state = {};
  before(async () => {
    if (!dbAvailable) return;
    const [v] = await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified) VALUES ('VDB','V',?,?,'vendor',1,1)`,
      [`vdb-v-${ts}@test.local`, 'hashedpass']
    );
    state.vendorId = v.insertId;
    await pool.execute(`INSERT INTO vendors (userId, businessName, status, recipientCode) VALUES (?,?, 'approved','RCP_test')`, [state.vendorId, `VDB ${ts}`]);
    const [c] = await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified) VALUES ('VDB','C',?,?,'customer',1,1)`,
      [`vdb-c-${ts}@test.local`, 'hashedpass']
    );
    state.userId = c.insertId;
  });
  after(async () => {
    if (!dbAvailable) return;
    try {
      await pool.execute(`DELETE FROM escrow_allocations WHERE orderId IN (SELECT id FROM orders WHERE orderNumber LIKE 'VDB-%')`);
      await pool.execute(`DELETE FROM orders WHERE orderNumber LIKE 'VDB-%'`);
      await pool.execute(`DELETE FROM vendors WHERE userId = ?`, [state.vendorId]);
      await pool.execute(`DELETE FROM users WHERE id IN (?, ?)`, [state.vendorId, state.userId]);
    } finally {
      await pool.end();
    }
  });

  test('updateOrderToPaid rejects cancelled order (real controller)', async () => {
    const [o] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentMethod) VALUES (?,?,?,100,'pending','cancelled','none','pending')`,
      [state.userId, `VDB-${ts}-C`, JSON.stringify([])]
    );
    const { updateOrderToPaid } = await import('../controllers/orderController.js');
    let code = null; let body = null;
    await updateOrderToPaid({ params: { id: String(o.insertId) }, user: { id: 1, role: 'admin' } }, { status(c) { code = c; return this; }, json(p) { body = p; return this; } });
    assert.equal(code, 400);
    assert.match(body.message, /cancelled/);
    const [[row]] = await pool.execute(`SELECT paymentStatus, orderStatus FROM orders WHERE id = ?`, [o.insertId]);
    assert.equal(row.orderStatus, 'cancelled');
    assert.notEqual(row.paymentStatus, 'paid');
  });

  test('updateOrderToPaid rejects refunded order (real controller)', async () => {
    const [o] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentMethod, refundReference) VALUES (?,?,?,100,'refunded','cancelled','failed','paystack',?)`,
      [state.userId, `VDB-${ts}-R`, JSON.stringify([]), `RFD-${ts}`]
    );
    const { updateOrderToPaid } = await import('../controllers/orderController.js');
    let code = null;
    await updateOrderToPaid({ params: { id: String(o.insertId) }, user: { id: 1, role: 'admin' } }, { status(c) { code = c; return this; }, json() { return this; } });
    assert.equal(code, 400);
  });

  test('retryFailedAllocations skips partially-refunded vendor (order still paid)', async () => {
    const { retryFailedAllocations, voidVendorEscrow } = await import('../Services/escrowService.js');
    const [o] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentReference) VALUES (?,?,?,100,'paid','processing','held',?)`,
      [state.userId, `VDB-${ts}-P`, JSON.stringify([]), `VDBREF-${ts}`]
    );
    const orderId = o.insertId;
    await pool.execute(
      `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType) VALUES (?,?,100,0.1,10,90,'held','standard')`,
      [orderId, state.vendorId]
    );
    // Partial vendor refund voids this vendor's allocation while order stays paid.
    await voidVendorEscrow(orderId, state.vendorId);
    const [[alloc]] = await pool.execute(`SELECT status, reason FROM escrow_allocations WHERE orderId = ?`, [orderId]);
    assert.equal(alloc.status, 'failed');
    const result = await retryFailedAllocations(orderId);
    assert.equal(result.retried, 0, 'voided partial-refund allocation must not be retried');
    const [[after]] = await pool.execute(`SELECT status FROM escrow_allocations WHERE orderId = ?`, [orderId]);
    assert.equal(after.status, 'failed', 'allocation must stay failed');
  });

  test('generic updateOrder cannot resurrect cancelled order to paid', async () => {
    const [o] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentMethod) VALUES (?,?,?,100,'pending','cancelled','none','pending')`,
      [state.userId, `VDB-${ts}-G`, JSON.stringify([])]
    );
    const { updateOrder } = await import('../controllers/orderController.js');
    let code = null;
    await updateOrder(
      { params: { id: String(o.insertId) }, user: { id: 1, role: 'admin' }, body: { paymentStatus: 'paid', orderStatus: 'processing' } },
      { status(c) { code = c; return this; }, json() { return this; } }
    );
    assert.equal(code, 400);
    const [[row]] = await pool.execute(`SELECT paymentStatus FROM orders WHERE id = ?`, [o.insertId]);
    assert.notEqual(row.paymentStatus, 'paid');
  });
});
