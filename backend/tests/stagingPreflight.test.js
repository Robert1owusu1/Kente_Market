// FILE LOCATION: backend/tests/stagingPreflight.test.js
// DESCRIPTION: scripts/staging-preflight.mjs — the deploy-time config check.
//   Verifies the verdicts that matter for a safe staging/production deploy
//   (test vs live Paystack key per target, origins, TLS, TRUST_PROXY, storage,
//   forbidden variables) and that NO secret value is ever printed.
//   Runs the script as a child process with a complete environment, so
//   backend/.env (if present on a developer machine) cannot inject anything.
//   No database or network is used.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Synthetic secrets are DERIVED at runtime: high-entropy literals in source
// would (rightly) trip the CI secret scan.
const secretLike = (tag) => `${tag}-${crypto.createHash('sha256').update(`preflight-fixture:${tag}`).digest('hex').slice(0, 32)}`;
const SECRETS = Object.fromEntries(
  ['JWT_SECRET', 'SESSION_SECRET', 'DB_PASSWORD', 'S3_SECRET_ACCESS_KEY', 'METRICS_TOKEN', 'GOOGLE_CLIENT_SECRET', 'EMAIL_PASSWORD']
    .map((k) => [k, secretLike(k.toLowerCase())]),
);
const TEST_KEY = `sk_test_${secretLike('paystack-test').slice(-32)}`;
const LIVE_KEY = `sk_live_${secretLike('paystack-live').slice(-32)}`;
let caFile = '';

before(() => {
  caFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-')), 'ca.pem');
  fs.writeFileSync(caFile, '-----BEGIN CERTIFICATE-----\nnot-a-real-ca\n-----END CERTIFICATE-----\n');
});
after(() => fs.rmSync(path.dirname(caFile), { recursive: true, force: true }));

const goodEnv = () => ({
  PATH: process.env.PATH,
  NODE_ENV: 'production',
  FRONTEND_URL: 'https://kente-staging.example.app',
  TRUST_PROXY: '2',
  COOKIE_SAME_SITE: 'lax',
  ...SECRETS,
  PAYSTACK_SECRET_KEY: TEST_KEY,
  DB_HOST: 'gateway01.staging-db.example.test', DB_PORT: '4000', DB_USER: 'kente_stg', DB_NAME: 'kente_staging',
  DB_SSL: '1', DB_SSL_CA: caFile, DB_SSL_ALLOW_UNVERIFIED: '',
  STORAGE_BACKEND: 's3', S3_ENDPOINT: 'https://acct.r2.example.test', S3_BUCKET: 'kente-staging', S3_REGION: 'auto',
  S3_ACCESS_KEY_ID: 'AKIASTAGINGEXAMPLE', S3_PUBLIC_BASE_URL: 'https://cdn.staging.example.test',
  EMAIL_USER: 'mailer@example.test', EMAIL_SERVICE: 'gmail', EMAIL_FROM: 'Kente <no-reply@example.test>', EMAIL_DISABLED: '',
  GOOGLE_CLIENT_ID: 'staging-client-id.apps.example.test', OAUTH_CALLBACK_URL: 'https://kente-staging.example.app',
  REDIS_URL: 'rediss://default@redis.staging.example.test:6379', SENTRY_DSN: 'https://abc@o1.ingest.example.test/1',
  // Keys present in a developer backend/.env must be set so dotenv injects nothing.
  AI_TRYON_DAILY_LIMIT: '5', REPLICATE_API_TOKEN: '', ALLOW_DESTRUCTIVE_DB: '', ALLOW_REMOTE_TEST_DB: '', SEED_ADMIN_PASSWORD: '',
});

const run = (env, ...flags) => {
  const r = spawnSync(process.execPath, ['scripts/staging-preflight.mjs', ...flags], { cwd: backendDir, env, encoding: 'utf8', timeout: 20000 });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const assertNoSecrets = (out) => {
  for (const [k, v] of Object.entries({ ...SECRETS, PAYSTACK_TEST: TEST_KEY, PAYSTACK_LIVE: LIVE_KEY })) {
    assert.ok(!out.includes(v), `${k} value leaked into the output`);
  }
};

describe('staging-preflight', () => {
  test('a complete staging config passes and prints no secret', () => {
    const r = run(goodEnv(), '--target=staging');
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /staging: 0 FAIL/);
    assert.match(r.out, /PASS\s+PAYSTACK_SECRET_KEY\s+test key/);
    assert.match(r.out, /WARN\s+TRUST_PROXY=2/, 'TRUST_PROXY always needs the measurement confirmation');
    assertNoSecrets(r.out);
  });

  test('a LIVE Paystack key on staging fails (and a TEST key on production fails)', () => {
    const live = run({ ...goodEnv(), PAYSTACK_SECRET_KEY: LIVE_KEY }, '--target=staging');
    assert.equal(live.status, 1);
    assert.match(live.out, /FAIL\s+PAYSTACK_SECRET_KEY must be a TEST key/);
    const prod = run(goodEnv(), '--target=production');
    assert.equal(prod.status, 1);
    assert.match(prod.out, /FAIL\s+PAYSTACK_SECRET_KEY must be a LIVE key/);
    assertNoSecrets(live.out + prod.out);
  });

  test('dangerous or broken settings each fail by name', () => {
    const env = {
      ...goodEnv(),
      NODE_ENV: 'development',
      FRONTEND_URL: 'https://kente-staging.example.app/shop',
      TRUST_PROXY: 'true',
      JWT_SECRET: 'change-me-48-byte-random-hex-change-me-change-me',
      DB_HOST: '127.0.0.1',
      DB_SSL: '0',
      STORAGE_BACKEND: 's3', S3_BUCKET: '',
      ALLOW_DESTRUCTIVE_DB: '1',
      OAUTH_CALLBACK_URL: 'https://kente-staging.example.app/api/auth/google/callback',
    };
    const r = run(env, '--target=staging');
    assert.equal(r.status, 1);
    for (const rule of [
      /FAIL\s+NODE_ENV must be "production"/,
      /FAIL\s+FRONTEND_URL entries must be bare https origins/,
      /FAIL\s+TRUST_PROXY must be an integer 0\.\.3/,
      /FAIL\s+JWT_SECRET looks like a placeholder/,
      /FAIL\s+DB_HOST is loopback/,
      /FAIL\s+DB_SSL must be 1/,
      /FAIL\s+STORAGE_BACKEND=s3 is missing settings\s+S3_BUCKET/,
      /FAIL\s+ALLOW_DESTRUCTIVE_DB must not be set/,
      /FAIL\s+OAUTH_CALLBACK_URL must be a bare https ORIGIN/,
    ]) assert.match(r.out, rule);
    assertNoSecrets(r.out);
  });

  test('object storage without an https public URL fails on production, warns on staging', () => {
    const prod = run({ ...goodEnv(), PAYSTACK_SECRET_KEY: LIVE_KEY, S3_PUBLIC_BASE_URL: '' }, '--target=production');
    assert.equal(prod.status, 1);
    assert.match(prod.out, /FAIL\s+S3_PUBLIC_BASE_URL must be the https public bucket domain/);
    const stg = run({ ...goodEnv(), S3_PUBLIC_BASE_URL: 'http://cdn.staging.example.test' }, '--target=staging');
    assert.match(stg.out, /WARN\s+S3_PUBLIC_BASE_URL must be the https public bucket domain/);
    assertNoSecrets(prod.out + stg.out);
  });

  test('TLS without a CA fails unless unverified TLS is explicitly allowed (then WARN)', () => {
    const noCa = run({ ...goodEnv(), DB_SSL_CA: '' }, '--target=staging');
    assert.equal(noCa.status, 1);
    assert.match(noCa.out, /FAIL\s+DB_SSL=1 without DB_SSL_CA/);
    const unverified = run({ ...goodEnv(), DB_SSL_CA: '', DB_SSL_ALLOW_UNVERIFIED: '1' }, '--target=staging');
    assert.equal(unverified.status, 0, unverified.out);
    assert.match(unverified.out, /WARN\s+DB TLS is UNVERIFIED/);
  });

  test('--db never connects to a loopback database', () => {
    const r = run({ ...goodEnv(), DB_HOST: 'localhost' }, '--target=staging', '--db');
    assert.equal(r.status, 1);
    assert.match(r.out, /FAIL\s+--db refused: DB_HOST is empty or loopback/);
    assert.doesNotMatch(r.out, /database reachable/);
  });

  test('requires an explicit target', () => {
    assert.equal(run(goodEnv()).status, 2);
  });
});
