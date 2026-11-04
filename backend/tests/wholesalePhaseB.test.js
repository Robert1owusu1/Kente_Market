// FILE LOCATION: backend/tests/wholesalePhaseB.test.js
// DESCRIPTION: B2B wholesale Phase B (follow-up): an accepted quote → paid
//   on-platform order + escrow (platform earns commission). Paystack verify is
//   mocked (same singleton the controller imports).
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';

let pool = null;
let dbAvailable = true;
try { pool = (await import('../config/db.js')).default; await pool.query('SELECT 1'); } catch { dbAvailable = false; }

const { getBulkQuoteCheckoutTotal, checkoutBulkQuote } = await import('../controllers/wholesaleController.js');
const PaystackService = (await import('../Services/paystackservices.js')).default;

const TS = Date.now();
const fx = { buyerId: null, vendorId: null, productId: null, quoteId: null, orderId: null };
const mockRes = () => { const r = { statusCode: 200, body: undefined }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (p) => { r.body = p; return r; }; return r; };

after(async () => {
  if (!dbAvailable) return;
  mock.restoreAll();
  if (fx.orderId) { await pool.query('DELETE FROM escrow_allocations WHERE orderId = ?', [fx.orderId]).catch(() => {}); await pool.query('DELETE FROM order_items WHERE orderId = ?', [fx.orderId]).catch(() => {}); await pool.query('DELETE FROM orders WHERE id = ?', [fx.orderId]).catch(() => {}); }
  if (fx.quoteId) await pool.query('DELETE FROM bulk_quote_requests WHERE id = ?', [fx.quoteId]).catch(() => {});
  if (fx.productId) await pool.query('DELETE FROM product WHERE id = ?', [fx.productId]).catch(() => {});
  if (fx.vendorId) { await pool.query('DELETE FROM vendors WHERE userId = ?', [fx.vendorId]).catch(() => {}); }
  for (const id of [fx.buyerId, fx.vendorId]) if (id) await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  await pool.end().catch(() => {});
});

describe('wholesale Phase B — pay an accepted quote', { skip: !dbAvailable }, () => {
  let total;
  before(async () => {
    const [b] = await pool.query(`INSERT INTO users (firstName,lastName,email,password,role) VALUES ('Bulk','Payer',?, 'x','customer')`, [`wpb_buyer_${TS}@t.local`]);
    fx.buyerId = b.insertId;
    const [v] = await pool.query(`INSERT INTO users (firstName,lastName,email,password,role) VALUES ('WS','Seller',?, 'x','vendor')`, [`wpb_vendor_${TS}@t.local`]);
    fx.vendorId = v.insertId;
    await pool.query(`INSERT INTO vendors (userId, businessName, status, platformFeeRate) VALUES (?, 'WS Looms', 'approved', 0.1000)`, [fx.vendorId]);
    const [p] = await pool.query(`INSERT INTO product (title,img,price,category,vendorId,approvalStatus,wholesaleEnabled,wholesaleMinQty) VALUES ('WS Kente','w.jpg',120,'kente',?, 'approved',1,10)`, [fx.vendorId]);
    fx.productId = p.insertId;
    const [q] = await pool.query(
      `INSERT INTO bulk_quote_requests (buyerUserId, vendorId, productId, quantity, status, quotedUnitPrice, quotedBy, quotedAt) VALUES (?, ?, ?, 20, 'accepted', 95, ?, NOW())`,
      [fx.buyerId, fx.vendorId, fx.productId, fx.vendorId]
    );
    fx.quoteId = q.insertId;
  });

  test('checkout-total prices goods + VAT', async () => {
    const res = mockRes();
    await getBulkQuoteCheckoutTotal({ user: { id: fx.buyerId }, params: { id: String(fx.quoteId) } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.subtotal, 1900); // 20 * 95
    assert.ok(res.body.total >= 1900);
    total = res.body.total;
  });

  test('paying converts the quote into an escrowed order', async () => {
    mock.method(PaystackService, 'verifyTransaction', async () => ({
      data: { status: 'success', amount: Math.round(total * 100), currency: 'GHS' },
    }));
    const res = mockRes();
    await checkoutBulkQuote({
      user: { id: fx.buyerId }, params: { id: String(fx.quoteId) },
      body: { paymentReference: `WPB_REF_${TS}`, shippingAddress: { city: 'Accra', country: 'GH' } },
    }, res);
    assert.equal(res.statusCode, 201);
    fx.orderId = res.body.orderId;

    const [[q]] = await pool.query(`SELECT status, orderId FROM bulk_quote_requests WHERE id = ?`, [fx.quoteId]);
    assert.equal(q.status, 'closed');
    assert.equal(q.orderId, fx.orderId);

    const [[ea]] = await pool.query(`SELECT COUNT(*) AS n, SUM(payoutAmount) AS payout, SUM(platformFee) AS fee FROM escrow_allocations WHERE orderId = ? AND status='held'`, [fx.orderId]);
    assert.ok(ea.n >= 1, 'escrow allocation held for the vendor');
    // 10% commission on 1900 goods → fee 190, vendor net 1710.
    assert.equal(Number(ea.fee), 190);
    assert.equal(Number(ea.payout), 1710);
  });

  test('the same quote cannot be paid twice', async () => {
    mock.method(PaystackService, 'verifyTransaction', async () => ({
      data: { status: 'success', amount: Math.round(total * 100), currency: 'GHS' },
    }));
    const res = mockRes();
    await checkoutBulkQuote({
      user: { id: fx.buyerId }, params: { id: String(fx.quoteId) },
      body: { paymentReference: `WPB_REF2_${TS}`, shippingAddress: {} },
    }, res);
    assert.equal(res.statusCode, 409);
  });
});
