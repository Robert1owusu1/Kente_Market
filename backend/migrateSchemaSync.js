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

const hasCheckConstraint = async (table, name) => {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS c FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'CHECK'`,
    [table, name]
  );
  return Number(row?.c || 0) > 0;
};

// I3 — product.stock had no CHECK constraint anywhere in the schema, and the
// four absolute writers (`stock = ?` from a request body) passed negatives
// straight through. Add the constraint for MySQL/MariaDB, keeping three
// properties that matter more than the DDL itself:
//
//   1. Clean the data FIRST. MySQL validates existing rows when the
//      constraint is added, so a single legacy `-3` row would abort the
//      ALTER — and since this is the last script in the `&&`-chained
//      `db:migrate`, that aborts the chain and leaves the schema partial.
//      That is exactly the N-5 failure mode, so we buy the fix here rather
//      than inherit the bug.
//   2. Idempotent: probe `information_schema` first so a re-run is a no-op.
//   3. Non-fatal on refusal. TiDB parses CHECK without enforcing it and some
//      managed MySQL variants reject `ADD CONSTRAINT` outright. A hard error
//      here would break `db:migrate` on a platform where the constraint was
//      never going to do anything anyway — the application-level clamp
//      (`utils/nonNegativeInt.js`) is what actually holds the invariant
//      there. Warn loudly and continue.
const addStockConstraint = async () => {
  if (await hasCheckConstraint('product', 'chk_product_stock_nonneg')) {
    console.log(' CHECK (stock >= 0) on product.stock already exists');
    return;
  }

  const [result] = await pool.execute(
    `UPDATE product SET stock = 0 WHERE stock < 0`
  );
  if (result.affectedRows > 0) {
    console.log(
      ` Normalised ${result.affectedRows} negative product.stock row(s) to 0 before adding the constraint`
    );
  }

  try {
    await pool.execute(
      `ALTER TABLE product ADD CONSTRAINT chk_product_stock_nonneg CHECK (stock >= 0)`
    );
    console.log(' Added CHECK (stock >= 0) on product.stock');
  } catch (err) {
    if (/duplicate|already exists|exist/i.test(err.message)) {
      console.log(' CHECK (stock >= 0) on product.stock already exists');
    } else {
      console.warn(
        ` WARNING: CHECK (stock >= 0) not added (${err.message}). ` +
          `The application clamp in utils/nonNegativeInt.js still applies, ` +
          `so this is not fatal — but the DB-level backstop is missing on this engine.`
      );
    }
  }
};

const run = async () => {
  if (!(await hasColumn('users', 'legal_consent_at'))) {
    await pool.execute(`ALTER TABLE users ADD COLUMN legal_consent_at DATETIME NULL`);
    console.log(' Added users.legal_consent_at column');
  } else {
    console.log(' users.legal_consent_at column already exists');
  }

  await addStockConstraint();

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
