// backend/migrateLoginWindow.js
// V-10 (P2): the login lockout counter never decayed.
//
// users.failed_login_attempts was an all-time counter that only a SUCCESSFUL
// login reset. After the first 10 failures locked the account for  hour, the
// counter stayed at (or above) 10 forever — so as soon as the lock expired a
// SINGLE bad password pushed it to 11 and re-locked for another hour. An
// attacker who knows a victim's email could therefore maintain a permanent
// lockout with one request per hour.
//
// last_failed_at makes the counter a rolling window instead:
//
//   * a failure more recent than LOGIN_FAILURE_WINDOW_MINUTES increments;
//   * a failure after a quiet period resets the count to 1;
//   * the lock itself is only reachable by LOGIN_LOCK_THRESHOLD failures
//     inside one window.
//
// Idempotent: safe to run more than once. The column is nullable and default
// NULL, so existing rows simply count as "no recent failure" (their counter
// decays on the next failure, which is exactly the desired recovery).
import pool from './config/db.js';

const run = async () => {
  const [[col]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_failed_at'`
  );
  if (Number(col.n) === 0) {
    await pool.execute(`ALTER TABLE users ADD COLUMN last_failed_at DATETIME NULL`);
    console.log(' Added users.last_failed_at column');
  } else {
    console.log(' users.last_failed_at column already exists');
  }
  console.log(' login failure window ready (V-10)');
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(' Migration failed:', err.message);
    process.exit(1);
  });
