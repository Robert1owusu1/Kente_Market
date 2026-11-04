// FILE LOCATION: backend/tests/creatorProgram.test.js
// DESCRIPTION: Creator/affiliate program (Phase 3, Step 6). Apply → admin
//   approve promotes the user to the 'super' ambassador tier with the granted
//   rate and ensures a referral code; reject marks the application rejected.
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
  applyAsCreator, adminReviewCreatorApplication, getMyCreatorApplication,
} = await import('../controllers/referralController.js');
const CreatorApplication = (await import('../models/creatorApplicationModel.js')).default;

const TS = Date.now();
const fx = { userId: null, user2Id: null, adminId: null };

const mockReq = (over) => ({ ip: '127.0.0.1', headers: {}, body: {}, params: {}, query: {}, ...over });
const mockRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (p) => { res.body = p; return res; };
  return res;
};

after(async () => {
  if (!dbAvailable) return;
  for (const id of [fx.userId, fx.user2Id, fx.adminId]) {
    if (id) {
      await pool.query('DELETE FROM creator_applications WHERE userId = ?', [id]).catch(() => {});
      await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
    }
  }
  await pool.end().catch(() => {});
});

describe('creator / affiliate program', { skip: !dbAvailable }, () => {
  before(async () => {
    const [u] = await pool.query(`INSERT INTO users (firstName,lastName,email,password,role) VALUES ('Nana','Creator',?, 'x','customer')`, [`creator_${TS}@t.local`]);
    fx.userId = u.insertId;
    const [u2] = await pool.query(`INSERT INTO users (firstName,lastName,email,password,role) VALUES ('Kojo','Two',?, 'x','customer')`, [`creator2_${TS}@t.local`]);
    fx.user2Id = u2.insertId;
    const [a] = await pool.query(`INSERT INTO users (firstName,lastName,email,password,role) VALUES ('Ad','Min',?, 'x','admin')`, [`cadmin_${TS}@t.local`]);
    fx.adminId = a.insertId;
  });

  test('a user can apply with their audience details', async () => {
    const res = mockRes();
    await applyAsCreator(mockReq({ user: { id: fx.userId }, body: { platforms: ['instagram', 'tiktok'], audienceSize: 25000, niche: 'African fashion', pitch: 'I feature kente looks' } }), res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.application.status, 'pending');
    assert.deepEqual(res.body.application.platforms, ['instagram', 'tiktok']);
  });

  test('approval promotes the user to super tier with the granted rate', async () => {
    const app = await CreatorApplication.findByUserId(fx.userId);
    const res = mockRes();
    await adminReviewCreatorApplication(
      mockReq({ user: { id: fx.adminId, role: 'admin' }, params: { id: String(app.id) }, body: { decision: 'approve', rate: '0.05' } }),
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.application.status, 'approved');

    const [[user]] = await pool.query(`SELECT ambassadorTier, ambassadorRate, referralCode FROM users WHERE id = ?`, [fx.userId]);
    assert.equal(user.ambassadorTier, 'super');
    assert.equal(Number(user.ambassadorRate), 0.05);
    assert.ok(user.referralCode, 'approved creator has a referral code');
  });

  test('a rate above the platform commission is rejected', async () => {
    const res = mockRes();
    await applyAsCreator(mockReq({ user: { id: fx.user2Id }, body: { requestedRate: '0.9' } }), res);
    assert.equal(res.statusCode, 400);
  });

  test('reject marks the application rejected and does not promote', async () => {
    // user2 applies cleanly, then gets rejected
    await applyAsCreator(mockReq({ user: { id: fx.user2Id }, body: { pitch: 'hi' } }), mockRes());
    const app = await CreatorApplication.findByUserId(fx.user2Id);
    const res = mockRes();
    await adminReviewCreatorApplication(
      mockReq({ user: { id: fx.adminId, role: 'admin' }, params: { id: String(app.id) }, body: { decision: 'reject', note: 'audience too small' } }),
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.application.status, 'rejected');
    const [[user]] = await pool.query(`SELECT ambassadorTier FROM users WHERE id = ?`, [fx.user2Id]);
    assert.equal(user.ambassadorTier, 'standard');
  });

  test('getMyCreatorApplication returns the caller application', async () => {
    const res = mockRes();
    await getMyCreatorApplication(mockReq({ user: { id: fx.userId } }), res);
    assert.equal(res.body.application.status, 'approved');
  });
});
