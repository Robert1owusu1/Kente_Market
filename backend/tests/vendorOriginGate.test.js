// FILE LOCATION: backend/tests/vendorOriginGate.test.js
// DESCRIPTION: Bonwire origin hard gate (Phase 2, Step 3). A vendor with
//   complete payout details but unverified origin cannot be approved; once an
//   admin verifies the origin, approval succeeds. Uses real fixtures (the
//   controllers run on the shared pool) and cleans them up.
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

const { updateVendorStatus, verifyVendorOrigin } = await import('../controllers/vendorController.js');
const Setting = (await import('../models/settingModel.js')).default;

const mockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (p) => { res.body = p; return res; };
  return res;
};

const TS = Date.now();
const fx = { userId: null, vendorId: null, adminId: null };

after(async () => {
  if (!dbAvailable) return;
  if (fx.vendorId) await pool.query('DELETE FROM vendors WHERE id = ?', [fx.vendorId]).catch(() => {});
  if (fx.userId) await pool.query('DELETE FROM users WHERE id = ?', [fx.userId]).catch(() => {});
  if (fx.adminId) await pool.query('DELETE FROM users WHERE id = ?', [fx.adminId]).catch(() => {});
  await pool.end().catch(() => {});
});

describe('Bonwire origin hard gate', { skip: !dbAvailable }, () => {
  before(async () => {
    // Ensure the gate is ON.
    await Setting.update('vendorPlans.bonwireVerificationRequired', true, 'boolean');

    const [u] = await pool.query(
      `INSERT INTO users (firstName, lastName, email, password, role) VALUES ('Kofi','Weaver',?, 'x','vendor')`,
      [`weaver_${TS}@test.local`]
    );
    fx.userId = u.insertId;
    const [a] = await pool.query(
      `INSERT INTO users (firstName, lastName, email, password, role) VALUES ('Ad','Min',?, 'x','admin')`,
      [`admin_${TS}@test.local`]
    );
    fx.adminId = a.insertId;

    // Vendor with COMPLETE payout details but origin NOT verified.
    const [v] = await pool.query(
      `INSERT INTO vendors (userId, businessName, status, payoutType, momoProvider, momoNumber, recipientCode, originTown, originVerified)
       VALUES (?, 'Bonwire Looms', 'pending', 'momo', 'MTN', '0240000000', 'RCP_test', 'Bonwire', 0)`,
      [fx.userId]
    );
    fx.vendorId = v.insertId;
  });

  test('approval is blocked while origin is unverified', async () => {
    const res = mockRes();
    await updateVendorStatus({ params: { id: fx.vendorId }, body: { status: 'approved' }, user: { id: fx.adminId } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(JSON.stringify(res.body), /Bonwire origin is not verified/);
  });

  test('admin verifies origin, then approval succeeds', async () => {
    const vres = mockRes();
    await verifyVendorOrigin(
      { params: { id: fx.vendorId }, body: { verified: true, note: 'called the workshop' }, user: { id: fx.adminId } },
      vres
    );
    assert.equal(vres.statusCode, 200);
    assert.equal(vres.body.vendor.originVerified, true);
    assert.equal(vres.body.vendor.originVerifiedBy, fx.adminId);

    const ares = mockRes();
    await updateVendorStatus({ params: { id: fx.vendorId }, body: { status: 'approved' }, user: { id: fx.adminId } }, ares);
    assert.equal(ares.statusCode, 200);
    assert.equal(ares.body.vendor.status, 'approved');
  });

  test('revoking origin blocks approval again', async () => {
    // put vendor back to pending + revoke
    await pool.query('UPDATE vendors SET status = ? WHERE id = ?', ['pending', fx.vendorId]);
    const vres = mockRes();
    await verifyVendorOrigin({ params: { id: fx.vendorId }, body: { verified: false }, user: { id: fx.adminId } }, vres);
    assert.equal(vres.statusCode, 200);
    assert.equal(vres.body.vendor.originVerified, false);

    const ares = mockRes();
    await updateVendorStatus({ params: { id: fx.vendorId }, body: { status: 'approved' }, user: { id: fx.adminId } }, ares);
    assert.equal(ares.statusCode, 400);
  });
});
