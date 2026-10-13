// FILE LOCATION: backend/tests/withdrawalConcurrency.test.js
// DESCRIPTION: Concurrent vendor withdrawals cannot spend the same balance
//              twice. withdrawVendorBalance checks the wallet with a plain read
//              and the wallet is only debited by the transfer.success webhook,
//              so the ONLY thing standing between N parallel requests and N
//              transfers of the same money is the conditional claim in
//              payoutAllocation (`payoutAmount >= ? AND status = 'available'`,
//              committed before any provider call). These tests fire real
//              parallel requests through the controller against a stubbed
//              Paystack and assert the money invariants:
//                Σ claimed (payout_attempts) == Σ transfers sent
//                Σ claimed + Σ remaining payoutAmount == Σ original payoutAmount
//                no allocation goes negative.
//
// DISPOSABLE DATABASE ONLY (tests/helpers/testDbGuard.mjs + interlock below).
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
/** @type {any} */ let withdrawVendorBalance;
/** @type {any} */ let paystackServices;
/** @type {any} */ let origTransfer;

const TS = Date.now();
const tag = (s) => `wdc-${s}-${TS}`;
const state = { users: [], orders: [], allocs: [] };
let seq = 0;
/** @type {{ amount: number, reference: string }[]} */
let transfers = [];

const mockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};

async function mkVendor(name) {
  const [u] = await pool.execute(
    `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
     VALUES ('WDC', ?, ?, 'x', 'vendor', 1, 1)`,
    [name, `${tag(name)}@test.local`]
  );
  state.users.push(u.insertId);
  await pool.execute(
    `INSERT INTO vendors (userId, businessName, status, recipientCode) VALUES (?, ?, 'approved', ?)`,
    [u.insertId, tag(name), `RCP_${tag(name)}`.slice(0, 30)]
  );
  return u.insertId;
}

async function mkAvailableAlloc(vendorId, payoutAmount) {
  seq += 1;
  const [o] = await pool.execute(
    `INSERT INTO orders (userId, orderNumber, items, totalAmount, shippingAddress, billingAddress,
       paymentMethod, paymentStatus, orderStatus, shippingCost, tax, discount, escrowStatus)
     VALUES (?, ?, '[]', ?, '{}', '{}', 'card', 'paid', 'delivered', 0, 0, 0, 'released')`,
    [vendorId, `WDC-${TS}-${seq}`, payoutAmount]
  );
  state.orders.push(o.insertId);
  const [a] = await pool.execute(
    `INSERT INTO escrow_allocations (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status)
     VALUES (?, ?, ?, 0, 0, ?, 'available')`,
    [o.insertId, vendorId, payoutAmount, payoutAmount]
  );
  state.allocs.push(a.insertId);
  return a.insertId;
}

async function setWallet(vendorId, balance) {
  await pool.execute(
    `INSERT INTO vendor_wallets (vendorId, available_balance, total_earned) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE available_balance = VALUES(available_balance)`,
    [vendorId, balance, balance]
  );
}

const withdrawConcurrently = (vendorId, amounts) =>
  Promise.all(amounts.map(async (amount) => {
    const res = mockRes();
    await withdrawVendorBalance({ user: { id: vendorId, role: 'vendor' }, body: { amount } }, res);
    return res;
  }));

const ledger = async (vendorId, allocIds) => {
  const [[claimed]] = await pool.execute(
    `SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS n FROM payout_attempts WHERE vendorId = ?`, [vendorId]);
  const [allocs] = await pool.execute(
    `SELECT id, status, payoutAmount FROM escrow_allocations WHERE id IN (${allocIds.map(() => '?').join(',')})`, allocIds);
  return {
    claimed: Number(claimed.s),
    attempts: Number(claimed.n),
    remaining: allocs.reduce((s, a) => s + Number(a.payoutAmount), 0),
    allocs,
  };
};

before(async () => {
  if (!dbAvailable) return;
  pool = (await import('../config/db.js')).default;
  await assertDisposableDb(pool);
  ({ withdrawVendorBalance } = await import('../controllers/vendorController.js'));
  ({ default: paystackServices } = await import('../Services/paystackservices.js'));
  // No network, no real funds. A small delay widens the race window so the
  // parallel requests genuinely overlap inside payoutAllocation.
  origTransfer = paystackServices.initiateTransfer;
  paystackServices.initiateTransfer = async (amount, _recipient, _reason, reference) => {
    await new Promise((r) => setTimeout(r, 15));
    transfers.push({ amount: Number(amount), reference });
    return { data: { status: true, data: { reference } } };
  };
});

after(async () => {
  if (!dbAvailable) {
    await (await import('../config/db.js')).default.end().catch(() => {});
    return;
  }
  paystackServices.initiateTransfer = origTransfer;
  const ids = (a) => a.map(() => '?').join(',');
  if (state.users.length) {
    await pool.execute(`DELETE FROM payout_attempts WHERE vendorId IN (${ids(state.users)})`, state.users).catch(() => {});
    await pool.execute(`DELETE FROM financial_events WHERE vendorId IN (${ids(state.users)})`, state.users).catch(() => {});
  }
  if (state.allocs.length) await pool.execute(`DELETE FROM escrow_allocations WHERE id IN (${ids(state.allocs)})`, state.allocs).catch(() => {});
  if (state.orders.length) await pool.execute(`DELETE FROM orders WHERE id IN (${ids(state.orders)})`, state.orders).catch(() => {});
  if (state.users.length) {
    await pool.execute(`DELETE FROM vendor_wallets WHERE vendorId IN (${ids(state.users)})`, state.users).catch(() => {});
    await pool.execute(`DELETE FROM vendors WHERE userId IN (${ids(state.users)})`, state.users).catch(() => {});
    await pool.execute(`DELETE FROM users WHERE id IN (${ids(state.users)})`, state.users).catch(() => {});
  }
  await pool.end();
});

describe('concurrent vendor withdrawals', { skip: !dbAvailable }, () => {
  test('8 parallel full withdrawals of one 100.00 allocation send exactly one transfer', async () => {
    transfers = [];
    const vendorId = await mkVendor('full');
    const alloc = await mkAvailableAlloc(vendorId, 100);
    await setWallet(vendorId, 100);

    const results = await withdrawConcurrently(vendorId, Array(8).fill(100));

    const ok = results.filter((r) => r.statusCode === 200);
    assert.equal(ok.length, 1, `exactly one request succeeds (got ${results.map((r) => r.statusCode)})`);
    const l = await ledger(vendorId, [alloc]);
    assert.equal(transfers.length, 1);
    assert.equal(l.attempts, 1);
    assert.equal(l.claimed, 100);
    assert.equal(l.remaining, 0);
    assert.equal(l.allocs[0].status, 'releasing');
  });

  test('parallel partial withdrawals never claim more than the allocation holds', async () => {
    transfers = [];
    const vendorId = await mkVendor('partial');
    const alloc = await mkAvailableAlloc(vendorId, 100);
    await setWallet(vendorId, 100);

    // 10 × 30.00 against 100.00: at most three can be honoured.
    await withdrawConcurrently(vendorId, Array(10).fill(30));

    const l = await ledger(vendorId, [alloc]);
    const sent = transfers.reduce((s, t) => s + t.amount, 0);
    assert.ok(l.claimed <= 100 + 1e-9, `claimed ${l.claimed} exceeds 100`);
    assert.ok(l.remaining >= 0, `allocation went negative: ${l.remaining}`);
    assert.equal(Math.round((l.claimed + l.remaining) * 100), 100 * 100, 'claimed + remaining must equal the original');
    assert.equal(Math.round(sent * 100), Math.round(l.claimed * 100), 'every claim is exactly one transfer');
    assert.equal(l.attempts, transfers.length);
  });

  test('parallel withdrawals spanning several allocations conserve the total', async () => {
    transfers = [];
    const vendorId = await mkVendor('multi');
    const allocs = [
      await mkAvailableAlloc(vendorId, 60),
      await mkAvailableAlloc(vendorId, 40),
      await mkAvailableAlloc(vendorId, 25.5),
    ];
    await setWallet(vendorId, 125.5);

    await withdrawConcurrently(vendorId, [70, 70, 125.5, 30, 55.25, 10]);

    const l = await ledger(vendorId, allocs);
    const sent = transfers.reduce((s, t) => s + t.amount, 0);
    assert.ok(l.allocs.every((a) => Number(a.payoutAmount) >= 0), 'no allocation goes negative');
    assert.equal(Math.round((l.claimed + l.remaining) * 100), 12550, 'claimed + remaining == 125.50');
    assert.equal(Math.round(sent * 100), Math.round(l.claimed * 100));
    assert.equal(l.attempts, transfers.length);
  });

  test('a withdrawal above the wallet balance is refused before any claim', async () => {
    transfers = [];
    const vendorId = await mkVendor('over');
    const alloc = await mkAvailableAlloc(vendorId, 50);
    await setWallet(vendorId, 50);

    const [res] = await withdrawConcurrently(vendorId, [50.01]);
    assert.equal(res.statusCode, 400);
    const l = await ledger(vendorId, [alloc]);
    assert.equal(l.attempts, 0);
    assert.equal(transfers.length, 0);
    assert.equal(l.remaining, 50);
  });
});
