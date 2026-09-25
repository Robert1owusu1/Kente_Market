// FILE LOCATION: backend/tests/paymentHardeningSchema.test.js
// DESCRIPTION: Regression tests for the CRITICAL payment-integrity fixes
//              (audit 2026-09-24). These run against the real database so a
//              schema/code mismatch fails loudly instead of being swallowed
//              by the clawback catch-block at runtime:
//   1. escrow_allocations.reason exists (voidEscrowForOrder writes it — the
//      column was missing from the schema, so EVERY clawback UPDATE threw
//      ER_BAD_FIELD_ERROR before any money could be recovered).
//   2. wallet_transactions.type accepts 'clawback' (the enum only knew
//      credit/withdrawal/fee/reversal, so the clawback ledger row failed
//      under strict SQL mode).
//   3. voidEscrowForOrder actually clawed back: allocation failed + reason
//      set, wallet debited once, one clawback ledger row, one journal row —
//      and a second run does NOT double-debit.
//   4. orders.paymentReference is UNIQUE (one Paystack charge can never mark
//      two orders paid) and blank references don't block the index.
// NOTE: Uses the real database; inserts then cleans up after itself.
//      Self-skips entirely when no database is reachable (CI).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';

const RUN_ID = `clw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// DB gate: self-skip when no database is reachable (see promotions.test.js).
let dbAvailable = true;
try {
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

/** @type {number[]} */
const createdUserIds = [];
/** @type {number[]} */
const createdOrderIds = [];
/** @type {number[]} */
const createdAllocationIds = [];

const cleanup = async () => {
  if (createdOrderIds.length > 0) {
    const orderPh = createdOrderIds.map(() => '?').join(', ');
    await pool.execute(`DELETE FROM financial_events WHERE orderId IN (${orderPh})`, createdOrderIds);
  }
  for (const uid of createdUserIds) {
    await pool.execute(`DELETE FROM wallet_transactions WHERE vendorId = ?`, [uid]);
  }
  if (createdUserIds.length > 0) {
    const userPh = createdUserIds.map(() => '?').join(', ');
    // Orders first (escrow/payout FKs cascade from them), then the users.
    await pool.execute(`DELETE FROM orders WHERE userId IN (${userPh})`, createdUserIds);
    await pool.execute(`DELETE FROM users WHERE id IN (${userPh})`, createdUserIds);
  }
  createdUserIds.length = 0;
  createdOrderIds.length = 0;
  createdAllocationIds.length = 0;
};

/**
 * Vendor user + paid order + one 'available' allocation + a wallet credited
 * with the payout amount — i.e. exactly the state after an early (advance)
 * release, which is what a return/refund then claws back.
 */
const setupClawbackScenario = async () => {
  const email = `${RUN_ID}-${createdUserIds.length}@test.local`;
  const [userRes] = await pool.execute(
    `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
     VALUES ('ClawbackTest', 'Vendor', ?, ?, 'vendor', 1, 1)`,
    [email, await bcrypt.hash('not-a-real-password', 4)]
  );
  const userId = userRes.insertId;
  createdUserIds.push(userId);

  await pool.execute(
    `INSERT INTO vendors (userId, businessName, status, recipientCode)
     VALUES (?, ?, 'approved', 'RCP_test')`,
    [userId, `Claw ${RUN_ID}`]
  );

  const [orderRes] = await pool.execute(
    `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus)
     VALUES (?, ?, ?, 100.00, 'paid', 'processing', 'releasing')`,
    [userId, `CLW-${RUN_ID}-${createdUserIds.length}`, JSON.stringify([])]
  );
  const orderId = orderRes.insertId;
  createdOrderIds.push(orderId);

  const [allocRes] = await pool.execute(
    `INSERT INTO escrow_allocations
       (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType)
     VALUES (?, ?, 100.00, 0.1000, 10.00, 90.00, 'available', 'advance')`,
    [orderId, userId]
  );
  const allocationId = allocRes.insertId;
  createdAllocationIds.push(allocationId);

  // Fund the wallet the way an early release would.
  await pool.execute(
    `INSERT INTO vendor_wallets (vendorId, available_balance, total_earned)
     VALUES (?, 90.00, 90.00)
     ON DUPLICATE KEY UPDATE available_balance = available_balance + 90.00,
                              total_earned = total_earned + 90.00`,
    [userId]
  );

  return { userId, orderId, allocationId };
};

describe('Payment hardening schema + clawback (DB-backed)', { skip: !dbAvailable }, () => {
  after(async () => {
    if (!dbAvailable) {
      await pool.end();
      return;
    }
    try {
      await cleanup();
    } finally {
      await pool.end();
    }
  });

  test('escrow_allocations.reason column exists', async () => {
    const [cols] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'escrow_allocations'
         AND COLUMN_NAME = 'reason'`
    );
    assert.equal(Number(cols[0].c), 1,
      'escrow_allocations.reason is missing — run: npm run db:migrate --prefix backend');
  });

  test('wallet_transactions.type accepts clawback', async () => {
    const [rows] = await pool.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wallet_transactions'
         AND COLUMN_NAME = 'type'`
    );
    const type = rows[0]?.COLUMN_TYPE || '';
    assert.ok(type.includes('clawback'),
      `wallet_transactions.type is "${type}" — missing clawback; run: npm run db:migrate --prefix backend`);
  });

  test('orders.paymentReference has a UNIQUE key', async () => {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
         AND INDEX_NAME = 'uq_orders_paymentReference'`
    );
    assert.equal(Number(rows[0].c), 1,
      'uq_orders_paymentReference missing — one charge could pay two orders; run db:migrate');
  });

  test('a duplicate paymentReference is rejected by the database', async () => {
    const dupRef = `clw-dup-${RUN_ID}`;
    const email = `${RUN_ID}-dup@test.local`;
    const [userRes] = await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
       VALUES ('ClawbackTest', 'Dup', ?, ?, 'customer', 1, 1)`,
      [email, await bcrypt.hash('not-a-real-password', 4)]
    );
    createdUserIds.push(userRes.insertId);
    await pool.execute(
      `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentReference)
       VALUES (?, ?, ?, 10.00, ?)`,
      [userRes.insertId, `CLW-DUP1-${RUN_ID}`, JSON.stringify([]), dupRef]
    );
    createdOrderIds.push(0); // placeholder, cleaned via userId anyway

    await assert.rejects(
      () => pool.execute(
        `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentReference)
         VALUES (?, ?, ?, 10.00, ?)`,
        [userRes.insertId, `CLW-DUP2-${RUN_ID}`, JSON.stringify([]), dupRef]
      ),
      /Duplicate entry|uq_orders_paymentReference/,
      'second order with the same paymentReference must violate uq_orders_paymentReference'
    );
  });

  test('voidEscrowForOrder clawed back the credited advance (and is idempotent)', async () => {
    const { voidEscrowForOrder } = await import('../Services/escrowService.js');
    const { userId, orderId, allocationId } = await setupClawbackScenario();

    await voidEscrowForOrder(orderId);

    const [[alloc]] = await pool.execute(
      `SELECT status, reason FROM escrow_allocations WHERE id = ?`,
      [allocationId]
    );
    assert.equal(alloc.status, 'failed', 'allocation must be marked failed after clawback');
    assert.ok(
      String(alloc.reason || '').includes('clawed back'),
      `allocation reason must record the clawback, got: ${alloc.reason}`
    );

    const [[wallet]] = await pool.execute(
      `SELECT available_balance FROM vendor_wallets WHERE vendorId = ?`,
      [userId]
    );
    assert.equal(Number(wallet.available_balance), 0, 'wallet must be debited by the clawback');

    const [clawRows] = await pool.execute(
      `SELECT id FROM wallet_transactions WHERE vendorId = ? AND type = 'clawback' AND reference = ?`,
      [userId, `clawback:${allocationId}`]
    );
    assert.equal(clawRows.length, 1, 'exactly one clawback ledger row must exist');

    const [journalRows] = await pool.execute(
      `SELECT id FROM financial_events WHERE dedupeKey = ?`,
      [`escrow.clawback:${allocationId}`]
    );
    assert.equal(journalRows.length, 1, 'exactly one escrow.clawback journal row must exist');

    // Second run (webhook redelivery / return-then-cancel): no double debit.
    await voidEscrowForOrder(orderId);
    const [[wallet2]] = await pool.execute(
      `SELECT available_balance FROM vendor_wallets WHERE vendorId = ?`,
      [userId]
    );
    assert.equal(Number(wallet2.available_balance), 0, 'second run must not move money');
    const [clawRows2] = await pool.execute(
      `SELECT id FROM wallet_transactions WHERE vendorId = ? AND type = 'clawback'`,
      [userId]
    );
    assert.equal(clawRows2.length, 1, 'second run must not add another ledger row');
  });
});
