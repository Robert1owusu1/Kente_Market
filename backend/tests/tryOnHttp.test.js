// FILE LOCATION: backend/tests/tryOnHttp.test.js
// DESCRIPTION: AI try-on over real HTTP (loopback, tests/helpers/httpHarness.js)
//              with the real router, auth middleware, error handler and the
//              same raw-body webhook mount as server.js. No database is
//              needed: every request here is answered before one would be
//              (auth refusals, signature refusals, configuration answers).
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';

import { startServer } from './helpers/httpHarness.js';
import { makeScriptedProvider } from './helpers/tryOnFakes.js';

// Rate limiters bind their store at import: in-memory, like the other suites.
process.env.REDIS_URL = '';
const { default: tryOnRoutes } = await import('../routes/tryOnRoutes.js');
const { tryOnWebhook } = await import('../controllers/tryOnController.js');
const { errorHandeler } = await import('../middleware/errorMiddleware.js');
const { setProviderForTests } = await import('../Services/tryOn/providers/index.js');

const ENV = ['AI_TRYON_ENABLED', 'AI_TRYON_PROVIDER', 'AI_TRYON_API_KEY', 'REPLICATE_API_TOKEN', 'AI_TRYON_WEBHOOK_SECRET', 'AI_TRYON_PUBLIC_API_URL', 'REDIS_URL'];
let saved;
let server;
// Built at runtime so no secret-looking literal is committed (gitleaks).
const FAKE_KEY = ['r8', 'httptest', 'secret', 'value'].join('_');

before(async () => {
  const app = express();
  app.use(cookieParser());
  // Same order as server.js: webhook (raw body) BEFORE the JSON parser.
  app.post('/api/tryon/webhooks/:provider', express.raw({ type: 'application/json', limit: '8mb' }), tryOnWebhook);
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/tryon', tryOnRoutes);
  app.use(errorHandeler);
  server = await startServer(app);
});
after(async () => { await server?.close(); });

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.REDIS_URL = '';
});
afterEach(() => {
  setProviderForTests(null);
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const call = (method, url, { body, headers } = {}) =>
  fetch(`${server.baseUrl}${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('authentication and ownership boundaries', () => {
  test('creating a job, reading a job and reading a result all require a signed-in user', async () => {
    process.env.AI_TRYON_ENABLED = 'true';
    setProviderForTests(makeScriptedProvider());
    const id = '00000000-0000-4000-8000-000000000001';
    for (const [method, url, body] of [
      ['POST', '/api/tryon/jobs', { productId: 1, modelImage: 'data:image/jpeg;base64,AAAA', consent: true, idempotencyKey: 'abcdefgh' }],
      ['GET', `/api/tryon/jobs/${id}`],
      ['GET', `/api/tryon/jobs/${id}/result`],
    ]) {
      const r = await call(method, url, { body });
      assert.equal(r.status, 401, `${method} ${url}`);
    }
  });

  test('a forged session cookie is refused', async () => {
    const r = await call('GET', '/api/tryon/jobs/00000000-0000-4000-8000-000000000001', { headers: { cookie: 'jwt=not.a.valid.token' } });
    assert.equal(r.status, 401);
  });
});

describe('public endpoints never expose provider configuration', () => {
  test('GET /api/tryon/status is a bare boolean, even when fully configured', async () => {
    Object.assign(process.env, { AI_TRYON_ENABLED: 'true', AI_TRYON_PROVIDER: 'replicate-idm-vton', AI_TRYON_API_KEY: FAKE_KEY });
    const r = await call('GET', '/api/tryon/status');
    const text = await r.text();
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(text), { enabled: true });
    assert.ok(!text.includes(FAKE_KEY));
    assert.ok(!/replicate/i.test(text), 'the provider identity is not public information');
  });

  test('misconfiguration is reported as "not enabled", never as the problem list', async () => {
    Object.assign(process.env, { AI_TRYON_ENABLED: 'true', AI_TRYON_PROVIDER: 'replicate-idm-vton', AI_TRYON_API_BASE_URL: 'http://x' });
    const text = await (await call('GET', '/api/tryon/status')).text();
    assert.deepEqual(JSON.parse(text), { enabled: false });
  });
});

describe('webhook over HTTP', () => {
  test('the raw signed body reaches the verifier unmodified and large bodies are accepted', async () => {
    let seen = null;
    process.env.AI_TRYON_WEBHOOK_SECRET = `whsec_${Buffer.from('k').toString('base64')}`;
    setProviderForTests(makeScriptedProvider({
      verifyWebhook: ({ rawBody }) => { seen = rawBody; return false; },
    }));
    // Replicate echoes the inputs (two inline images): bigger than the 1mb JSON limit.
    const big = JSON.stringify({ id: 'p', status: 'succeeded', input: { human_img: `data:image/jpeg;base64,${'A'.repeat(1_500_000)}` } });
    const r = await call('POST', '/api/tryon/webhooks/scripted', { body: big, headers: { 'webhook-signature': 'v1,x' } });
    assert.equal(r.status, 401, 'unsigned/forged deliveries are refused');
    assert.ok(Buffer.isBuffer(seen), 'the verifier must receive the raw bytes');
    assert.equal(seen.length, Buffer.byteLength(big));
  });

  test('an unknown provider or an unconfigured secret answers 404', async () => {
    assert.equal((await call('POST', '/api/tryon/webhooks/nope', { body: '{}' })).status, 404);
    setProviderForTests(makeScriptedProvider());
    assert.equal((await call('POST', '/api/tryon/webhooks/scripted', { body: '{}' })).status, 404);
  });
});

describe('provider credentials stay on the backend', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

  test('frontend source never references provider credentials or provider APIs', () => {
    const files = walk(path.join(root, 'src')).filter((f) => /\.(ts|tsx|js|jsx)$/.test(f));
    assert.ok(files.length > 50, 'frontend source not found');
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const needle of ['AI_TRYON_API_KEY', 'REPLICATE_API_TOKEN', 'AI_TRYON_WEBHOOK_SECRET', 'api.replicate.com', 'VITE_AI_TRYON', 'VITE_REPLICATE']) {
        assert.ok(!text.includes(needle), `${path.relative(root, file)} references ${needle}`);
      }
    }
  });

  test('no try-on secret is declared as a VITE_ variable in the frontend env example', () => {
    const env = readFileSync(path.join(root, '.env.example'), 'utf8');
    assert.ok(!/^VITE_[A-Z_]*(TRYON|REPLICATE)/m.test(env));
  });
});
