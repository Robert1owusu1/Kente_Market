// FILE LOCATION: backend/tests/groupBuy.test.js
// DESCRIPTION: Group-buy (follow-up). Deadline sweep: target met → succeeded
//   (orders untouched); target missed → failed + pure pledge orders refunded.
//   Paystack refund is mocked (same singleton the service imports).
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';

let pool = null;
let dbAvailable = true;
try { pool = (await import('../config/db.js')).default; await pool.query('SELECT 1'); } catch { dbAvailable = false; }

const { evaluateGroupBuyCampaigns } = await import('../Services/groupBuyService.js');
const paystack = (await import('../Services/paystackservices.js')).default;

const TS = Date.now();
const fx = { vendorId: null, prodOk: null, prodFail: null, orderOk: null, orderFail: null };
const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

after(async () => {
  if (!dbAvailable) return;
  mock.restoreAll();
  for (const id of [fx.orderOk, fx.orderFail]) if (id) { await pool.query('DELETE FROM order_items WHERE orderId = ?', [id]).catch(() => {}); await pool.query('DELETE FROM orders WHERE id = ?', [id]).catch(() => {}); }
  for (const id of [fx.prodOk, fx.prodFail]) if (id) await pool.query('DELETE FROM product WHERE id = ?', [id]).catch(() => {});
  if (fx.vendorId) await pool.query('DELETE FROM users WHERE id = ?', [fx.vendorId]).catch(() => {});
  await pool.end().catch(() => {});
});

const paidOrderWithItem = async (productId, qty) => {
  const [o] = await pool.query(
    `INSERT INTO orders (userId, orderNumber, totalAmount, items, paymentStatus, orderStatus, paymentMethod, paymentReference)
     VALUES (?, ?, ?, '[]', 'paid', 'processing', 'paystack', ?)`,
    [fx.vendorId, `GB-${productId}-${TS}`, 100 * qty, `GBREF_${productId}_${TS}`]
  );
  const orderId = o.insertId;
  await pool.query(`INSERT INTO order_items (orderId, vendorId, productId, name, qty, price, created_at) VALUES (?, ?, ?, 'Run', ?, 100, NOW())`, [orderId, fx.vendorId, productId, qty]);
  return orderId;
};

describe('group-buy campaigns', { skip: !dbAvailable }, () => {
  before(async () => {
    const [u] = await pool.query(`INSERT INTO users (firstName,lastName,email,password,role) VALUES ('GB','Vendor',?, 'x','vendor')`, [`gb_${TS}@t.local`]);
    fx.vendorId = u.insertId;
    const [pOk] = await pool.query(`INSERT INTO product (title,img,price,category,vendorId,approvalStatus,isPreorder,groupBuyTarget,groupBuyDeadline,groupBuyStatus) VALUES ('GB Met','a.jpg',100,'kente',?, 'approved',1,2,?, 'pending')`, [fx.vendorId, YESTERDAY]);
    fx.prodOk = pOk.insertId;
    const [pFail] = await pool.query(`INSERT INTO product (title,img,price,category,vendorId,approvalStatus,isPreorder,groupBuyTarget,groupBuyDeadline,groupBuyStatus) VALUES ('GB Missed','b.jpg',100,'kente',?, 'approved',1,100,?, 'pending')`, [fx.vendorId, YESTERDAY]);
    fx.prodFail = pFail.insertId;
    fx.orderOk = await paidOrderWithItem(fx.prodOk, 2);   // meets target 2
    fx.orderFail = await paidOrderWithItem(fx.prodFail, 1); // misses target 100
  });

  test('met target succeeds; missed target fails + refunds the pledge', async () => {
    const refundMock = mock.method(paystack, 'refundTransaction', async () => ({ status: true, data: {} }));

    const res = await evaluateGroupBuyCampaigns();
    assert.ok(res.evaluated >= 2);

    const [[ok]] = await pool.query(`SELECT groupBuyStatus FROM product WHERE id = ?`, [fx.prodOk]);
    assert.equal(ok.groupBuyStatus, 'succeeded');
    const [[okOrder]] = await pool.query(`SELECT paymentStatus FROM orders WHERE id = ?`, [fx.orderOk]);
    assert.equal(okOrder.paymentStatus, 'paid'); // untouched

    const [[fail]] = await pool.query(`SELECT groupBuyStatus FROM product WHERE id = ?`, [fx.prodFail]);
    assert.equal(fail.groupBuyStatus, 'failed');
    const [[failOrder]] = await pool.query(`SELECT paymentStatus, orderStatus FROM orders WHERE id = ?`, [fx.orderFail]);
    assert.equal(failOrder.paymentStatus, 'refunded');
    assert.equal(failOrder.orderStatus, 'cancelled');
    assert.ok(refundMock.mock.calls.length >= 1, 'Paystack refund was called');
  });

  test('re-running the sweep does nothing (already resolved)', async () => {
    const res = await evaluateGroupBuyCampaigns();
    assert.equal(res.evaluated, 0);
  });
});
