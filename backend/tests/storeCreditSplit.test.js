// FILE LOCATION: backend/tests/storeCreditSplit.test.js
// DESCRIPTION: Gift-card SPLIT payment (follow-up). Partial credit leaves a
//   Paystack remainder; full-cover is deferred to the whole-order path; refund
//   returns the credit (idempotently).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

let pool = null;
let dbAvailable = true;
try { pool = (await import('../config/db.js')).default; await pool.query('SELECT 1'); } catch { dbAvailable = false; }

const { applyStoreCreditToOrder, returnStoreCreditForOrder, getStoreCreditBalance } = await import('../Services/giftCardService.js');

const TS = Date.now();
const fx = { userId: null, order150: null, order80: null };

after(async () => {
  if (!dbAvailable) return;
  for (const id of [fx.order150, fx.order80]) if (id) await pool.query('DELETE FROM orders WHERE id = ?', [id]).catch(() => {});
  if (fx.userId) {
    await pool.query('DELETE FROM store_credit_transactions WHERE userId = ?', [fx.userId]).catch(() => {});
    await pool.query('DELETE FROM store_credit_wallets WHERE userId = ?', [fx.userId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ?', [fx.userId]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

describe('store credit split payment', { skip: !dbAvailable }, () => {
  before(async () => {
    const [u] = await pool.query(`INSERT INTO users (firstName,lastName,email,password,role) VALUES ('Split','Buyer',?, 'x','customer')`, [`split_${TS}@t.local`]);
    fx.userId = u.insertId;
    await pool.query(`INSERT INTO store_credit_wallets (userId, balance, totalReceived) VALUES (?, 100, 100)`, [fx.userId]);
    const [o1] = await pool.query(`INSERT INTO orders (userId, orderNumber, totalAmount, items, paymentStatus, orderStatus) VALUES (?, ?, 150, '[]', 'pending', 'pending')`, [fx.userId, `SP-150-${TS}`]);
    fx.order150 = o1.insertId;
    const [o2] = await pool.query(`INSERT INTO orders (userId, orderNumber, totalAmount, items, paymentStatus, orderStatus) VALUES (?, ?, 80, '[]', 'pending', 'pending')`, [fx.userId, `SP-80-${TS}`]);
    fx.order80 = o2.insertId;
  });

  test('partial credit leaves a Paystack remainder', async () => {
    const r = await applyStoreCreditToOrder({ userId: fx.userId, orderId: fx.order150 });
    assert.equal(r.status, 200);
    assert.equal(r.body.applied, 100);
    assert.equal(r.body.amountDue, 50);
    assert.equal(await getStoreCreditBalance(fx.userId), 0);
    const [[o]] = await pool.query(`SELECT storeCreditApplied FROM orders WHERE id = ?`, [fx.order150]);
    assert.equal(Number(o.storeCreditApplied), 100);
  });

  test('applying twice is rejected', async () => {
    const r = await applyStoreCreditToOrder({ userId: fx.userId, orderId: fx.order150 });
    assert.equal(r.status, 409);
  });

  test('refund returns the credit (idempotent)', async () => {
    await pool.query(`UPDATE orders SET orderStatus = 'cancelled' WHERE id = ?`, [fx.order150]);
    assert.equal(await returnStoreCreditForOrder(fx.order150), true);
    assert.equal(await getStoreCreditBalance(fx.userId), 100);
    assert.equal(await returnStoreCreditForOrder(fx.order150), false); // idempotent
    assert.equal(await getStoreCreditBalance(fx.userId), 100);
  });

  test('credit covering the whole order defers to the whole-order path', async () => {
    const r = await applyStoreCreditToOrder({ userId: fx.userId, orderId: fx.order80 });
    assert.equal(r.status, 200);
    assert.equal(r.body.coversFull, true);
    assert.equal(await getStoreCreditBalance(fx.userId), 100); // nothing spent
  });
});
