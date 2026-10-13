// FILE LOCATION: backend/tests/notificationTypes.test.js
// DESCRIPTION: NOTIF-1 — custom-request ('custom') and buyback ('buyback')
//   notifications were created with types the notifications.type ENUM did not
//   allow; strict SQL mode rejected every INSERT ("Data truncated for column
//   'type'") and the model swallowed the error, so those notifications were
//   never stored. Proves both now persist, and that every type literal passed
//   to Notification.create in application code is allowed by the live schema.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.EMAIL_DISABLED = '1';
process.env.REDIS_URL = '';

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..');
let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
}

/** Every `type: '<literal>'` inside a Notification.create({...}) call in app code. */
const typesUsedInCode = () => {
  const found = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', 'tests', 'uploads'].includes(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.js')) continue;
      const src = readFileSync(full, 'utf8');
      for (const m of src.matchAll(/Notification\.create\(\{([\s\S]{0,400}?)\}\)/g)) {
        const t = /type:\s*['"]([a-z_]+)['"]/.exec(m[1]);
        if (t) found.add(t[1]);
      }
    }
  };
  for (const d of ['controllers', 'Services', 'utils', 'routes', 'models']) walk(join(backendDir, d));
  return found;
};

describe('notification types (NOTIF-1)', { skip: !dbAvailable && 'no database' }, () => {
  const TS = Date.now();
  let userId = 0;
  let Notification;

  before(async () => {
    Notification = (await import('../models/notificationModel.js')).default;
    const [u] = await pool.execute(
      `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
       VALUES ('Notif', 'Types', ?, 'x', 'customer', 1, 1)`, [`notif-types-${TS}@example.test`]
    );
    userId = u.insertId;
  });

  after(async () => {
    await pool.execute(`DELETE FROM notifications WHERE userId = ?`, [userId]).catch(() => {});
    await pool.execute(`DELETE FROM users WHERE id = ?`, [userId]).catch(() => {});
    await pool.end().catch(() => {});
  });

  test('every type literal used with Notification.create is allowed by notifications.type', async () => {
    const [[col]] = await pool.query(
      `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'type'`
    );
    const allowed = new Set([...String(col.t).matchAll(/'([^']*)'/g)].map((m) => m[1]));
    const used = typesUsedInCode();
    assert.ok(used.has('custom') && used.has('buyback') && used.has('system'), `scanner found ${[...used]}`);
    assert.deepEqual([...used].filter((t) => !allowed.has(t)), [], `schema allows ${[...allowed]}`);
  });

  test('custom-request and buyback notifications are actually stored', async () => {
    for (const type of ['custom', 'buyback']) {
      await Notification.create({ userId, type, title: `t-${type}`, message: 'm', link: null });
    }
    const [rows] = await pool.execute(`SELECT type FROM notifications WHERE userId = ?`, [userId]);
    // (ORDER BY on an ENUM sorts by member position, so sort here.)
    assert.deepEqual(rows.map((r) => r.type).sort(), ['buyback', 'custom']);
  });
});
