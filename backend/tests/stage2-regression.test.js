// Stage-2 verification: tests that FAIL if the vulnerability returns.
// Every DB test calls the REAL controller/service (not a re-typed SQL string).
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

describe('S2-STATIC: fixes survive revert', () => {
  test('mark-paid race: loser must not run side effects', () => {
    const src = readSrc('controllers/orderController.js');
    assert.ok(src.includes('race-lost-to-webhook'), 'must early-return when flip loses race to webhook');
    assert.ok(src.includes("Order changed concurrently"), 'must 409 on unexpected race state');
  });
  test('retry has per-allocation order re-check (TOCTOU)', () => {
    const src = readSrc('Services/escrowService.js');
    assert.ok(src.includes('TOCTOU guard'), 'retry loop must re-verify parent order per allocation');
  });
  test('cancel loser returns early without side effects', () => {
    const src = readSrc('controllers/orderController.js');
    assert.ok(src.includes('Lost the race'), 'cancel must early-return when conditional update loses');
  });
  test('sweeper cancels zero-reserved checkouts too', () => {
    const src = readSrc('Services/reservationService.js');
    assert.ok(src.includes('Still cancel the abandoned checkout'), 'sweeper must cancel even with no reserved units');
  });
  test('lockout does not leak via distinct status', () => {
    const model = readSrc('models/usersModel.js');
    assert.ok(!model.includes('Account is temporarily locked'), 'model must not throw a lockout oracle');
    const ctrl = readSrc('controllers/userController.js');
    assert.ok(!ctrl.includes('status(423)'), 'login must not return distinct 423 for locked accounts');
  });
  test('oauth_mode clear matches set options', () => {
    const src = readSrc('routes/authRoutes.js');
    assert.ok(src.includes("clearCookie('oauth_mode', { path: '/', httpOnly: true"), 'mode cookie clear must match set options');
  });
});

describe('S2-UNIT: no-DB invariants', () => {
  test('locked user is generic failure, not a throw', async () => {
    const { default: User } = await import('../models/usersModel.js');
    const orig = User.findByEmail;
    User.findByEmail = async () => new User({
      id: 1, email: 'x@t.local', password: 'h',
      failedLoginAttempts: 10, lockedUntil: new Date(Date.now() + 3600e3),
      isActive: 1,
    });
    try {
      const out = await User.authenticate('x@t.local', 'wrong');
      assert.equal(out, null, 'locked account must return null (generic), not throw');
    } finally {
      User.findByEmail = orig;
    }
  });
  test('unknown vs locked both give null (no oracle)', async () => {
    const { default: User } = await import('../models/usersModel.js');
    const orig = User.findByEmail;
    User.findByEmail = async () => null;
    try {
      const out = await User.authenticate('nobody@t.local', 'wrong');
      assert.equal(out, null);
    } finally {
      User.findByEmail = orig;
    }
  });
});

describe('S2-DB: real code paths', { skip: !dbAvailable }, () => {
  const ts = Date.now();
  const state = {};
  before(async () => {
    if (!dbAvailable) return;
    const [c] = await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified) VALUES ('S2','C',?,?,'customer',1,1)`,
      [`s2-c-${ts}@test.local`, 'hashedpass']
    );
    state.userId = c.insertId;
    const [v] = await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified) VALUES ('S2','V',?,?,'vendor',1,1)`,
      [`s2-v-${ts}@test.local`, 'hashedpass']
    );
    state.vendorId = v.insertId;
    await pool.execute(`INSERT INTO vendors (userId, businessName, status, recipientCode) VALUES (?,?, 'approved','RCP_test')`, [state.vendorId, `S2 ${ts}`]);
  });
  after(async () => {
    if (!dbAvailable) return;
    try {
      await pool.execute(`DELETE FROM escrow_allocations WHERE orderId IN (SELECT id FROM orders WHERE orderNumber LIKE 'S2-%')`);
      await pool.execute(`DELETE FROM orders WHERE orderNumber LIKE 'S2-%'`);
      await pool.execute(`DELETE FROM vendors WHERE userId = ?`, [state.vendorId]);
      await pool.execute(`DELETE FROM users WHERE id IN (?, ?)`, [state.vendorId, state.userId]);
    } finally {
      await pool.end();
    }
  });

  const mockRes = () => {
    let code = 200; let body = null;
    const res = { status(c) { code = c; return res; }, json(p) { body = p; return res; } };
    return { res, get: () => ({ code, body }) };
  };

  test('double mark-paid is idempotent via real controller', async () => {
    const { updateOrderToPaid } = await import('../controllers/orderController.js');
    const [o] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentMethod) VALUES (?,?,?,50,'pending','pending','none','pending')`,
      [state.userId, `S2-${ts}-P`, JSON.stringify([])]
    );
    const id = String(o.insertId);
    const m1 = mockRes();
    await updateOrderToPaid({ params: { id }, user: { id: 1, role: 'admin' } }, m1.res);
    assert.equal(m1.get().code, 200);
    const m2 = mockRes();
    await updateOrderToPaid({ params: { id }, user: { id: 1, role: 'admin' } }, m2.res);
    assert.equal(m2.get().code, 200);
    assert.match(m2.get().body.message, /already paid/i);
    const [[row]] = await pool.execute(`SELECT paymentStatus, orderStatus FROM orders WHERE id = ?`, [o.insertId]);
    assert.equal(row.paymentStatus, 'paid');
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [o.insertId]);
  });

  test('repeated cancel via real controller restores once', async () => {
    const { cancelOrder } = await import('../controllers/orderController.js');
    const [p] = await pool.execute(
      `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus) VALUES (?,?,?,?,?,?,FALSE,'approved')`,
      [`S2-${ts}`, '/img.png', 10, 'kente', 100, state.vendorId]
    );
    const pid = p.insertId;
    const items = JSON.stringify([{ product: pid, qty: 2, price: 10, reserved: 2 }]);
    await pool.execute(`UPDATE product SET stock = stock - 2 WHERE id = ?`, [pid]);
    const [o] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentMethod) VALUES (?,?,?,20,'pending','pending','none','pending')`,
      [state.userId, `S2-${ts}-C`, items]
    );
    const [[before]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [pid]);
    const m1 = mockRes();
    await cancelOrder({ params: { id: String(o.insertId) }, user: { id: state.userId, role: 'customer' } }, m1.res);
    const [[mid]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [pid]);
    const m2 = mockRes();
    await cancelOrder({ params: { id: String(o.insertId) }, user: { id: state.userId, role: 'customer' } }, m2.res);
    const [[after]] = await pool.execute(`SELECT stock FROM product WHERE id = ?`, [pid]);
    assert.equal(mid.stock, before.stock + 2, 'first cancel restores once');
    assert.equal(after.stock, mid.stock, 'second cancel must not restore again');
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [o.insertId]);
    await pool.execute(`DELETE FROM product WHERE id = ?`, [pid]);
  });

  test('retry after full refund is blocked at service layer', async () => {
    const { retryFailedAllocations } = await import('../Services/escrowService.js');
    const [o] = await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus, paymentReference, refundReference) VALUES (?,?,?,50,'refunded','cancelled','failed',?,?)`,
      [state.userId, `S2-${ts}-R`, JSON.stringify([]), `S2REF-${ts}`, `refund:${ts}`]
    );
    await pool.execute(
      `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status) VALUES (?,?,50,0.1,5,45,'failed')`,
      [o.insertId, state.vendorId]
    );
    const r = await retryFailedAllocations(o.insertId);
    assert.equal(r.retried, 0);
    const [[a]] = await pool.execute(`SELECT status FROM escrow_allocations WHERE orderId = ?`, [o.insertId]);
    assert.equal(a.status, 'failed');
    await pool.execute(`DELETE FROM escrow_allocations WHERE orderId = ?`, [o.insertId]);
    await pool.execute(`DELETE FROM orders WHERE id = ?`, [o.insertId]);
  });
});
