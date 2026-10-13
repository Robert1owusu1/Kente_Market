// FILE LOCATION: backend/tests/frontendOrigins.test.js
// DESCRIPTION: CFG-1 — FRONTEND_URL is a comma-separated CORS/CSRF allow-list,
//   but eight call sites interpolated the raw value into links and redirects
//   (password reset, OAuth callback/errors, Paystack callback_url, referral
//   link, emails), so a second origin broke all of them; a trailing slash made
//   the allow-list reject the real Origin header. One reader now owns it.
//   No database needed.
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frontendOrigins, frontendBaseUrl } from '../config/frontendOrigins.js';

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const saved = process.env.FRONTEND_URL;
afterEach(() => {
  if (saved === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = saved;
});

describe('frontendOrigins / frontendBaseUrl', () => {
  test('first origin is the link base; every origin is allowed; slashes and blanks normalized', () => {
    process.env.FRONTEND_URL = ' https://kente.example/ , https://staging.kente.example//,, ';
    assert.deepEqual(frontendOrigins(), ['https://kente.example', 'https://staging.kente.example']);
    assert.equal(frontendBaseUrl(), 'https://kente.example');
    assert.equal(`${frontendBaseUrl()}/reset-password/abc`, 'https://kente.example/reset-password/abc');
  });

  test('unset or blank -> no origins and an empty base (callers keep their dev fallback)', () => {
    delete process.env.FRONTEND_URL;
    assert.deepEqual(frontendOrigins(), []);
    assert.equal(frontendBaseUrl(), '');
    process.env.FRONTEND_URL = ' , ';
    assert.equal(frontendBaseUrl(), '');
  });
});

test('no runtime code reads process.env.FRONTEND_URL except the reader and the boot check', () => {
  const allowed = new Set(['config/frontendOrigins.js']);
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', 'tests', 'uploads', 'scripts'].includes(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.js')) continue;
      const rel = relative(backendDir, full);
      if (allowed.has(rel)) continue;
      const code = readFileSync(full, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
      if (/process\.env\.FRONTEND_URL/.test(code)) offenders.push(rel);
    }
  };
  walk(backendDir);
  assert.deepEqual(offenders, [], 'use config/frontendOrigins.js');
});

describe('production boot refuses a malformed FRONTEND_URL', () => {
  const boot = (frontendUrl) => spawnSync(process.execPath, ['server.js'], {
    cwd: backendDir,
    encoding: 'utf8',
    timeout: 20000,
    env: {
      // Every key backend/.env could inject is set, so dotenv adds nothing;
      // the DB points at a closed loopback port (never a real database).
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      FRONTEND_URL: frontendUrl,
      JWT_SECRET: 'boot-test-jwt-secret-0123456789abcdef',
      SESSION_SECRET: 'boot-test-session-secret-0123456789abcdef',
      PAYSTACK_SECRET_KEY: 'sk_test_boot_placeholder',
      DB_HOST: '127.0.0.1', DB_PORT: '9', DB_USER: 'none', DB_PASSWORD: 'none', DB_NAME: 'none', DB_SSL: '',
      TRUST_PROXY: '0', COOKIE_SAME_SITE: 'lax', REDIS_URL: '', SENTRY_DSN: '', EMAIL_DISABLED: '1',
      EMAIL_USER: '', EMAIL_PASSWORD: '', EMAIL_SERVICE: '', EMAIL_FROM: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '',
      OAUTH_CALLBACK_URL: '', REPLICATE_API_TOKEN: '', AI_TRYON_DAILY_LIMIT: '1', PORT: '0',
    },
  });

  for (const bad of ['https://kente.example/shop', 'http://kente.example', 'kente.example', 'https://ok.example,https://bad.example/x']) {
    test(`refuses ${JSON.stringify(bad)}`, () => {
      const r = boot(bad);
      assert.equal(r.status, 1, `exit ${r.status} signal ${r.signal}\n${r.stderr.slice(-400)}`);
      assert.match(r.stderr + r.stdout, /FRONTEND_URL entries must be bare https origins/);
    });
  }
});
