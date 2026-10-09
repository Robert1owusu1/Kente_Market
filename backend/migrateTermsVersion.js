// backend/migrateTermsVersion.js
// Terms/consent versioning (report §8): users carried `legal_consent_at`,
// a timestamp that cannot tell WHICH terms were accepted — so a future
// Terms/Privacy revision would have had no way to ask anyone to re-consent.
//
// terms_version pairs with config/legalTerms.js (TERMS_VERSION):
//   * new registrations (email or OAuth signup) record the current version;
//   * login and profile answer `needsReConsent: terms_version < TERMS_VERSION`;
//   * POST /api/users/accept-terms moves a user to the current version.
//
// Backfill is ONE-TIME and lives inside the add-column branch: everyone who
// already consented is grandfathered into v1, because the terms as published
// have NOT changed — forcing a re-consent storm on deploy over identical
// text would teach users to click through consent, which is the opposite of
// what consent is for. When TERMS_VERSION legitimately becomes 2, the
// comparison flags every row below 2 by itself; this script must never be
// re-run to "help" with that (running it on a database where the column
// exists is a no-op anyway — see the else branch).
//
// Idempotent: the column add is guarded by INFORMATION_SCHEMA, and the
// backfill only runs when the column was actually just created.
import pool from './config/db.js';
import { TERMS_VERSION } from './config/legalTerms.js';

const run = async () => {
  const [[col]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'terms_version'`
  );
  if (Number(col.n) === 0) {
    await pool.execute(`ALTER TABLE users ADD COLUMN terms_version INT NOT NULL DEFAULT 0`);
    // Grandfather: consented BEFORE versioning existed = accepted the terms
    // as they stand (v1). Hard-coded 1 on purpose — it is a historical fact
    // about the published documents, not a read of TERMS_VERSION (which may
    // legitimately be higher on some future run).
    await pool.execute(
      `UPDATE users SET terms_version = 1 WHERE legal_consent_at IS NOT NULL AND terms_version = 0`
    );
    console.log(' Added users.terms_version column; grandfathered consented rows to v1');
  } else {
    console.log(' users.terms_version column already exists');
  }
  console.log(` Terms versioning ready (TERMS_VERSION=${TERMS_VERSION})`);
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(' Migration failed:', err.message);
    process.exit(1);
  });
