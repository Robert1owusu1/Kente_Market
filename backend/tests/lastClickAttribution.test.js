// FILE LOCATION: backend/tests/lastClickAttribution.test.js
// DESCRIPTION: Last-click affiliate attribution (follow-up). A commission is
//   booked for the order's referrerUserId even when the buyer is an EXISTING
//   customer with no signup attribution (users.referredBy IS NULL).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

let pool = null;
let dbAvailable = true;
try { pool = (await import('../config/db.js')).default; await pool.query('SELECT 1'); } catch { dbAvailable = false; }

const { recordReferralForOrder } = await import('../Services/referralService.js');
const Setting = (await import('../models/settingModel.js')).default;

const TS = Date.now();
const fx = { referrerId: null, customerId: null, orderId: null };
let prevEnabled = 'false', prevRate = '';

after(async () => {
  if (!dbAvailable) return;
  await Setting.update('referral.enabled', prevEnabled === 'true', 'boolean').catch(() => {});
  if (prevRate !== '') await Setting.update('referral.standardRate', prevRate, 'number').catch(() => {});
  if (fx.orderId) { await pool.query('DELETE FROM referral_commissions WHERE orderId = ?', [fx.orderId]).catch(() => {}); await pool.query('DELETE FROM orders WHERE id = ?', [fx.orderId]).catch(() => {}); }
  for (const id of [fx.referrerId, fx.customerId]) if (id) await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  await pool.end().catch(() => {});
});

describe('last-click affiliate attribution', { skip: !dbAvailable }, () => {
  before(async () => {
    const e = await Setting.get('referral.enabled'); prevEnabled = e === true || e === 'true' ? 'true' : 'false';
    const r = await Setting.get('referral.standardRate'); prevRate = (r === null || r === undefined) ? '' : String(r);
    await Setting.update('referral.enabled', true, 'boolean');
    await Setting.update('referral.standardRate', '0.05', 'number');

    const [ref] = await pool.query(`INSERT INTO users (firstName,lastName,email,password,role,isActive,ambassadorTier) VALUES ('Nana','Creator',?, 'x','customer',1,'standard')`, [`lc_ref_${TS}@t.local`]);
    fx.referrerId = ref.insertId;
    // Existing customer — NO signup attribution (referredBy NULL).
    const [cust] = await pool.query(`INSERT INTO users (firstName,lastName,email,password,role,isActive) VALUES ('Existing','Buyer',?, 'x','customer',1)`, [`lc_cust_${TS}@t.local`]);
    fx.customerId = cust.insertId;

    const snapshot = { v: 1, funder: 'platform', couponVendorId: null, discount: 0, lines: [{ productId: 1, vendorId: 999, P: 100, r: 0.1, F: 10, Da: 0, Ds: 0 }] };
    const [o] = await pool.query(
      `INSERT INTO orders (userId, orderNumber, totalAmount, items, paymentStatus, orderStatus, paymentMethod, referrerUserId, commissionSnapshot, shippingAddress)
       VALUES (?, ?, 100, '[]', 'paid', 'processing', 'paystack', ?, ?, '{}')`,
      [fx.customerId, `LC-${TS}`, fx.referrerId, JSON.stringify(snapshot)]
    );
    fx.orderId = o.insertId;
  });

  test('books a commission for the order referrer (existing customer, no signup attribution)', async () => {
    const [[cust]] = await pool.query(`SELECT referredBy FROM users WHERE id = ?`, [fx.customerId]);
    assert.equal(cust.referredBy, null); // confirm no signup attribution

    const ok = await recordReferralForOrder(fx.orderId);
    assert.equal(ok, true);

    const [[row]] = await pool.query(`SELECT referrerId, amount FROM referral_commissions WHERE orderId = ?`, [fx.orderId]);
    assert.ok(row, 'a referral commission was booked');
    assert.equal(row.referrerId, fx.referrerId);
    assert.equal(Number(row.amount), 5); // min(0.05*100, F-Da=10) = 5
  });
});
