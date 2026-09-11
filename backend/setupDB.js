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
  console.error('❌ DB_NAME and DB_USER must be set in backend/.env');
  process.exit(1);
}

if (!fs.existsSync(sqlPath)) {
  console.error(`❌ Schema file not found: ${sqlPath}`);
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
  console.log(`🗑️ Dropped existing database ${dbName} (if any)`);

  const schema = fs.readFileSync(sqlPath, 'utf8');
  await connection.query(schema);
  console.log(`✅ Database ${dbName} created with schema from branding_house.sql`);
} catch (err) {
  console.error('❌ DB setup failed:', err.message);
  process.exit(1);
} finally {
  await connection.end();
}