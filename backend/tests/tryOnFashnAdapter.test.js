// FILE LOCATION: backend/tests/tryOnFashnAdapter.test.js
// DESCRIPTION: The FASHN Try-On Max adapter, with axios mocked — no network,
//              no spend. Checks the request shape against FASHN's documented
//              API (POST /v1/run, GET /v1/status/{id}), status and error
//              normalisation, the output-host allow-list (no credentials ever
//              leave for the CDN), that unsigned webhooks are never trusted,
//              and the activation gates.
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';

import fashn, { isFashnOutputUrl } from '../Services/tryOn/providers/fashnTryOn.js';
import { getProviderReadiness, setProviderForTests } from '../Services/tryOn/providers/index.js';
import { getTryOnConfig } from '../Services/tryOn/config.js';

const ENV_KEYS = [
  'AI_TRYON_ENABLED', 'AI_TRYON_PROVIDER', 'AI_TRYON_API_KEY', 'REPLICATE_API_TOKEN', 'AI_TRYON_API_BASE_URL',
  'AI_TRYON_MODEL_VERSION', 'AI_TRYON_GENERATION_MODE', 'AI_TRYON_WEBHOOK_SECRET', 'AI_TRYON_PUBLIC_API_URL',
  'AI_TRYON_PROVIDER_TERMS_ACCEPTED', 'NODE_ENV',
];
let saved;
// Built at runtime so no secret-looking literal is committed (gitleaks).
const FAKE_KEY = ['fa', 'test', 'not', 'real'].join('-');

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
const GARMENT = 'https://media.kente.example/products/1-product-x.jpg';
const input = { personImage: PERSON, garmentImage: GARMENT, garmentDescription: 'Adinkra Stole', garmentCategory: 'upper_body', webhookUrl: null };
const httpError = (status, data) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

describe('fashn: requests', () => {
  test('submit posts the documented tryon-max shape with Bearer auth, cheapest mode by default', async () => {
    const posts = [];
    mock.method(axios, 'post', async (url, body, opts) => {
      posts.push({ url, body, opts });
      return { data: { id: 'pred-1-u1', error: null } };
    });
    const job = await fashn.submitJob(input, config());

    assert.deepEqual(job, { providerJobId: 'pred-1-u1', status: 'queued', resultRef: null, errorCode: null });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, 'https://api.fashn.ai/v1/run');
    assert.equal(posts[0].opts.headers.Authorization, `Bearer ${FAKE_KEY}`);
    assert.equal(posts[0].opts.maxRedirects, 0);
    assert.deepEqual(posts[0].body, {
      model_name: 'tryon-max',
      inputs: {
        model_image: PERSON,
        product_image: GARMENT,
        resolution: '1k',
        generation_mode: 'fast',
        num_images: 1,
        output_format: 'jpeg',
        return_base64: false,
      },
    });
    assert.ok(!JSON.stringify(posts[0]).includes('webhook'), 'no webhook is ever requested');
  });

  test('the generation mode is configurable', async () => {
    let sent;
    mock.method(axios, 'post', async (_u, body) => { sent = body; return { data: { id: 'p', error: null } }; });
    await fashn.submitJob(input, config({ generationMode: 'balanced' }));
    assert.equal(sent.inputs.generation_mode, 'balanced');
  });

  test('a run refused in the response body is an error, not a job', async () => {
    mock.method(axios, 'post', async () => ({ data: { id: null, error: { name: 'InputValidationError', message: 'x' } } }));
    await assert.rejects(fashn.submitJob(input, config()), (err) => fashn.classifyError(err, 'submit') === 'provider_rejected_input');
  });

  test('status is read from GET /v1/status/{id} with the id encoded', async () => {
    let seen;
    mock.method(axios, 'get', async (url, opts) => { seen = { url, opts }; return { data: { id: 'a/b', status: 'in_queue', output: null, error: null } }; });
    const job = await fashn.getJobStatus('a/b', config());
    assert.equal(seen.url, 'https://api.fashn.ai/v1/status/a%2Fb');
    assert.equal(seen.opts.headers.Authorization, `Bearer ${FAKE_KEY}`);
    assert.equal(job.status, 'queued');
  });
});

describe('fashn: normalisation', () => {
  const status = async (data) => {
    mock.method(axios, 'get', async () => ({ data }));
    return fashn.getJobStatus('p', config());
  };

  test('statuses map onto the normalised set', async () => {
    assert.equal((await status({ id: 'p', status: 'starting' })).status, 'queued');
    mock.restoreAll();
    assert.equal((await status({ id: 'p', status: 'processing' })).status, 'processing');
    mock.restoreAll();
    const done = await status({ id: 'p', status: 'completed', output: ['https://cdn.fashn.ai/p/output_0.jpeg'], error: null });
    assert.deepEqual(done, { providerJobId: 'p', status: 'succeeded', resultRef: 'https://cdn.fashn.ai/p/output_0.jpeg', errorCode: null });
    mock.restoreAll();
    assert.equal((await status({ id: 'p', status: 'time_out' })).errorCode, 'job_timeout');
    mock.restoreAll();
    assert.equal((await status({ id: 'p', status: 'canceled' })).status, 'canceled');
  });

  test('runtime errors map to fixed codes; provider text is never kept', async () => {
    const cases = {
      ImageLoadError: 'provider_rejected_input',
      ContentModerationError: 'provider_rejected_input',
      InputValidationError: 'provider_rejected_input',
      UnavailableError: 'provider_unavailable',
      ThirdPartyError: 'provider_unavailable',
      PipelineError: 'generation_failed',
      SomethingNew: 'generation_failed',
    };
    for (const [name, code] of Object.entries(cases)) {
      mock.restoreAll();
      const job = await status({ id: 'p', status: 'failed', output: null, error: { name, message: 'secret detail' } });
      assert.equal(job.status, 'failed');
      assert.equal(job.errorCode, code, name);
      assert.ok(!JSON.stringify(job).includes('secret detail'));
    }
  });
});

describe('fashn: result download', () => {
  test('only https cdn.fashn.ai / media.fashn.ai are output hosts', () => {
    assert.ok(isFashnOutputUrl('https://cdn.fashn.ai/x/output_0.jpeg'));
    assert.ok(isFashnOutputUrl('https://media.fashn.ai/x/output_0.jpeg'));
    for (const bad of [
      'http://cdn.fashn.ai/x.jpeg',
      'https://cdn.fashn.ai.evil.example/x.jpeg',
      'https://evil.example/cdn.fashn.ai/x.jpeg',
      'https://api.fashn.ai/v1/credits',
      'https://user:pw@cdn.fashn.ai/x.jpeg',
      'https://cdn.fashn.ai:8443/x.jpeg',
      'https://169.254.169.254/latest/meta-data',
      'not a url',
    ]) assert.equal(isFashnOutputUrl(bad), false, bad);
  });

  test('downloads without credentials and refuses other hosts before any request', async () => {
    const gets = [];
    mock.method(axios, 'get', async (url, opts) => { gets.push({ url, opts }); return { data: Buffer.from('img') }; });
    const bytes = await fashn.fetchResult('https://cdn.fashn.ai/p/output_0.jpeg', config());
    assert.equal(bytes.toString(), 'img');
    assert.equal(gets[0].opts.headers, undefined, 'the API key must not be sent to the CDN');
    assert.equal(gets[0].opts.maxRedirects, 0);
    assert.ok(gets[0].opts.maxContentLength > 0);

    await assert.rejects(fashn.fetchResult('https://evil.example/x.jpeg', config()), (err) => fashn.classifyError(err, 'result') === 'result_unavailable');
    assert.equal(gets.length, 1);
  });
});

describe('fashn: errors', () => {
  test('API-level errors classify by status and FASHN error name', () => {
    assert.equal(fashn.classifyError(httpError(401, { error: 'UnauthorizedAccess' }), 'submit'), 'provider_auth');
    assert.equal(fashn.classifyError(httpError(429, { error: 'OutOfCredits' }), 'submit'), 'provider_quota');
    assert.equal(fashn.classifyError(httpError(429, { error: 'ConcurrencyLimitExceeded' }), 'submit'), 'provider_rate_limited');
    assert.equal(fashn.classifyError(httpError(429, { error: 'RateLimitExceeded' }), 'status'), 'provider_rate_limited');
    assert.equal(fashn.classifyError(httpError(400, { error: 'BadRequest' }), 'submit'), 'provider_rejected_input');
    assert.equal(fashn.classifyError(httpError(404, { error: 'NotFound' }), 'status'), 'result_unavailable');
    assert.equal(fashn.classifyError(httpError(500, { error: 'InternalServerError' }), 'submit'), 'provider_unavailable');
  });

  test('a submit that timed out may have started a paid run: outcome unknown', () => {
    const timeout = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    assert.equal(fashn.classifyError(timeout, 'submit'), 'submit_outcome_unknown');
    assert.equal(fashn.classifyError(Object.assign(new Error('x'), { code: 'ENOTFOUND' }), 'submit'), 'provider_unavailable');
  });

  test('webhooks are never trusted (FASHN does not sign them)', () => {
    assert.equal(fashn.verifyWebhook({ rawBody: '{"id":"p","status":"completed"}', headers: {}, secret: 'anything' }), false);
    assert.deepEqual(fashn.capabilities.completion, ['poll']);
  });
});

describe('fashn: activation', () => {
  const enable = (extra = {}) => Object.assign(process.env, {
    AI_TRYON_ENABLED: 'true', AI_TRYON_PROVIDER: 'fashn', AI_TRYON_API_KEY: FAKE_KEY, ...extra,
  });

  test('ready outside production with a key', () => {
    enable();
    const r = getProviderReadiness();
    assert.equal(r.provider.id, 'fashn');
    assert.deepEqual(r.problems, []);
    assert.equal(r.ready, true);
  });

  test('production needs the operator to confirm FASHN terms', () => {
    enable({ NODE_ENV: 'production' });
    assert.equal(getProviderReadiness().ready, false);
    assert.match(getProviderReadiness().problems.join(), /AI_TRYON_PROVIDER_TERMS_ACCEPTED/);
    process.env.AI_TRYON_PROVIDER_TERMS_ACCEPTED = 'true';
    assert.equal(getProviderReadiness().ready, true);
  });

  test('bad settings are reported by name without secret values', () => {
    enable({ AI_TRYON_GENERATION_MODE: 'turbo', AI_TRYON_MODEL_VERSION: 'tryon-v1.6', AI_TRYON_API_BASE_URL: 'http://api.fashn.ai/v1' });
    const text = getProviderReadiness().problems.join(' | ');
    assert.match(text, /AI_TRYON_GENERATION_MODE must be one of: fast, balanced, quality/);
    assert.match(text, /AI_TRYON_MODEL_VERSION must be empty or "tryon-max"/);
    assert.match(text, /AI_TRYON_API_BASE_URL must be https/);
    assert.ok(!text.includes(FAKE_KEY));
    delete process.env.AI_TRYON_API_KEY;
    assert.match(getProviderReadiness().problems.join(), /AI_TRYON_API_KEY is not set/);
  });
});
