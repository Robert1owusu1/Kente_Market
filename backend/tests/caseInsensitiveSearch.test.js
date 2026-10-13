// FILE LOCATION: backend/tests/caseInsensitiveSearch.test.js
// DESCRIPTION: TIDB-COLL — the hosted TiDB database uses utf8mb4_bin (binary,
//   case-sensitive) for every text column, unlike MySQL's case-insensitive
//   default. Verified read-only on the development database: title LIKE
//   '%kente%' -> 0 rows, LIKE '%Kente%' -> 1. Customer product search, admin
//   user/order search, the vendor directory and referral search all used plain
//   LIKE, so on TiDB a lower-case search missed capitalised names.
//   Every free-text search now compares LOWER(column) with a lower-cased term.
//   The behavioural cases are trivially true on a case-insensitive MySQL
//   collation; they are the real proof when the suite runs on TiDB
//   (scratch-database runs). The source guard holds on every engine.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.EMAIL_DISABLED = '1';
process.env.REDIS_URL = '';

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every free-text LIKE search lower-cases the column (source guard)', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.js')) continue;
      const lines = readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        for (const m of line.matchAll(/([\w.${}`]+\)?)\s+LIKE\s+\?/g)) {
          const col = m[1];
          // Not user text: o.items LIKE matches numeric JSON ids (vendor
          // scoping); orders.notes LIKE is the exact fixture marker the
          // reservation sweeper's test-scoping option takes.
          if (/^LOWER\(|\)$/.test(col) || /items$/.test(col) || col === 'notes') continue;
          offenders.push(`${relative(backendDir, full)}:${i + 1} ${col} LIKE ?`);
        }
      });
    }
  };
  for (const d of ['controllers', 'models', 'Services', 'routes', 'utils']) walk(join(backendDir, d));
  assert.deepEqual(offenders, []);
});

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

describe('searches match regardless of letter case', { skip: !dbAvailable && 'no database' }, () => {
  const TS = Date.now();
  const tag = `Qzx${TS}`; // unique token, mixed case
  const fx = { product: 0, user: 0 };
  let Product;
  let User;

  before(async () => {
    Product = (await import('../models/productModel.js')).default;
    User = (await import('../models/usersModel.js')).default;
    const [p] = await pool.execute(
      `INSERT INTO product (title, img, price, category, stock, approvalStatus)
       VALUES (?, '/x.png', 100, 'Kente', 5, 'approved')`, [`Royal Kente ${tag}`]
    );
    fx.product = p.insertId;
    const [u] = await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
       VALUES (?, 'Mensah', ?, 'x', 'customer', 1, 1)`, [`Akosua${tag}`, `case-${TS}@example.test`]
    );
    fx.user = u.insertId;
  });

  after(async () => {
    await pool.execute(`DELETE FROM product WHERE id = ?`, [fx.product]).catch(() => {});
    await pool.execute(`DELETE FROM users WHERE id = ?`, [fx.user]).catch(() => {});
    await pool.end().catch(() => {});
  });

  test('product search: lower-case and upper-case queries find a capitalised title', async () => {
    for (const q of [`kente ${tag.toLowerCase()}`, `KENTE ${tag.toUpperCase()}`, `Kente ${tag}`]) {
      const res = await Product.findAll({ search: q, limit: 10 });
      const list = Array.isArray(res) ? res : (res.products || res.rows || []);
      assert.ok(list.some((p) => Number(p.id) === fx.product), `search "${q}" must find the product`);
    }
  });

  test('admin user search is case-insensitive', async () => {
    const res = await User.findAll({ search: `akosua${tag.toLowerCase()}`, limit: 10 });
    const list = Array.isArray(res) ? res : (res.users || res.rows || []);
    assert.ok(list.some((u) => Number(u.id) === fx.user), 'lower-case search must find "Akosua…"');
  });
});
