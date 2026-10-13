// FILE LOCATION: backend/tests/oauthEmailVerification.test.js
// DESCRIPTION: SEC-12 — OAuth account linking must only trust an email the
//              provider says it has verified. Before, Google sign-in linked
//              (or adopted) an existing account purely by the email string, so
//              a Google identity carrying an UNVERIFIED copy of a customer's
//              address could take over that customer's account.
//              Calls the real resolver with crafted profiles; no network.
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

const TS = Date.now();
const fx = { victim: null, unverified: null };
const victimEmail = `oauth-victim-${TS}@example.com`;
const unverifiedEmail = `oauth-unverified-${TS}@example.com`;
const googleProfile = (id, email, verified) => ({
  id, displayName: 'Ama Mensah', name: { givenName: 'Ama', familyName: 'Mensah' },
  emails: [{ value: email, verified }], photos: [],
});

describe('OAuth email verification (SEC-12)', { skip: !dbAvailable }, () => {
  let findOrCreateOAuthUser;
  const row = async (id) => (await pool.execute(`SELECT googleId, password, tokenVersion FROM users WHERE id = ?`, [id]))[0][0];

  before(async () => {
    ({ findOrCreateOAuthUser } = await import('../config/passPort.js'));
    const mk = async (email, verified) => (await pool.execute(
      `INSERT INTO users (email, password, firstName, lastName, role, is_email_verified) VALUES (?, 'hash-x', 'O', 'A', 'customer', ?)`,
      [email, verified]
    ))[0].insertId;
    fx.victim = await mk(victimEmail, 1);
    fx.unverified = await mk(unverifiedEmail, 0);
  });

  after(async () => {
    await pool.execute(`DELETE FROM users WHERE id IN (?, ?) OR googleId LIKE ?`, [fx.victim, fx.unverified, `g-${TS}-%`]).catch(() => {});
    await pool.end();
  });

  test('an unverified provider email cannot link to an existing verified account', async () => {
    const user = await findOrCreateOAuthUser('google', googleProfile(`g-${TS}-1`, victimEmail, false), { allowCreate: true });
    assert.equal(user, null);
    assert.equal((await row(fx.victim)).googleId, null, 'victim account untouched');
  });

  test('an unverified provider email cannot adopt an unverified account (password not rotated)', async () => {
    const user = await findOrCreateOAuthUser('google', googleProfile(`g-${TS}-2`, unverifiedEmail, undefined), { allowCreate: true });
    assert.equal(user, null);
    const r = await row(fx.unverified);
    assert.equal(r.googleId, null);
    assert.equal(r.password, 'hash-x');
  });

  test('an unverified provider email does not create an account either', async () => {
    const fresh = `oauth-new-${TS}@example.com`;
    const user = await findOrCreateOAuthUser('google', googleProfile(`g-${TS}-3`, fresh, false), { allowCreate: true });
    assert.equal(user, null);
    const [rows] = await pool.execute(`SELECT id FROM users WHERE email = ?`, [fresh]);
    assert.equal(rows.length, 0);
  });

  test('a verified provider email still links normally', async () => {
    const user = await findOrCreateOAuthUser('google', googleProfile(`g-${TS}-4`, victimEmail, true), { allowCreate: false });
    assert.equal(user?.id, fx.victim);
    assert.equal((await row(fx.victim)).googleId, `g-${TS}-4`);
  });

  test('an identity already bound by provider id signs in even if the flag is absent', async () => {
    const user = await findOrCreateOAuthUser('google', googleProfile(`g-${TS}-4`, victimEmail, undefined), { allowCreate: false });
    assert.equal(user?.id, fx.victim);
  });
});
