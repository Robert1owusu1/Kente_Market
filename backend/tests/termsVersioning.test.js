// FILE LOCATION: backend/tests/termsVersioning.test.js
// DESCRIPTION: Terms/consent versioning — `legal_consent_at` alone is a
//              timestamp that cannot say WHICH revision was accepted, so a
//              Terms/Privacy update could never reach existing accounts.
//              terms_version + config/legalTerms.js (TERMS_VERSION) close
//              that:
//
//   * creation (email register or OAuth signup) records the current version;
//   * login (authUser) and profile (getUserProfile) answer
//     `needsReConsent: terms_version < TERMS_VERSION` — the two surfaces
//     from which the frontend ever learns who it is (password login sets
//     credentials from the auth response; OAuth/reload get it via
//     SyncUserRole's profile fetch);
//   * POST /accept-terms moves the caller forward, with the SERVER picking
//     the version (the body is never read — a client cannot claim a
//     revision it was not shown);
//   * the OAuth consent JWT carries a termsVersion claim checked by
//     isConsentTokenValid, so a token minted before a bump no longer opens
//     signup under the new revision;
//   * the frontend gate (TermsReconsentGate.tsx) blocks until accept.
//
// What this suite pins (real HTTP, real router, real MySQL):
//   1. registration records TERMS_VERSION on the new account;
//   2. a stale account (terms_version 0) logs in with needsReConsent: true;
//   3. a current account logs in with needsReConsent: false;
//   4. /accept-terms with the stale session moves the row to TERMS_VERSION
//      and re-stamps legal_consent_at;
//   5. the profile response agrees with the login response after accepting;
//   6. /accept-terms without a session → 401;
//   7. source pins: consent-JWT version claim, OAuth INSERT column, both
//      response surfaces carry the flag, acceptTerms ignores the body,
//      migration wired into db:migrate with its backfill inside the
//      add-column branch, usersModel.create records the version.
//
// NOTE: DB-backed; inserts then cleans up. Skips without MySQL. Requires
// users.terms_version (migrateTermsVersion.js — CI's db:setup runs it via
// the chain automatically).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.REDIS_URL = '';
process.env.EMAIL_DISABLED = '1';
process.env.JWT_SECRET ||= 'terms-versioning-secret-for-tests-only-not-a-key';
process.env.FRONTEND_URL ||= 'http://localhost:5173';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
  // The feature's whole substrate: without the column nothing below can
  // mean anything (and User.create would fail anyway).
  const [[col]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'terms_version'`,
  );
  if (Number(col.n) === 0) dbAvailable = false;
} catch {
  dbAvailable = false;
  pool = null;
}

const express = (await import('express')).default;
const cookieParser = (await import('cookie-parser')).default;
const userRoutes = (await import('../routes/userRoutes.js')).default;
const { TERMS_VERSION } = await import('../config/legalTerms.js');
const { startServer } = await import('./helpers/httpHarness.js');

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const RUN_ID = `tv-${Date.now()}`;
const EMAILS = {
  stale: `${RUN_ID}-stale@test.local`,
  fresh: `${RUN_ID}-fresh@test.local`,
  registered: `${RUN_ID}-registered@test.local`,
};
let server = null;
const userIds = [];

const call = async (method, path, { body, cookie } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  const setCookies = res.headers.getSetCookie();
  const session = setCookies.find((c) => /^jwt=/i.test(c));
  return {
    status: res.status,
    json,
    setCookies,
    cookie: session ? session.split(';')[0] : undefined,
  };
};

const getUserRow = async (email) => {
  const [rows] = await pool.execute(
    'SELECT id, terms_version, legal_consent_at FROM users WHERE email = ?',
    [email],
  );
  return rows[0] || null;
};

const PASSWORD = 'Passw0rd123';
// authenticate() bcrypt-compares against the stored column — fixtures must
// hold a real hash, not the literal (find out the hard way: 401s).
const PASSWORD_HASH = await (async () => {
  const bcrypt = (await import('bcryptjs')).default;
  return bcrypt.hashSync(PASSWORD, 4);
})();
const login = (email) =>
  call('POST', '/api/users/auth', { body: { email, password: PASSWORD } });

describe('Terms/consent versioning', { skip: !dbAvailable }, () => {
  before(async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/users', userRoutes);
    app.use((err, req, res, next) => {
      const status = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
      res.status(status).json({ message: err.message });
    });
    server = await startServer(app);

    // stale = consented long ago but never recorded a version (pre-versioning
    // row); fresh = already on the current version.
    const [stale] = await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified, tokenVersion, legal_consent_at, terms_version)
       VALUES ('Stale', 'Consenter', ?, ?, 'customer', 1, 1, 0, NOW(), 0)`,
      [EMAILS.stale, PASSWORD_HASH],
    );
    userIds.push(stale.insertId);
    const [fresh] = await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified, tokenVersion, legal_consent_at, terms_version)
       VALUES ('Fresh', 'Consenter', ?, ?, 'customer', 1, 1, 0, NOW(), ?)`,
      [EMAILS.fresh, PASSWORD_HASH, TERMS_VERSION],
    );
    userIds.push(fresh.insertId);
  });

  after(async () => {
    if (server) await server.close();
    if (pool) {
      try {
        if (userIds.length) {
          await pool.execute(
            `DELETE FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`,
            userIds,
          );
        }
        await pool.execute('DELETE FROM users WHERE email = ?', [EMAILS.registered]);
      } catch (e) {
        console.error('termsVersioning cleanup:', e.message);
      }
      try { await pool.end(); } catch { /* already closed */ }
    }
    try {
      const { getRedisClient } = await import('../utils/redisClient.js');
      const redis = getRedisClient();
      if (redis) {
        await Promise.race([
          redis.quit().catch(() => Promise.resolve()),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
        redis.disconnect();
      }
    } catch { /* Redis not configured — nothing to close */ }
  });

  test('registration records the current TERMS_VERSION on the new account', async () => {
    const r = await call('POST', '/api/users', {
      body: {
        firstName: 'Current',
        lastName: 'Consenter',
        email: EMAILS.registered,
        password: PASSWORD,
        legalConsentAccepted: true,
        role: 'customer',
      },
    });
    assert.equal(r.status, 202, JSON.stringify(r.json));
    const row = await getUserRow(EMAILS.registered);
    assert.ok(row, 'the new account was not created');
    assert.equal(row.terms_version, TERMS_VERSION,
      'a new registration recorded no version — the next Terms bump could never reach it');
    assert.ok(row.legal_consent_at, 'consent timestamp missing');
  });

  test('a stale account (terms_version 0) logs in flagged for re-consent', async () => {
    const r = await login(EMAILS.stale);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.needsReConsent, true,
      'a stale account was not flagged — it would sail past the gate forever');
    assert.ok(r.cookie, 'login did not establish a session');
  });

  test('a current account logs in with needsReConsent: false (the flag exists on both)', async () => {
    const r = await login(EMAILS.fresh);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal('needsReConsent' in r.json, true, 'login response omits the flag entirely');
    assert.equal(r.json.needsReConsent, false);
  });

  test('POST /accept-terms moves the stale session forward, server-side', async () => {
    const staleLogin = await login(EMAILS.stale);
    assert.ok(staleLogin.cookie, 'no session for the stale account');

    const rowBefore = await getUserRow(EMAILS.stale);
    assert.equal(rowBefore.terms_version, 0, 'fixture precondition: stale row must start at 0');

    const accept = await call('POST', '/api/users/accept-terms', { cookie: staleLogin.cookie });
    assert.equal(accept.status, 200, JSON.stringify(accept.json));
    assert.equal(accept.json.termsVersion, TERMS_VERSION,
      'the reply must report the version the SERVER recorded');
    assert.equal(accept.json.needsReConsent, false);

    const rowAfter = await getUserRow(EMAILS.stale);
    assert.equal(rowAfter.terms_version, TERMS_VERSION,
      'the row did not move forward — every login would keep flagging');
    assert.ok(rowAfter.legal_consent_at, 'accept must re-stamp legal_consent_at (it IS a fresh acceptance)');

    // A body claiming some other version must be ignored entirely.
    const rogue = await login(EMAILS.fresh);
    const spoofed = await call('POST', '/api/users/accept-terms', {
      cookie: rogue.cookie,
      body: { termsVersion: 999 },
    });
    assert.equal(spoofed.status, 200);
    assert.equal(spoofed.json.termsVersion, TERMS_VERSION,
      'a client-supplied version leaked into the server answer');
  });

  test('profile response agrees with login after accepting (both doors carry the flag)', async () => {
    const staleLogin = await login(EMAILS.stale);
    await call('POST', '/api/users/accept-terms', { cookie: staleLogin.cookie });

    const profile = await call('GET', '/api/users/profile', { cookie: staleLogin.cookie });
    assert.equal(profile.status, 200, JSON.stringify(profile.json));
    assert.equal('needsReConsent' in profile.json, true,
      'profile omits the flag — OAuth and reload sessions would never see the gate');
    assert.equal(profile.json.needsReConsent, false);

    const relogin = await login(EMAILS.stale);
    assert.equal(relogin.json.needsReConsent, false, 'login still flags after accepting');
  });

  test('/accept-terms without a session → 401', async () => {
    const r = await call('POST', '/api/users/accept-terms');
    assert.equal(r.status, 401);
  });

  test('source: consent JWT, OAuth INSERT, both response surfaces, body-blind accept, migration wiring', () => {
    // 1. The OAuth consent token is bound to the CURRENT revision.
    const authRoutes = read('../routes/authRoutes.js');
    const signAt = authRoutes.indexOf('const signConsentToken');
    const verifyAt = authRoutes.indexOf('const isConsentTokenValid');
    assert.ok(signAt !== -1 && verifyAt > signAt, 'consent token helpers not found');
    const signBlock = authRoutes.slice(signAt, verifyAt);
    const verifyBlock = authRoutes.slice(verifyAt, verifyAt + 400);
    assert.match(signBlock, /termsVersion:\s*TERMS_VERSION/,
      'the consent JWT is not version-bound — an old token would survive a Terms bump');
    assert.match(verifyBlock, /decoded\.termsVersion === TERMS_VERSION/,
      'isConsentTokenValid does not check the revision');

    // 2. New OAuth signups record the version.
    const passPort = read('../config/passPort.js');
    assert.match(passPort, /INSERT INTO users \([^)]*terms_version\)/,
      'the OAuth signup INSERT does not record terms_version');
    assert.match(passPort, /consentAt, TERMS_VERSION\]/,
      'the OAuth signup INSERT does not pass the current version');

    // 3. BOTH surfaces the frontend reads carry the flag.
    const userController = read('../controllers/userController.js');
    const authBlock = userController.slice(
      userController.indexOf('const authUser'),
      userController.indexOf('const registerUser'),
    );
    assert.match(authBlock, /needsReConsent:\s*\(user\.termsVersion/,
      'login does not answer needsReConsent');
    const profileBlock = userController.slice(
      userController.indexOf('const getUserProfile'),
      userController.indexOf('const updateUserProfile'),
    );
    assert.match(profileBlock, /needsReConsent:\s*\(user\.termsVersion/,
      'profile does not answer needsReConsent — OAuth/reload sessions never learn of a bump');

    // 4. acceptTerms is body-blind: the version comes from the server.
    const acceptAt = userController.indexOf('const acceptTerms');
    assert.ok(acceptAt !== -1, 'acceptTerms controller not found');
    const acceptBlock = userController.slice(acceptAt, acceptAt + 900);
    assert.ok(!/req\.body/.test(acceptBlock),
      'acceptTerms reads req.body — a client could claim an arbitrary revision');
    assert.match(acceptBlock, /\[TERMS_VERSION, userId\]/,
      'acceptTerms does not write the server-side version');

    // 5. Creation records the version too (email path).
    const usersModel = read('../models/usersModel.js');
    const createAt = usersModel.indexOf('legalConsentAccepted === true');
    assert.ok(createAt !== -1);
    assert.match(usersModel.slice(createAt, createAt + 500), /terms_version = TERMS_VERSION/,
      'usersModel.create does not record which version was accepted');

    // 6. Migration: in the chain, guarded, backfill one-time inside the
    //    add-column branch (so re-running can never force a false consent).
    const pkg = JSON.parse(read('../package.json'));
    assert.match(pkg.scripts['db:migrate'], /node migrateTermsVersion\.js/,
      'migrateTermsVersion.js is not wired into db:migrate');
    const migration = read('../migrateTermsVersion.js');
    assert.match(migration, /INFORMATION_SCHEMA\.COLUMNS/, 'column add is not guarded');
    const addAt = migration.indexOf('ALTER TABLE users ADD COLUMN terms_version');
    const backfillAt = migration.indexOf('terms_version = 1 WHERE legal_consent_at');
    const elseAt = migration.indexOf('} else {');
    assert.ok(addAt !== -1 && backfillAt !== -1 && elseAt !== -1,
      'migration structure changed — guard/backfill/else not found');
    assert.ok(backfillAt > addAt && backfillAt < elseAt,
      'the grandfather backfill escaped the add-column branch — re-running could grant consent that never happened');
  });
});
