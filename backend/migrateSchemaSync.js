// backend/migrateSchemaSync.js
// N-11 companion: bring a database created from `branding_house.sql` up to the
// schema the CODE actually requires.
//
// The dump had drifted behind the code, and `npm run db:migrate` did not cover
// the gap. Building a fresh database (CI's service container, a new deploy, a
// contributor's local MySQL) therefore produced a schema in which:
//
//   * users.legal_consent_at was missing — registration, the OAuth consent
//     path and 5 test suites failed with ER_BAD_FIELD_ERROR. The column existed
//     only on databases that had been created when the dump still matched.
//   * `sessions` (express-mysql-session, server.js) was missing — the store
//     creates it lazily at boot, so a fresh database was incomplete until the
//     app had been started at least once.
//
// Everything here is an existence-checked, idempotent DDL statement that runs
// on MySQL, MariaDB and TiDB alike (no `ADD COLUMN IF NOT EXISTS`, which stock
// MySQL rejects).
import pool from './config/db.js';

const hasColumn = async (table, column) => {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(row?.c || 0) > 0;
};

const hasTable = async (table) => {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(row?.c || 0) > 0;
};

const run = async () => {
  if (!(await hasColumn('users', 'legal_consent_at'))) {
    await pool.execute(`ALTER TABLE users ADD COLUMN legal_consent_at DATETIME NULL`);
    console.log(' Added users.legal_consent_at column');
  } else {
    console.log(' users.legal_consent_at column already exists');
  }

  if (!(await hasTable('sessions'))) {
    // utf8mb4_bin is deliberate: session ids are case-sensitive, so the
    // PRIMARY KEY lookup must not fold 'AbC' and 'abc'.
    await pool.execute(
      `CREATE TABLE IF NOT EXISTS sessions (
         session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
         expires INT UNSIGNED NOT NULL,
         data MEDIUMTEXT COLLATE utf8mb4_bin,
         PRIMARY KEY (session_id)
       ) ENGINE=InnoDB`
    );
    console.log(' Created sessions table (express-mysql-session store)');
  } else {
    console.log(' sessions table already exists');
  }

  console.log(' schema synced with code (N-11)');
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(' Migration failed:', err.message);
    process.exit(1);
  });
