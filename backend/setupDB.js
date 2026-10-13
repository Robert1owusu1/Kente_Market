// setupDB.js - Create the database and apply branding_house.sql using .env credentials.
// Run from backend/:  npm run db:setup
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { mysqlTls } from './config/mysqlTls.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbName = process.env.DB_NAME;
const sqlPath = path.resolve(__dirname, '..', 'branding_house.sql');

if (!dbName || !process.env.DB_USER) {
 console.error(' DB_NAME and DB_USER must be set in backend/.env');
  process.exit(1);
}

if (!fs.existsSync(sqlPath)) {
 console.error(` Schema file not found: ${sqlPath}`);
  process.exit(1);
}

// DROP DATABASE is unconditional — refuse to run it against anything but a
// database on this machine without an explicit, separate opt-in. Keying this
// on NODE_ENV alone was not enough: a developer .env that points at the
// hosted database usually leaves NODE_ENV unset, and `npm run db:setup`
// would then have dropped the live database.
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const isLocalHost = LOCAL_HOSTS.has(String(process.env.DB_HOST || '').trim());
if ((!isLocalHost || process.env.NODE_ENV === 'production') && process.env.ALLOW_DESTRUCTIVE_DB !== '1') {
  console.error(
' Refusing to DROP DATABASE: DB_HOST is not a local database (or NODE_ENV=production). ' +
    'If this is truly intended, re-run with ALLOW_DESTRUCTIVE_DB=1.'
  );
  process.exit(1);
}

if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
  console.error(` Refusing DB_NAME "${dbName}": only letters, digits and _ are allowed`);
  process.exit(1);
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 3306,
  ssl: mysqlTls(),
  multipleStatements: true,
});

try {
  // Drop existing tables so the schema file applies cleanly (idempotent setup)
  await connection.query(
    `DROP DATABASE IF EXISTS \`${dbName}\``
  );
 console.log(` Dropped existing database ${dbName} (if any)`);

  // branding_house.sql names its database; load it into DB_NAME instead, so
  // the database that was just dropped is the one that gets rebuilt.
  const schema = fs.readFileSync(sqlPath, 'utf8').replace(
    /^CREATE DATABASE IF NOT EXISTS branding_house;\s*USE branding_house;/m,
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\`;\nUSE \`${dbName}\`;`
  );
  await connection.query(schema);
 console.log(` Database ${dbName} created with schema from branding_house.sql`);
} catch (err) {
 console.error(' DB setup failed:', err.message);
  process.exit(1);
} finally {
  await connection.end();
}