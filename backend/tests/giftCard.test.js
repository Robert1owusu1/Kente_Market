// FILE LOCATION: backend/tests/giftCard.test.js
// DESCRIPTION: Gift card + store credit (Phase 3, Step 7). Issue on payment,
//   redeem into spend-only store credit, and the spend guard. EMAIL_DISABLED
//   keeps delivery from attempting SMTP.
process.env.EMAIL_DISABLED = '1';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

const {
  activateGiftCardByReference, redeemGiftCard, getStoreCreditBalance, payOrderWithStoreCredit,
} = await import('../Services/giftCardService.js');
const GiftCard = (await import('../models/giftCardModel.js')).default;

const TS = Date.now();
const fx = { buyerId: null, recipientId: null, cardId: null, orderId: null };
const REF = `GIFT_test_${TS}`;

after(async () => {
  if (!dbAvailable) return;
  if (fx.orderId) await pool.query('DELETE FROM orders WHERE id = ?', [fx.orderId]).catch(() => {});
  await pool.query('DELETE FROM store_credit_transactions WHERE userId IN (?,?)', [fx.buyerId, fx.recipientId]).catch(() => {});
  await pool.query('DELETE FROM store_credit_wallets WHERE userId IN (?,?)', [fx.buyerId, fx.recipientId]).catch(() => {});
  if (fx.cardId) await pool.query('DELETE FROM gift_cards WHERE id = ?', [fx.cardId]).catch(() => {});
  for (const id of [fx.buyerId, fx.recipientId]) if (id) await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  await pool.end().catch(() => {});
});

describe('gift cards + store credit', { skip: !dbAvailable }, () => {
  before(async () => {
    const [b] = await pool.query(`INSERT INTO users (firstName,lastName,email,password,role) VALUES ('Buyer','One',?, 'x','customer')`, [`gcbuyer_${TS}@t.local`]);
    fx.buyerId = b.insertId;
    const [r] = await pool.query(`INSERT INTO users (firstName,lastName,email,password,role) VALUES ('Reci','Pient',?, 'x','customer')`, [`gcreci_${TS}@t.local`]);
    fx.recipientId = r.insertId;
    const card = await GiftCard.createPending({
      initialAmount: 200, purchaserUserId: fx.buyerId, recipientEmail: `gcreci_${TS}@t.local`,
      message: 'Happy birthday', purchaseReference: REF,
    });
    fx.cardId = card.id;
  });

  test('payment issues the card (code + active); idempotent', async () => {
    const r1 = await activateGiftCardByReference(REF);
    assert.equal(r1.action, 'issued');
    const card = await GiftCard.findById(fx.cardId);
    assert.equal(card.status, 'active');
    assert.match(card.code, /^BK-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    // replay
    const r2 = await activateGiftCardByReference(REF);
    assert.equal(r2.action, 'already_issued');
  });

  test('redeeming credits the store credit; double-redeem blocked', async () => {
    const card = await GiftCard.findById(fx.cardId);
    const res = await redeemGiftCard(fx.recipientId, card.code);
    assert.equal(res.amount, 200);
    assert.equal(res.balance, 200);
    assert.equal(await getStoreCreditBalance(fx.recipientId), 200);

    await assert.rejects(() => redeemGiftCard(fx.recipientId, card.code), /already been redeemed/);
  });

  test('an invalid code is rejected', async () => {
    await assert.rejects(() => redeemGiftCard(fx.recipientId, 'BK-ZZZZ-ZZZZ-ZZZZ'), /Invalid gift card code/);
  });

  test('store credit cannot pay an order it does not cover', async () => {
    const [o] = await pool.query(
      `INSERT INTO orders (userId, orderNumber, totalAmount, items, paymentStatus, orderStatus)
       VALUES (?, ?, 500, '[]', 'pending', 'pending')`,
      [fx.recipientId, `GC-ORD-${TS}`]
    );
    fx.orderId = o.insertId;
    const r = await payOrderWithStoreCredit({ userId: fx.recipientId, orderId: fx.orderId });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'INSUFFICIENT_CREDIT');
    // Balance untouched.
    assert.equal(await getStoreCreditBalance(fx.recipientId), 200);
  });
});
