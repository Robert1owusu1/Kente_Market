// FILE LOCATION: backend/tests/settlement.test.js
// DESCRIPTION: Integration tests for the durable transfer settlement service
//              (transferSettlementService.js) — the same code path used by the
//              signed webhook handler and the reconciliation scheduler.
//   - transfer.success settles exactly once: attempt -> succeeded, allocation
//     -> released, wallet debited once, one journal row.
//   - transfer.reversed pays the money back: attempt -> reversed, allocation
//     -> available + amount restored, wallet credited once.
//   - both are idempotent under replay (returns 'already', no double-booking).
// NOTE: Uses the real (dev) database; inserts then cleans up after itself.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { round2 } from '../../shared/pricing.js';
import { creditVendorBalance } from '../Services/walletService.js';
import {
  settleTransferSuccess,
  settleTransferReversed,
} from '../Services/transferSettlementService.js';

const RUN_ID = `stl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** @type {number[]} */
const createdUserIds = [];
/** @type {number[]} */
const createdAllocationIds = [];

/**
 * Build a full money scenario: vendor user + vendor row + order + one full
 * escrow allocation 'releasing' + a processing payout attempt, and pre-credit
 * the wallet (as escrow release would) so there is spendable balance.
 * @param {string} ref payout reference to use
 * @returns {Promise<{ userId: number, orderId: number, allocationId: number, attemptId: number, ref: string }>}
 */
const setupScenario = async (ref) => {
  const email = `${ref}@test.local`;
  const [userRes] = await pool.execute(
    `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
     VALUES ('SettleTest', 'Vendor', ?, ?, 'vendor', 1, 1)`,
    [email, await bcrypt.hash('not-a-real-password', 4)]
  );
  const userId = userRes.insertId;
  createdUserIds.push(userId);

  await pool.execute(
    `INSERT INTO vendors (userId, businessName, status, recipientCode)
     VALUES (?, ?, 'approved', 'RCP_test')`,
    [userId, `Settle ${RUN_ID}`]
  );

  const [orderRes] = await pool.execute(
    `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, escrowStatus)
     VALUES (?, ?, ?, 100.00, 'paid', 'processing', 'releasing')`,
    [userId, `STL-${ref}`, JSON.stringify([])]
  );
  const orderId = orderRes.insertId;

  const [allocRes] = await pool.execute(
    `INSERT INTO escrow_allocations
       (orderId, vendorId, amount, platformFeeRate, platformFee, payoutAmount, status, allocationType)
     VALUES (?, ?, 100.00, 0.1000, 10.00, 0.00, 'releasing', 'standard')`,
    [orderId, userId]
  );
  const allocationId = allocRes.insertId;
  createdAllocationIds.push(allocationId);

  await pool.execute(
    `INSERT INTO payout_attempts (allocationId, vendorId, amount, reference, isFull, status)
     VALUES (?, ?, 90.00, ?, 1, 'processing')`,
    [allocationId, userId, ref]
  );

  await creditVendorBalance(userId, allocationId, 90.00, `STL-${RUN_ID}`);

  return { userId, orderId, allocationId, ref };
};

const cleanup = async () => {
  if (createdAllocationIds.length > 0) {
    const placeholders = createdAllocationIds.map(() => '?').join(', ');
    await pool.execute(
      `DELETE FROM financial_events WHERE allocationId IN (${placeholders})`,
      createdAllocationIds
    );
  }
  for (const uid of createdUserIds) {
    // Delete attempts first (RESTRICT FK), then the user cascades the rest.
    await pool.execute(
      `DELETE pa FROM payout_attempts pa
       JOIN escrow_allocations ea ON ea.id = pa.allocationId
       WHERE ea.vendorId = ?`,
      [uid]
    );
    await pool.execute(`DELETE FROM users WHERE id = ?`, [uid]);
  }
  createdUserIds.length = 0;
  createdAllocationIds.length = 0;
};

describe('Transfer settlement idempotency (webhook + reconciler shared path)', () => {
  after(async () => {
    await cleanup();
    await pool.end();
  });

  test('transfer.success settles exactly once (attempt, allocation, wallet, journal)', async () => {
    const ref = `ref-${RUN_ID}-ok`;
    const s = await setupScenario(ref);

    const outcome = await settleTransferSuccess(ref);
    assert.equal(outcome, 'settled');

    const [[attempt]] = await pool.execute(
      `SELECT status FROM payout_attempts WHERE reference = ?`,
      [ref]
    );
    assert.equal(attempt.status, 'succeeded');

    const [[alloc]] = await pool.execute(
      `SELECT status FROM escrow_allocations WHERE id = ?`,
      [s.allocationId]
    );
    assert.equal(alloc.status, 'released');

    const [[wallet]] = await pool.execute(
      `SELECT available_balance, total_withdrawn FROM vendor_wallets WHERE vendorId = ?`,
      [s.userId]
    );
    // 90 credited at release, 90 debited at settlement → net zero, withdrawn 90.
    assert.equal(round2(wallet.available_balance), 0);
    assert.equal(round2(wallet.total_withdrawn), 90);

    const [[counts]] = await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM wallet_transactions WHERE type='withdrawal' AND reference=?) AS withdrawals,
         (SELECT COUNT(*) FROM financial_events WHERE dedupeKey=?) AS journal`,
      [ref, `payout.succeeded:${ref}`]
    );
    assert.equal(counts.withdrawals, 1);
    assert.equal(counts.journal, 1);
  });

  test('replaying transfer.success is a no-op', async () => {
    const ref = `ref-${RUN_ID}-ok2`;
    await setupScenario(ref);
    await settleTransferSuccess(ref);

    const again = await settleTransferSuccess(ref);
    assert.equal(again, 'already');

    const [[counts]] = await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM wallet_transactions WHERE type='withdrawal' AND reference=?) AS withdrawals,
         (SELECT COUNT(*) FROM financial_events WHERE dedupeKey=?) AS journal`,
      [ref, `payout.succeeded:${ref}`]
    );
    assert.equal(counts.withdrawals, 1);
    assert.equal(counts.journal, 1);
  });

  test('transfer.reversed returns the money and is idempotent', async () => {
    const ref = `ref-${RUN_ID}-rev`;
    const s = await setupScenario(ref);

    await settleTransferSuccess(ref);
    const outcome = await settleTransferReversed(ref);
    assert.equal(outcome, 'settled');

    const [[attempt]] = await pool.execute(
      `SELECT status FROM payout_attempts WHERE reference = ?`,
      [ref]
    );
    assert.equal(attempt.status, 'reversed');

    const [[alloc]] = await pool.execute(
      `SELECT status, payoutAmount FROM escrow_allocations WHERE id = ?`,
      [s.allocationId]
    );
    assert.equal(alloc.status, 'available');
    // Full payout of 90 was claimed (payoutAmount 0) then returned in full on
    // reversal → the vendor is redeemable for the whole 90 again.
    assert.equal(round2(alloc.payoutAmount), 90);

    // Wallet: 0 after settlement, +90 after reversal → 90 again.
    const [[wallet]] = await pool.execute(
      `SELECT available_balance FROM vendor_wallets WHERE vendorId = ?`,
      [s.userId]
    );
    assert.equal(round2(wallet.available_balance), 90);

    const [[counts]] = await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM wallet_transactions WHERE type='reversal' AND reference=?) AS reversals,
         (SELECT COUNT(*) FROM financial_events WHERE dedupeKey=?) AS journal`,
      [ref, `payout.reversed:${ref}`]
    );
    assert.equal(counts.reversals, 1);
    assert.equal(counts.journal, 1);

    const again = await settleTransferReversed(ref);
    assert.equal(again, 'already');
    const [[wallet2]] = await pool.execute(
      `SELECT available_balance FROM vendor_wallets WHERE vendorId = ?`,
      [s.userId]
    );
    assert.equal(round2(wallet2.available_balance), 90); // no double credit
  });

  test('reversal of a never-confirmed transfer restores escrow without crediting the wallet', async () => {
    const ref = `ref-${RUN_ID}-rev2`;
    const s = await setupScenario(ref);
    // No transfer.success arrives — attempt is still 'processing'.

    const outcome = await settleTransferReversed(ref);
    assert.equal(outcome, 'settled');

    const [[alloc]] = await pool.execute(
      `SELECT status, payoutAmount FROM escrow_allocations WHERE id = ?`,
      [s.allocationId]
    );
    assert.equal(alloc.status, 'available');
    assert.equal(round2(alloc.payoutAmount), 90);

    // Wallet was never debited, so reversal must NOT inflate it.
    const [[wallet]] = await pool.execute(
      `SELECT available_balance FROM vendor_wallets WHERE vendorId = ?`,
      [s.userId]
    );
    assert.equal(round2(wallet.available_balance), 90); // only the pre-release credit
    const [[reversals]] = await pool.execute(
      `SELECT COUNT(*) AS c FROM wallet_transactions WHERE type='reversal' AND reference=?`,
      [ref]
    );
    assert.equal(reversals.c, 0);
  });
});