// FILE LOCATION: backend/tests/moduleGraph.test.js
// DESCRIPTION: Every route module server.js mounts must load. An ESM link error
//              (importing a name a module does not export) is fatal at boot,
//              and the suites only import the modules they exercise — a broken
//              import in customRequestController.js once took the whole API down
//              while all other tests stayed green. No database is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.env.EMAIL_DISABLED = '1';
process.env.REDIS_URL = '';

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every route module (and everything it imports) links', async () => {
  const failures = [];
  const routesDir = join(backendDir, 'routes');
  for (const file of readdirSync(routesDir).filter((f) => f.endsWith('.js'))) {
    try {
      await import(join(routesDir, file));
    } catch (err) {
      failures.push(`routes/${file}: ${err.message}`);
    }
  }
  assert.deepEqual(failures, [], `modules failed to load:\n${failures.join('\n')}`);
});

test('server.js imports only modules that exist and link', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(join(backendDir, 'server.js'), 'utf8');
  const specifiers = [...src.matchAll(/^import\s+(?:[\s\S]*?\s+from\s+)?['"](\.\/[^'"]+)['"]/gm)].map((m) => m[1]);
  assert.ok(specifiers.length > 10, 'server.js imports were found');
  const failures = [];
  for (const spec of specifiers) {
    if (/sentry-init/.test(spec)) continue; // side-effect only, needs SENTRY_DSN
    try {
      await import(join(backendDir, spec));
    } catch (err) {
      failures.push(`${spec}: ${err.message}`);
    }
  }
  assert.deepEqual(failures, [], `server.js dependencies failed to load:\n${failures.join('\n')}`);
});

test('teardown', async () => {
  const pool = (await import('../config/db.js')).default;
  await pool.end().catch(() => {});
});
