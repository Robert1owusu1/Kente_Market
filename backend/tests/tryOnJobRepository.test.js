// FILE LOCATION: backend/tests/tryOnJobRepository.test.js
// DESCRIPTION: DB-backed. The real SQL behind AI try-on job tracking
//              (Services/tryOn/jobRepository.js, migrateTryOnJobs.js) and the
//              real product-eligibility query (Services/tryOn/garment.js),
//              against MySQL/TiDB. Skips itself when no database is reachable
//              or when ai_tryon_jobs has not been migrated — a skip is
//              reported as a skip, never as a pass.
//
// Proves what the in-memory fakes cannot: the compare-and-set UPDATEs, the
// unique idempotency key, a single poll winner under concurrency, deadline
// arithmetic in SQL, and the vendor-visibility guard in the product query.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.EMAIL_DISABLED = '1';
process.env.REDIS_URL = '';

let pool = null;
let dbAvailable = true;
let skipReason = '';
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
  const [[t]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_tryon_jobs'`,
  );
  if (!t.n) { dbAvailable = false; skipReason = 'ai_tryon_jobs not migrated (run npm run db:migrate)'; }
} catch {
  dbAvailable = false;
  skipReason = 'no database';
}

const { default: repo } = await import('../Services/tryOn/jobRepository.js');
const { loadTryOnProduct } = await import('../Services/tryOn/garment.js');

const TS = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
const fx = { users: [], vendors: [], products: [], jobIds: [] };

const newJob = async (over = {}) => {
  const row = {
    id: crypto.randomUUID(),
    userId: fx.users[0],
    productId: fx.products[0],
    vendorId: fx.vendors[0],
    provider: 'scripted',
    idempotencyKey: `k-${TS}-${fx.jobIds.length}`,
    garmentCategory: 'upper_body',
    timeoutMinutes: 10,
    ...over,
  };
  await repo.insert(row);
  fx.jobIds.push(row.id);
  return row.id;
};

describe(`ai_tryon_jobs repository (real SQL)${dbAvailable ? '' : ` — SKIPPED: ${skipReason}`}`, { skip: !dbAvailable }, () => {
  before(async () => {
    if (!dbAvailable) return;
    for (const role of ['customer', 'customer', 'vendor', 'vendor']) {
      const [u] = await pool.execute(
        `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
         VALUES ('TRYON', ?, ?, 'hashed', ?, 1, 1)`,
        [role, `tryon-${role}-${TS}-${fx.users.length}@test.local`, role],
      );
      fx.users.push(u.insertId);
    }
    const [approvedVendor, suspendedVendor] = [fx.users[2], fx.users[3]];
    await pool.execute(`INSERT INTO vendors (userId, businessName, status) VALUES (?, ?, 'approved')`, [approvedVendor, `TRYON OK ${TS}`]);
    await pool.execute(`INSERT INTO vendors (userId, businessName, status) VALUES (?, ?, 'suspended')`, [suspendedVendor, `TRYON SUSP ${TS}`]);
    fx.vendors.push(approvedVendor, suspendedVendor);
    for (const [title, vendorId, approval] of [
      ['Adinkra Stole', approvedVendor, 'approved'],
      ['Suspended Vendor Stole', suspendedVendor, 'approved'],
      ['Pending Stole', approvedVendor, 'pending'],
      ['Platform Stole', null, 'approved'],
      ['Kente Table Runner', approvedVendor, 'approved'],
    ]) {
      const [p] = await pool.execute(
        `INSERT INTO product (title, img, price, category, stock, vendorId, madeToOrder, approvalStatus)
         VALUES (?, '/images/image2.jpeg', 100.0, 'Double Weaving', 5, ?, 0, ?)`,
        [`${title} ${TS}`, vendorId, approval],
      );
      fx.products.push(p.insertId);
    }
  });

  after(async () => {
    if (!dbAvailable) return;
    const del = async (sql, params) => { try { await pool.execute(sql, params); } catch (e) { console.warn('cleanup:', e.message); } };
    if (fx.jobIds.length) await del(`DELETE FROM ai_tryon_jobs WHERE id IN (${fx.jobIds.map(() => '?').join(',')})`, fx.jobIds);
    await del(`DELETE FROM ai_tryon_usage WHERE userId IN (?, ?)`, [fx.users[0], fx.users[1]]);
    if (fx.products.length) await del(`DELETE FROM product WHERE id IN (${fx.products.map(() => '?').join(',')})`, fx.products);
    for (const v of fx.vendors) await del(`DELETE FROM vendors WHERE userId = ?`, [v]);
    if (fx.users.length) await del(`DELETE FROM users WHERE id IN (${fx.users.map(() => '?').join(',')})`, fx.users);
    await pool.end();
  });

  test('product eligibility SQL applies the same visibility as the public product page', async () => {
    const [ok, suspended, pending, platform, runner] = fx.products;
    const a = await loadTryOnProduct(ok);
    assert.equal(a.productId, ok);
    assert.equal(a.vendorId, fx.vendors[0]);
    const p = await loadTryOnProduct(platform);
    assert.equal(p.vendorId, null, 'platform products (no vendor) stay eligible');
    for (const hidden of [suspended, pending, 999_999_999]) {
      await assert.rejects(() => loadTryOnProduct(hidden), (e) => e.statusCode === 404, `product ${hidden}`);
    }
    await assert.rejects(() => loadTryOnProduct(runner), (e) => e.statusCode === 422);
  });

  test('a repeated idempotency key is a unique-key violation; another user may reuse it', async () => {
    const key = `dup-${TS}`;
    await newJob({ idempotencyKey: key });
    await assert.rejects(() => newJob({ idempotencyKey: key }), (e) => e.code === 'ER_DUP_ENTRY');
    await newJob({ idempotencyKey: key, userId: fx.users[1] });
    const found = await repo.findByIdempotencyKey(fx.users[0], key);
    assert.equal(found.status, 'queued');
    assert.equal(found.productId, fx.products[0]);
  });

  test('transitions are compare-and-set: a finished job cannot be moved again', async () => {
    const id = await newJob();
    assert.equal(await repo.markSubmitted(id, `prov-${id}`, 0), true);
    assert.equal(await repo.markSubmitted(id, 'other', 0), false, 'already submitted');
    assert.equal(await repo.markSucceeded(id, `${id}.jpg`, 24), true);
    assert.equal(await repo.markSucceeded(id, 'again.jpg', 24), false, 'a repeated completion is a no-op');
    assert.equal(await repo.markEnded(id, 'failed', 'generation_failed'), false, 'a late failure cannot overwrite success');
    const job = await repo.findById(id);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.resultKey, `${id}.jpg`);
    assert.ok(job.expiresAt > job.completedAt);
    assert.equal(await repo.markResultExpired(id), true);
    assert.equal((await repo.findById(id)).resultKey, null);
    assert.equal((await repo.findByProviderJob('scripted', `prov-${id}`)).id, id);
  });

  test('exactly one concurrent caller wins a poll claim', async () => {
    const id = await newJob();
    await repo.markSubmitted(id, `prov-${id}`, 0);
    await pool.execute(`UPDATE ai_tryon_jobs SET nextPollAt = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id = ?`, [id]);
    const wins = await Promise.all(Array.from({ length: 6 }, () => repo.claimPoll(id)));
    assert.equal(wins.filter(Boolean).length, 1);
    const job = await repo.findById(id);
    assert.equal(job.pollAttempts, 1);
    assert.ok(new Date(job.nextPollAt).getTime() > Date.now() - 1000, 'the next poll is pushed into the future');
  });

  test('poll backoff is 5, 10, 20, 30, 30 seconds', async () => {
    const id = await newJob();
    await repo.markSubmitted(id, `prov-b-${id}`, 0);
    const gaps = [];
    for (let i = 0; i < 5; i++) {
      await pool.execute(`UPDATE ai_tryon_jobs SET nextPollAt = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id = ?`, [id]);
      assert.equal(await repo.claimPoll(id), true);
      const [[row]] = await pool.execute(`SELECT TIMESTAMPDIFF(SECOND, NOW(), nextPollAt) AS gap FROM ai_tryon_jobs WHERE id = ?`, [id]);
      gaps.push(Number(row.gap));
    }
    // TIMESTAMPDIFF truncates, so allow one second of slack per step.
    const expected = [5, 10, 20, 30, 30];
    gaps.forEach((g, i) => assert.ok(g === expected[i] || g === expected[i] - 1, `step ${i}: ${g}s, expected ${expected[i]}s (all: ${gaps})`));
  });

  test('active-job counting, deadlines, interrupted submits and result expiry are found by SQL', async () => {
    const user = fx.users[1];
    const activeBefore = await repo.countActive(user);
    const live = await newJob({ userId: user });
    const late = await newJob({ userId: user });
    await pool.execute(`UPDATE ai_tryon_jobs SET deadlineAt = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?`, [late]);
    assert.equal(await repo.countActive(user), activeBefore + 1, 'a job past its deadline no longer holds capacity');

    assert.ok((await repo.listPastDeadline(500)).some((j) => j.id === late));
    await pool.execute(`UPDATE ai_tryon_jobs SET createdAt = DATE_SUB(NOW(), INTERVAL 10 MINUTE) WHERE id = ?`, [live]);
    assert.ok((await repo.listStaleQueued(120, 500)).some((j) => j.id === live));

    const done = await newJob({ userId: user });
    await repo.markSubmitted(done, `prov-${done}`, 0);
    await repo.markSucceeded(done, `${done}.jpg`, 1);
    await pool.execute(`UPDATE ai_tryon_jobs SET expiresAt = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?`, [done]);
    assert.ok((await repo.listExpiredResults(500)).some((j) => j.id === done));
    assert.deepEqual([...(await repo.liveResultIds([done, live]))], [done]);
  });

  test('only unsubmitted jobs can be deleted; ended metadata is purged after retention', async () => {
    const queued = await newJob();
    const submitted = await newJob();
    await repo.markSubmitted(submitted, `prov-${submitted}`, 0);
    await repo.deleteUnsubmitted(queued);
    await repo.deleteUnsubmitted(submitted);
    assert.equal(await repo.findById(queued), null);
    assert.ok(await repo.findById(submitted), 'a job the provider knows about must keep its record');

    await repo.markEnded(submitted, 'failed', 'generation_failed');
    await pool.execute(`UPDATE ai_tryon_jobs SET updatedAt = DATE_SUB(NOW(), INTERVAL 40 DAY) WHERE id = ?`, [submitted]);
    assert.ok((await repo.purgeEnded(30, 500)) >= 1);
    assert.equal(await repo.findById(submitted), null);
  });

  test('owner-scoped lookup does not return another user\'s job', async () => {
    const id = await newJob();
    assert.ok(await repo.findForUser(id, fx.users[0]));
    assert.equal(await repo.findForUser(id, fx.users[1]), null);
  });

  test('the daily credit counter stops at the limit', async () => {
    const user = fx.users[1];
    await pool.execute(`DELETE FROM ai_tryon_usage WHERE userId = ?`, [user]);
    assert.equal(await repo.reserveDailyCredit(user, 2), true);
    assert.equal(await repo.reserveDailyCredit(user, 2), true);
    assert.equal(await repo.reserveDailyCredit(user, 2), false);
  });

  test('the table has no column that could hold photo bytes or provider text', async () => {
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME AS c, DATA_TYPE AS t, CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_tryon_jobs'`,
    );
    for (const { c, t, len } of cols) {
      assert.ok(!/blob|text|json/i.test(t), `${c} is ${t}`);
      assert.ok(len === null || len <= 128, `${c} is wide enough for image data (${len})`);
    }
  });
});
