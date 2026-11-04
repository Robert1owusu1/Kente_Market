// FILE LOCATION: backend/tests/wholesale.test.js
// DESCRIPTION: B2B wholesale bulk quotes (Phase 3, Step 9). Buyer requests →
//   vendor quotes → buyer accepts, with MOQ and wholesale-enabled guards.
//   vendorPlans.required defaults off, so getPlanAccess allows wholesale here.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch { dbAvailable = false; }

const {
  createQuoteRequest, getMyQuoteRequests, respondToQuote, vendorQuote,
} = await import('../controllers/wholesaleController.js');

const TS = Date.now();
const fx = { buyerId: null, vendorId: null, wsProductId: null, plainProductId: null, quoteId: null };

const mockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (p) => { res.body = p; return res; };
  return res;
};

after(async () => {
  if (!dbAvailable) return;
  await pool.query('DELETE FROM bulk_quote_requests WHERE buyerUserId = ?', [fx.buyerId]).catch(() => {});
  for (const id of [fx.wsProductId, fx.plainProductId]) if (id) await pool.query('DELETE FROM product WHERE id = ?', [id]).catch(() => {});
  for (const id of [fx.buyerId, fx.vendorId]) if (id) await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  await pool.end().catch(() => {});
});

describe('B2B wholesale bulk quotes', { skip: !dbAvailable }, () => {
  before(async () => {
    const [b] = await pool.query(`INSERT INTO users (firstName,lastName,email,password,role) VALUES ('Bulk','Buyer',?, 'x','customer')`, [`wsbuyer_${TS}@t.local`]);
    fx.buyerId = b.insertId;
    const [v] = await pool.query(`INSERT INTO users (firstName,lastName,email,password,role) VALUES ('WS','Vendor',?, 'x','vendor')`, [`wsvendor_${TS}@t.local`]);
    fx.vendorId = v.insertId;
    const [p] = await pool.query(
      `INSERT INTO product (title,img,price,category,vendorId,approvalStatus,wholesaleEnabled,wholesaleMinQty) VALUES ('WS Kente','w.jpg',120,'kente',?, 'approved', 1, 10)`,
      [fx.vendorId]
    );
    fx.wsProductId = p.insertId;
    const [p2] = await pool.query(
      `INSERT INTO product (title,img,price,category,vendorId,approvalStatus,wholesaleEnabled) VALUES ('Retail Only','r.jpg',120,'kente',?, 'approved', 0)`,
      [fx.vendorId]
    );
    fx.plainProductId = p2.insertId;
  });

  test('buyer can request a bulk quote (>= MOQ)', async () => {
    const res = mockRes();
    await createQuoteRequest({ user: { id: fx.buyerId }, body: { productId: fx.wsProductId, quantity: 20, companyName: 'Hotel GH', message: 'Need 20' } }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.quote.status, 'pending');
    assert.equal(res.body.quote.vendorId, fx.vendorId);
    fx.quoteId = res.body.quote.id;
  });

  test('below MOQ is rejected', async () => {
    const res = mockRes();
    await createQuoteRequest({ user: { id: fx.buyerId }, body: { productId: fx.wsProductId, quantity: 5 } }, res);
    assert.equal(res.statusCode, 400);
  });

  test('a non-wholesale product is rejected', async () => {
    const res = mockRes();
    await createQuoteRequest({ user: { id: fx.buyerId }, body: { productId: fx.plainProductId, quantity: 50 } }, res);
    assert.equal(res.statusCode, 409);
  });

  test('vendor sends a quote', async () => {
    const res = mockRes();
    await vendorQuote({ user: { id: fx.vendorId }, params: { id: String(fx.quoteId) }, body: { unitPrice: 95, note: 'Bulk price', validDays: 14 } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.quote.status, 'quoted');
    assert.equal(res.body.quote.quotedUnitPrice, 95);
  });

  test('buyer accepts the quote', async () => {
    const res = mockRes();
    await respondToQuote('accept')({ user: { id: fx.buyerId }, params: { id: String(fx.quoteId) } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.quote.status, 'accepted');
  });

  test('buyer sees it in their list', async () => {
    const res = mockRes();
    await getMyQuoteRequests({ user: { id: fx.buyerId } }, res);
    assert.ok(Array.isArray(res.body) && res.body.some((q) => q.id === fx.quoteId));
  });
});
