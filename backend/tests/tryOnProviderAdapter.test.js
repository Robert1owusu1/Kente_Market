// FILE LOCATION: backend/tests/tryOnProviderAdapter.test.js
// DESCRIPTION: The Replicate IDM-VTON adapter and the provider registry, with
//              axios mocked — no network, no spend. Checks the request shape
//              against Replicate's documented HTTP API, the status/output
//              normalisation, the output-host allow-list (our key must never
//              be sent elsewhere), webhook signature verification (Standard
//              Webhooks scheme Replicate documents), error classification
//              and the activation gates.
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import axios from 'axios';

import replicate, { isReplicateOutputUrl } from '../Services/tryOn/providers/replicateIdmVton.js';
import mockProvider from '../Services/tryOn/providers/mockProvider.js';
import { getProviderReadiness, setProviderForTests } from '../Services/tryOn/providers/index.js';
import { getTryOnConfig } from '../Services/tryOn/config.js';

const ENV_KEYS = [
  'AI_TRYON_ENABLED', 'AI_TRYON_PROVIDER', 'AI_TRYON_API_KEY', 'REPLICATE_API_TOKEN', 'AI_TRYON_API_BASE_URL',
  'AI_TRYON_MODEL_VERSION', 'AI_TRYON_WEBHOOK_SECRET', 'AI_TRYON_PUBLIC_API_URL',
  'AI_TRYON_PROVIDER_TERMS_ACCEPTED', 'NODE_ENV', 'AI_TRYON_JOB_TIMEOUT_MINUTES',
];
let saved;
// Built at runtime so no secret-looking literal is committed (gitleaks).
const FAKE_KEY = ['r8', 'test', 'not', 'real'].join('_');

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  setProviderForTests(null);
});
afterEach(() => {
  mock.restoreAll();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const config = (over = {}) => ({ ...getTryOnConfig(), apiKey: FAKE_KEY, jobTimeoutMinutes: 10, ...over });
const PERSON = 'data:image/jpeg;base64,AAAA';
const GARMENT = 'data:image/jpeg;base64,BBBB';

describe('replicate-idm-vton: requests', () => {
  test('submit posts the documented shape with Bearer auth and a provider-side Cancel-After', async () => {
    const posts = [];
    mock.method(axios, 'post', async (url, body, opts) => {
      posts.push({ url, body, opts });
      return { data: { id: 'pred123', status: 'starting' } };
    });
    const job = await replicate.submitJob({
      personImage: PERSON, garmentImage: GARMENT, garmentDescription: 'Adinkra Stole', garmentCategory: 'upper_body', webhookUrl: null,
    }, config());

    assert.deepEqual(job, { providerJobId: 'pred123', status: 'queued', resultRef: null, errorCode: null });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, 'https://api.replicate.com/v1/predictions');
    assert.equal(posts[0].opts.headers.Authorization, `Bearer ${FAKE_KEY}`);
    assert.equal(posts[0].opts.headers['Cancel-After'], '10m');
    assert.equal(posts[0].opts.maxRedirects, 0);
    assert.match(posts[0].body.version, /^[a-f0-9]{64}$/);
    assert.deepEqual(posts[0].body.input, {
      human_img: PERSON, garm_img: GARMENT, garment_des: 'Adinkra Stole', category: 'upper_body',
    });
    assert.equal(posts[0].body.webhook, undefined, 'no webhook unless configured');
  });

  test('webhook URL and completed-only filter are sent when configured', async () => {
    let sent;
    mock.method(axios, 'post', async (_u, body) => { sent = body; return { data: { id: 'p', status: 'starting' } }; });
    await replicate.submitJob({ personImage: PERSON, garmentImage: GARMENT, garmentDescription: 'x', garmentCategory: 'dresses', webhookUrl: 'https://api.kente.test/api/tryon/webhooks/replicate-idm-vton' }, config());
    assert.equal(sent.webhook, 'https://api.kente.test/api/tryon/webhooks/replicate-idm-vton');
    assert.deepEqual(sent.webhook_events_filter, ['completed']);
  });

  test('base URL and model version overrides are honoured', async () => {
    let url;
    let body;
    mock.method(axios, 'post', async (u, b) => { url = u; body = b; return { data: { id: 'p', status: 'starting' } }; });
    const v = 'a'.repeat(64);
    await replicate.submitJob({ personImage: PERSON, garmentImage: GARMENT, garmentDescription: 'x', garmentCategory: 'upper_body' },
      config({ apiBaseUrl: 'https://proxy.kente.test/v1', modelVersion: v }));
    assert.equal(url, 'https://proxy.kente.test/v1/predictions');
    assert.equal(body.version, v);
  });

  test('a submit response without an id is "outcome unknown", not success', async () => {
    mock.method(axios, 'post', async () => ({ data: {} }));
    await assert.rejects(
      () => replicate.submitJob({ personImage: PERSON, garmentImage: GARMENT, garmentDescription: 'x', garmentCategory: 'upper_body' }, config()),
      (err) => replicate.classifyError(err, 'submit') === 'submit_outcome_unknown',
    );
  });

  test('status: every documented Replicate status normalises', async () => {
    const cases = [
      [{ id: 'p', status: 'starting' }, 'queued', null],
      [{ id: 'p', status: 'processing' }, 'processing', null],
      [{ id: 'p', status: 'succeeded', output: 'https://replicate.delivery/a/out.png' }, 'succeeded', 'https://replicate.delivery/a/out.png'],
      [{ id: 'p', status: 'succeeded', output: ['https://replicate.delivery/b.png'] }, 'succeeded', 'https://replicate.delivery/b.png'],
      [{ id: 'p', status: 'failed', error: 'CUDA OOM at /secret/path' }, 'failed', null],
      [{ id: 'p', status: 'canceled' }, 'canceled', null],
      [{ id: 'p', status: 'aborted' }, 'canceled', null],
    ];
    for (const [data, status, ref] of cases) {
      mock.method(axios, 'get', async (url, opts) => {
        assert.equal(url, 'https://api.replicate.com/v1/predictions/p');
        assert.equal(opts.headers.Authorization, `Bearer ${FAKE_KEY}`);
        return { data };
      });
      const r = await replicate.getJobStatus('p', config());
      assert.equal(r.status, status, data.status);
      assert.equal(r.resultRef, ref);
      assert.ok(!JSON.stringify(r).includes('/secret/path'), 'provider error text must not be carried');
      mock.restoreAll();
    }
  });

  test('cancel uses the documented endpoint', async () => {
    let url;
    mock.method(axios, 'post', async (u) => { url = u; return { data: {} }; });
    await replicate.cancelJob('p 1', config());
    assert.equal(url, 'https://api.replicate.com/v1/predictions/p%201/cancel');
  });
});

describe('replicate-idm-vton: result download allow-list', () => {
  test('only replicate.delivery and its subdomains are output hosts', () => {
    for (const ok of ['https://replicate.delivery/x.png', 'https://pbxt.replicate.delivery/a/b.png']) {
      assert.equal(isReplicateOutputUrl(ok), true, ok);
    }
    for (const bad of [
      'http://replicate.delivery/x.png', 'https://replicate.delivery.evil.com/x', 'https://evilreplicate.delivery/x',
      'https://user:pw@replicate.delivery/x', 'https://replicate.delivery:8443/x', 'https://169.254.169.254/latest',
      'file:///etc/passwd', 'not a url', '',
    ]) {
      assert.equal(isReplicateOutputUrl(bad), false, bad);
    }
  });

  test('fetchResult never sends the API key to a host outside the allow-list', async () => {
    const get = mock.method(axios, 'get', async () => ({ data: Buffer.from('img') }));
    await assert.rejects(() => replicate.fetchResult('https://attacker.example/steal', config()));
    assert.equal(get.mock.callCount(), 0);

    const bytes = await replicate.fetchResult('https://replicate.delivery/out.png', config());
    assert.equal(bytes.toString(), 'img');
    const opts = get.mock.calls[0].arguments[1];
    assert.equal(opts.maxRedirects, 0, 'a redirect could carry the key elsewhere');
    assert.ok(opts.maxContentLength > 0);
  });
});

describe('replicate-idm-vton: webhook signatures', () => {
  const secret = `whsec_${crypto.randomBytes(24).toString('base64')}`;
  const sign = (id, ts, body, key = secret) =>
    crypto.createHmac('sha256', Buffer.from(key.slice(6), 'base64')).update(`${id}.${ts}.${body}`).digest('base64');
  const now = 1_760_000_000;
  const body = JSON.stringify({ id: 'p', status: 'succeeded', output: 'https://replicate.delivery/o.png' });
  const headersFor = (sig, ts = now) => ({ 'webhook-id': 'msg_1', 'webhook-timestamp': String(ts), 'webhook-signature': sig });

  test('a correctly signed body verifies (also among several signatures)', () => {
    const sig = sign('msg_1', now, body);
    assert.equal(replicate.verifyWebhook({ rawBody: Buffer.from(body), headers: headersFor(`v1,${sig}`), secret, nowSeconds: now }), true);
    assert.equal(replicate.verifyWebhook({ rawBody: body, headers: headersFor(`v1,AAAA v1,${sig}`), secret, nowSeconds: now }), true);
  });

  test('tampering, wrong secret, stale timestamps and missing headers are refused', () => {
    const sig = sign('msg_1', now, body);
    const v = (args) => replicate.verifyWebhook({ rawBody: body, headers: headersFor(`v1,${sig}`), secret, nowSeconds: now, ...args });
    assert.equal(v({ rawBody: body.replace('succeeded', 'failed') }), false, 'tampered body');
    assert.equal(v({ secret: `whsec_${crypto.randomBytes(24).toString('base64')}` }), false, 'wrong secret');
    assert.equal(v({ nowSeconds: now + 3600 }), false, 'replayed after tolerance');
    assert.equal(v({ headers: headersFor(`v2,${sig}`) }), false, 'unknown signature version');
    assert.equal(v({ headers: { 'webhook-id': 'msg_1' } }), false, 'missing headers');
    assert.equal(v({ secret: '' }), false, 'no secret configured');
    assert.equal(v({ headers: headersFor(`v1,${sign('msg_2', now, body)}`) }), false, 'signature for another message id');
  });

  test('the webhook body parses like a status response', () => {
    assert.deepEqual(replicate.parseWebhook(JSON.parse(body)), {
      providerJobId: 'p', status: 'succeeded', resultRef: 'https://replicate.delivery/o.png', errorCode: null,
    });
  });
});

describe('replicate-idm-vton: error classification (paid-call aware)', () => {
  const httpErr = (status) => Object.assign(new Error(`status ${status}`), { response: { status } });
  test('documented and observed statuses map to fixed codes', () => {
    assert.equal(replicate.classifyError(httpErr(401), 'submit'), 'provider_auth');
    assert.equal(replicate.classifyError(httpErr(403), 'status'), 'provider_auth');
    assert.equal(replicate.classifyError(httpErr(402), 'submit'), 'provider_quota');
    assert.equal(replicate.classifyError(httpErr(429), 'submit'), 'provider_rate_limited');
    assert.equal(replicate.classifyError(httpErr(422), 'submit'), 'provider_rejected_input');
    assert.equal(replicate.classifyError(httpErr(404), 'result'), 'result_unavailable');
    assert.equal(replicate.classifyError(httpErr(503), 'status'), 'provider_unavailable');
  });

  test('a submit that may have reached the provider is "outcome unknown"', () => {
    assert.equal(replicate.classifyError(httpErr(500), 'submit'), 'submit_outcome_unknown');
    assert.equal(replicate.classifyError(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }), 'submit'), 'submit_outcome_unknown');
    assert.equal(replicate.classifyError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }), 'submit'), 'submit_outcome_unknown');
    // Refused before anything was sent: nothing was created.
    assert.equal(replicate.classifyError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }), 'submit'), 'provider_unavailable');
  });
});

describe('provider registry and activation gates', () => {
  const ready = () => getProviderReadiness();

  test('off unless AI_TRYON_ENABLED is literally "true"', () => {
    Object.assign(process.env, { AI_TRYON_PROVIDER: 'replicate-idm-vton', AI_TRYON_API_KEY: FAKE_KEY });
    for (const v of [undefined, 'false', 'TRUE', '1', 'yes']) {
      if (v === undefined) delete process.env.AI_TRYON_ENABLED;
      else process.env.AI_TRYON_ENABLED = v;
      assert.equal(ready().ready, false, String(v));
    }
    process.env.AI_TRYON_ENABLED = 'true';
    assert.equal(ready().ready, true);
  });

  test('no provider, an unknown provider, or a missing key fail closed', () => {
    process.env.AI_TRYON_ENABLED = 'true';
    assert.match(ready().problems.join(), /AI_TRYON_PROVIDER is not set/);
    process.env.AI_TRYON_PROVIDER = 'some-image-generator';
    assert.match(ready().problems.join(), /not a known provider/);
    process.env.AI_TRYON_PROVIDER = 'replicate-idm-vton';
    assert.match(ready().problems.join(), /AI_TRYON_API_KEY is not set/);
    assert.equal(ready().ready, false);
  });

  test('the legacy REPLICATE_API_TOKEN still works as the key', () => {
    Object.assign(process.env, { AI_TRYON_ENABLED: 'true', AI_TRYON_PROVIDER: 'replicate-idm-vton', REPLICATE_API_TOKEN: FAKE_KEY });
    assert.equal(ready().ready, true);
  });

  test('invalid configuration values are reported without echoing secrets', () => {
    Object.assign(process.env, {
      AI_TRYON_ENABLED: 'true', AI_TRYON_PROVIDER: 'replicate-idm-vton', AI_TRYON_API_KEY: FAKE_KEY,
      AI_TRYON_API_BASE_URL: 'http://api.replicate.com/v1', AI_TRYON_MODEL_VERSION: 'latest',
      AI_TRYON_WEBHOOK_SECRET: 'not-a-whsec',
    });
    const r = ready();
    assert.equal(r.ready, false);
    const text = r.problems.join(' | ');
    assert.match(text, /must be https/);
    assert.match(text, /64-hex version/);
    assert.match(text, /whsec_/);
    assert.ok(!text.includes(FAKE_KEY) && !text.includes('not-a-whsec'), 'a problem message echoed a secret');
  });

  test('a webhook secret without the public API URL is a configuration error', () => {
    Object.assign(process.env, {
      AI_TRYON_ENABLED: 'true', AI_TRYON_PROVIDER: 'replicate-idm-vton', AI_TRYON_API_KEY: FAKE_KEY,
      AI_TRYON_WEBHOOK_SECRET: `whsec_${Buffer.from('k').toString('base64')}`,
    });
    assert.match(ready().problems.join(), /AI_TRYON_PUBLIC_API_URL/);
  });

  test('production refuses a non-commercial licence until terms are confirmed', () => {
    Object.assign(process.env, { AI_TRYON_ENABLED: 'true', AI_TRYON_PROVIDER: 'replicate-idm-vton', AI_TRYON_API_KEY: FAKE_KEY, NODE_ENV: 'production' });
    const r = ready();
    assert.equal(r.ready, false);
    assert.match(r.problems.join(), /CC BY-NC-SA/);
    process.env.AI_TRYON_PROVIDER_TERMS_ACCEPTED = 'true';
    assert.equal(ready().ready, true);
  });

  test('the mock provider is refused in production', () => {
    Object.assign(process.env, { AI_TRYON_ENABLED: 'true', AI_TRYON_PROVIDER: 'mock' });
    assert.equal(ready().ready, true, 'mock is allowed outside production');
    process.env.NODE_ENV = 'production';
    process.env.AI_TRYON_PROVIDER_TERMS_ACCEPTED = 'true';
    assert.match(ready().problems.join(), /cannot be used in production/);
  });

  test('the mock provider labels its output as not AI and never fetches URLs', async () => {
    await assert.rejects(
      () => mockProvider.submitJob({ personImage: PERSON, garmentImage: 'https://example.com/x.jpg' }),
      (err) => err.tryOnCode === 'provider_rejected_input',
    );
    assert.match(mockProvider.label, /not AI/);
  });

  test('a provider that cannot take a reference garment image is refused', () => {
    process.env.AI_TRYON_ENABLED = 'true';
    setProviderForTests({
      id: 'text-to-image', capabilities: { personImage: true, referenceGarmentImage: false, garmentCategories: [], completion: ['poll'] },
      verification: { commercialUseAllowed: true }, validateConfiguration: () => [],
    });
    assert.match(ready().problems.join(), /does not support person \+ reference-garment try-on/);
    setProviderForTests(null);
  });
});
