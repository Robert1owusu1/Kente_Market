#!/usr/bin/env node
// FILE LOCATION: backend/scripts/staging-preflight.mjs
// DESCRIPTION: Pre-deploy configuration check for a hosted backend (staging or
//   production). Reads the environment exactly as the server would (process env,
//   then backend/.env via dotenv for anything unset) and reports PASS / WARN /
//   FAIL per rule. It NEVER prints a secret value — only variable names and
//   non-sensitive facts (key prefix class, lengths, hostnames).
//
//   node scripts/staging-preflight.mjs --target=staging            # config only
//   node scripts/staging-preflight.mjs --target=staging --db       # + read-only schema check
//   node scripts/staging-preflight.mjs --target=production [--db]
//
//   --db opens ONE connection with the configured credentials and runs only
//   SELECTs (VERSION(), information_schema). It refuses loopback hosts so it is
//   never confused with a local test database. Exit code 1 if any FAIL.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '..', '.env'), quiet: true });

const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const target = String(args.get('target') || '');
if (!['staging', 'production'].includes(target)) {
  console.error('usage: node scripts/staging-preflight.mjs --target=staging|production [--db]');
  process.exit(2);
}

const env = process.env;
const results = [];
const pass = (rule, detail = '') => results.push(['PASS', rule, detail]);
const warn = (rule, detail = '') => results.push(['WARN', rule, detail]);
const fail = (rule, detail = '') => results.push(['FAIL', rule, detail]);
const set = (k) => typeof env[k] === 'string' && env[k].trim() !== '';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const PLACEHOLDER = /change-me|replace|placeholder|ci-only|example|test-secret|^x+$/i;

const bareHttpsOrigin = (o) => {
  try { const u = new URL(o); return u.protocol === 'https:' && u.origin === o; } catch { return false; }
};

// --- runtime ---------------------------------------------------------------
env.NODE_ENV === 'production' ? pass('NODE_ENV=production') : fail('NODE_ENV must be "production" on a hosted deploy (enables boot hard-fails and Secure cookies)');

const origins = String(env.FRONTEND_URL || '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
if (origins.length === 0) fail('FRONTEND_URL is required (CORS allow-list and link base)');
else if (!origins.every(bareHttpsOrigin)) fail('FRONTEND_URL entries must be bare https origins (scheme + host, no path)');
else pass('FRONTEND_URL', `${origins.length} origin(s); link base host ${new URL(origins[0]).host}`);
if (origins.length > 1) warn('FRONTEND_URL has several origins', 'the FIRST one is used for emailed links and redirects');

if (!set('TRUST_PROXY')) fail('TRUST_PROXY must be set explicitly to the MEASURED hop count (STAGING_VALIDATION_RUNBOOK §9.3)');
else if (!/^[0-3]$/.test(env.TRUST_PROXY.trim())) fail('TRUST_PROXY must be an integer 0..3 (never "true")');
else warn(`TRUST_PROXY=${env.TRUST_PROXY.trim()}`, 'confirm this value was measured on this topology (runbook §9.3)');

const sameSite = String(env.COOKIE_SAME_SITE || 'lax').toLowerCase();
if (!['lax', 'strict', 'none'].includes(sameSite)) fail('COOKIE_SAME_SITE must be lax | strict | none');
else if (sameSite === 'none') warn('COOKIE_SAME_SITE=none', 'only needed when the SPA calls the API cross-site; lax is right behind the Vercel rewrite');
else pass(`COOKIE_SAME_SITE=${sameSite}`);

// --- secrets ---------------------------------------------------------------
for (const k of ['JWT_SECRET', 'SESSION_SECRET']) {
  if (!set(k)) fail(`${k} is required`);
  else if (env[k].length < 32) fail(`${k} is too short`, `${env[k].length} chars, need >= 32`);
  else if (PLACEHOLDER.test(env[k])) fail(`${k} looks like a placeholder`);
  else pass(k, `${env[k].length} chars`);
}
if (set('JWT_SECRET') && env.JWT_SECRET === env.SESSION_SECRET) fail('JWT_SECRET and SESSION_SECRET must differ');
if (set('METRICS_TOKEN') && env.METRICS_TOKEN.length < 24) warn('METRICS_TOKEN is short', `${env.METRICS_TOKEN.length} chars`);

// --- Paystack --------------------------------------------------------------
const key = String(env.PAYSTACK_SECRET_KEY || '');
const keyClass = key.startsWith('sk_live_') ? 'live' : key.startsWith('sk_test_') ? 'test' : 'other';
if (!key) fail('PAYSTACK_SECRET_KEY is required (boot refuses without it)');
else if (target === 'staging' && keyClass !== 'test') fail('PAYSTACK_SECRET_KEY must be a TEST key (sk_test_…) on staging', `found: ${keyClass}`);
else if (target === 'production' && keyClass !== 'live') fail('PAYSTACK_SECRET_KEY must be a LIVE key (sk_live_…) on production', `found: ${keyClass}`);
else if (PLACEHOLDER.test(key)) fail('PAYSTACK_SECRET_KEY looks like a placeholder');
else pass('PAYSTACK_SECRET_KEY', `${keyClass} key`);

// --- database --------------------------------------------------------------
const dbHost = String(env.DB_HOST || '').trim();
for (const k of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) if (!set(k)) fail(`${k} is required`);
if (dbHost && LOOPBACK.has(dbHost)) fail('DB_HOST is loopback — a hosted deploy must point at its own staging/production database');
else if (dbHost) pass('DB_HOST', `host ${dbHost}, database ${env.DB_NAME || '?'}`);
const tlsOn = env.DB_SSL === '1' || env.DB_SSL === 'true';
if (!tlsOn) fail('DB_SSL must be 1 (TiDB Cloud requires TLS)');
else if (set('DB_SSL_CA')) {
  try { fs.accessSync(env.DB_SSL_CA, fs.constants.R_OK); pass('DB_SSL_CA readable (verified TLS)'); } catch { fail('DB_SSL_CA is set but not readable on this host'); }
} else if (env.DB_SSL_ALLOW_UNVERIFIED === '1') warn('DB TLS is UNVERIFIED (DB_SSL_ALLOW_UNVERIFIED=1)', 'set DB_SSL_CA to the host CA bundle instead');
else fail('DB_SSL=1 without DB_SSL_CA: production boot refuses (set DB_SSL_CA, e.g. the system CA bundle)');

// --- storage ---------------------------------------------------------------
const storage = String(env.STORAGE_BACKEND || 'local');
if (storage === 's3') {
  const missing = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter((k) => !set(k));
  missing.length ? fail('STORAGE_BACKEND=s3 is missing settings', missing.join(', ')) : pass('STORAGE_BACKEND=s3', `bucket ${env.S3_BUCKET}`);
  if (!set('S3_PUBLIC_BASE_URL')) warn('S3_PUBLIC_BASE_URL not set', 'object URLs will use the S3 endpoint directly; the bucket must allow public reads');
} else if (storage === 'local') {
  warn('STORAGE_BACKEND=local', 'uploads survive redeploys ONLY with a persistent disk mounted at backend/uploads');
} else fail(`STORAGE_BACKEND=${storage} is not implemented (boot exits)`);

// --- email / OAuth / optional ----------------------------------------------
if (env.EMAIL_DISABLED === '1') (target === 'production' ? fail : warn)('EMAIL_DISABLED=1', 'no OTP / reset / receipt email will be sent');
else if (!set('EMAIL_USER') && !set('EMAIL_HOST')) warn('No email transport configured', 'OTP and password reset will fail');
if (set('GOOGLE_CLIENT_ID')) {
  if (!set('GOOGLE_CLIENT_SECRET')) fail('GOOGLE_CLIENT_SECRET missing while GOOGLE_CLIENT_ID is set');
  if (!bareHttpsOrigin(String(env.OAUTH_CALLBACK_URL || '').replace(/\/+$/, ''))) {
    fail('OAUTH_CALLBACK_URL must be a bare https ORIGIN', 'the code appends /api/auth/google/callback');
  } else pass('OAUTH_CALLBACK_URL', `register ${env.OAUTH_CALLBACK_URL.replace(/\/+$/, '')}/api/auth/google/callback with Google`);
}
set('REDIS_URL') ? pass('REDIS_URL set') : warn('REDIS_URL not set', 'rate limits and single-use nonces are per instance — run ONE instance');
set('SENTRY_DSN') ? pass('SENTRY_DSN set') : warn('SENTRY_DSN not set', 'no error tracking');

// --- must never be set on a hosted deploy -----------------------------------
for (const k of ['ALLOW_DESTRUCTIVE_DB', 'ALLOW_REMOTE_TEST_DB', 'SEED_ADMIN_PASSWORD']) {
  if (set(k)) fail(`${k} must not be set on a hosted deploy`);
}

// --- optional read-only database check --------------------------------------
const REQUIRED_TABLES = [
  'users', 'orders', 'order_items', 'product', 'vendors', 'escrow_allocations', 'vendor_wallets', 'wallet_transactions',
  'vendor_withdrawals', 'payout_attempts', 'financial_events', 'platform_revenue', 'webhook_events', 'commission_rules',
  'scheduler_locks', 'scheduler_job_status', 'reconciliation_checks', 'referral_commissions', 'referral_wallets',
  'referral_ledger', 'referral_withdrawals', 'user_devices', 'exchange_rates', 'shipping_carriers', 'shipping_rates',
  'vendor_shipping_destinations', 'sessions',
];
const REQUIRED_COLUMNS = [
  ['orders', 'paymentSideEffects'], ['orders', 'commissionSnapshot'], ['orders', 'refundReference'],
  ['orders', 'paymentInstrumentHash'], ['users', 'referralCode'], ['users', 'tokenVersion'],
  ['payout_attempts', 'providerReference'], ['user_addresses', 'countryCode'],
];

if (args.get('db')) {
  if (!dbHost || LOOPBACK.has(dbHost)) {
    fail('--db refused: DB_HOST is empty or loopback');
  } else {
    const mysql = (await import('mysql2/promise')).default;
    const { mysqlTls } = await import('../config/mysqlTls.js');
    let conn;
    try {
      conn = await mysql.createConnection({
        host: dbHost, port: Number(env.DB_PORT) || 3306, user: env.DB_USER, password: env.DB_PASSWORD,
        database: env.DB_NAME, ssl: mysqlTls(), connectTimeout: 15000,
      });
      const [[v]] = await conn.query('SELECT VERSION() AS v');
      pass('database reachable', `server version ${v.v}${/tidb/i.test(v.v) ? ' (TiDB)' : ''}`);
      const [tables] = await conn.query(`SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`);
      const have = new Set(tables.map((r) => r.t));
      const missingT = REQUIRED_TABLES.filter((t) => !have.has(t));
      missingT.length ? fail('schema incomplete — run db:migrate', `missing tables: ${missingT.join(', ')}`) : pass('required tables present', `${have.size} tables`);
      const [cols] = await conn.query(`SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`);
      const haveC = new Set(cols.map((r) => `${r.t}.${r.c}`));
      const missingC = REQUIRED_COLUMNS.filter(([t, c]) => !haveC.has(`${t}.${c}`)).map(([t, c]) => `${t}.${c}`);
      missingC.length ? fail('schema incomplete — run db:migrate', `missing columns: ${missingC.join(', ')}`) : pass('required columns present');
      const [redundant] = await conn.query(
        `SELECT DISTINCT INDEX_NAME AS i FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
           AND INDEX_NAME IN ('idx_financial_dedupe','idx_financial_order','idx_scheduler_job_name')`
      );
      if (redundant.length) warn('redundant indexes from older migrations present (MIG-3, harmless)', redundant.map((r) => r.i).join(', '));
      if (have.has('settings')) {
        const [rows] = await conn.query(`SELECT settingValue AS v FROM settings WHERE settingKey = 'referral.enabled'`);
        if (rows[0]?.v === 'true') warn('referral programme is ENABLED in this database');
      }
    } catch (err) {
      fail('database check failed', `${err.code || ''} ${String(err.message).slice(0, 160)}`);
    } finally {
      if (conn) await conn.end().catch(() => {});
    }
  }
}

// --- report ----------------------------------------------------------------
const width = Math.max(...results.map(([, r]) => r.length));
for (const [level, rule, detail] of results) console.log(`${level.padEnd(4)}  ${rule.padEnd(width)}  ${detail}`);
const fails = results.filter(([l]) => l === 'FAIL').length;
const warns = results.filter(([l]) => l === 'WARN').length;
console.log(`\n${target}: ${fails} FAIL, ${warns} WARN, ${results.length - fails - warns} PASS`);
process.exit(fails ? 1 : 0);
