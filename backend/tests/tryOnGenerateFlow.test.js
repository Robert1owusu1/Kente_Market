// FILE LOCATION: backend/tests/tryOnGenerateFlow.test.js
// DESCRIPTION: The AI try-on job lifecycle, driven through the real HTTP
//              handlers and the real job service with: a mocked MySQL pool for
//              the PRODUCT lookup only, an in-memory job repository + result
//              store (tests/helpers/tryOnFakes.js), and a scripted provider
//              adapter. No network, no database, no provider spend, and only
//              synthetic images.
//
// What this proves:
//   - product binding: Product A sends A's own image, B sends B's; the job,
//     every response and the stored result stay bound to the server-resolved
//     product; browser-supplied garment/vendor/price fields are ignored;
//   - nothing is reserved or spent for a refused request (bad photo, hidden or
//     unsupported product, missing consent, capacity, daily limit);
//   - duplicate submissions return the original job without a second submit;
//   - a submit failure is never retried automatically;
//   - polling, webhooks, deadlines, interrupted submits and result expiry
//     converge to the right state, idempotently, and results are owner-only;
//   - the customer photo is never persisted or logged.
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import axios from 'axios';

import pool from '../config/db.js';
import {
  createTryOnJob,
  getTryOnJob,
  getTryOnJobResult,
  getProductTryOnEligibility,
  tryOnWebhook,
} from '../controllers/tryOnController.js';
import {
  setTryOnPersistenceForTests,
  sweepTryOnJobs,
} from '../Services/tryOn/tryOnJobService.js';
import { setProviderForTests } from '../Services/tryOn/providers/index.js';
import fashnTryOn from '../Services/tryOn/providers/fashnTryOn.js';
import { sanitizeImageBuffer, readLocalCatalogImage } from '../utils/tryOnImage.js';
import { makeFakeRepo, makeFakeStore, makeScriptedProvider } from './helpers/tryOnFakes.js';

const SAVE_ENV = [
  'AI_TRYON_ENABLED', 'AI_TRYON_PROVIDER', 'AI_TRYON_API_KEY', 'REPLICATE_API_TOKEN',
  'AI_TRYON_ALLOWED_HOSTS', 'AI_TRYON_WEBHOOK_SECRET', 'AI_TRYON_PUBLIC_API_URL', 'NODE_ENV',
];
let savedEnv;

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------
const PRODUCT_A = { id: 11, vendorId: 1, title: 'Adinkra Royal Stole', img: '/images/image2.jpeg', category: 'Double Weaving', approvalStatus: 'approved' };
const PRODUCT_B = { id: 12, vendorId: 2, title: 'Sika Futuro Wrap', img: '/images/image4.jpeg', category: 'Single Weaving', approvalStatus: 'approved' };

/** Solid synthetic JPEG with an EXIF marker — a stand-in for a user photo. */
const photoDataUri = async () => {
  const buf = await sharp({ create: { width: 120, height: 160, channels: 3, background: { r: 120, g: 60, b: 30 } } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'UserGPSData' } })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
};
const resultJpeg = () => sharp({ create: { width: 64, height: 64, channels: 3, background: '#336699' } }).jpeg().toBuffer();
const sanitizedCatalogImage = async (imgPath) =>
  (await sanitizeImageBuffer(await readLocalCatalogImage(imgPath), 'productImage')).dataUri;

/**
 * Mock pool.execute for the product lookup. Resolves the BOUND id against
 * `products` and applies the same vendor-visibility guard as the real query.
 */
const mockProducts = (products) => {
  const lookups = [];
  mock.method(pool, 'execute', async (sql, params = []) => {
    if (/FROM product p\s+LEFT JOIN vendors v/.test(sql)) {
      assert.match(sql, /v\.status = 'approved' OR p\.vendorId IS NULL/, 'vendor-visibility guard missing');
      lookups.push(params[0]);
      const row = products.find((r) => r.id === params[0]);
      const visible = row && (row.vendorId == null || (row.vendorStatus ?? 'approved') === 'approved');
      return [visible ? [row] : []];
    }
    throw new Error(`unexpected SQL in test: ${sql}`);
  });
  return lookups;
};

const makeRes = () => ({
  statusCode: 200,
  headers: {},
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  set(name, value) {
    if (typeof name === 'object') Object.assign(this.headers, name);
    else this.headers[name] = value;
    return this;
  },
  json(payload) { this.body = payload; return this; },
  send(payload) { this.body = payload; return this; },
});

/** Run a handler; resolves to { res, err } (err = what reached next()). */
const run = async (handler, req) => {
  const res = makeRes();
  let err = null;
  await handler(req, res, (e) => { err = e; });
  return { res, err };
};

let keySeq = 0;
const newKey = () => `test-key-${Date.now()}-${keySeq++}`;
const submitReq = async (overrides = {}, userId = 101) => ({
  user: { id: userId },
  body: { productId: PRODUCT_A.id, modelImage: await photoDataUri(), consent: true, idempotencyKey: newKey(), ...overrides },
});

let repo;
let store;
let provider;

const install = (script = {}, repoOpts = {}) => {
  repo = makeFakeRepo(repoOpts);
  store = makeFakeStore();
  provider = makeScriptedProvider(script);
  setTryOnPersistenceForTests({ repository: repo, resultStore: store });
  setProviderForTests(provider);
};

/** Make the next poll due now (the real repo uses NOW() for this). */
const makeDue = (jobId) => { repo.jobs.get(jobId).nextPollAt = new Date(Date.now() - 1); };

beforeEach(() => {
  savedEnv = Object.fromEntries(SAVE_ENV.map((k) => [k, process.env[k]]));
  for (const k of SAVE_ENV) delete process.env[k];
  process.env.AI_TRYON_ENABLED = 'true';
  install();
});

afterEach(() => {
  mock.restoreAll();
  setProviderForTests(null);
  setTryOnPersistenceForTests({});
  for (const k of SAVE_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

// ---------------------------------------------------------------------------
// product binding
// ---------------------------------------------------------------------------
describe('try-on jobs are bound to the selected product', () => {
  test('happy path: only sanitized bytes and server-derived text reach the provider', async () => {
    mockProducts([PRODUCT_A]);
    const { res, err } = await run(createTryOnJob, await submitReq());

    assert.equal(err, null, err?.message);
    assert.equal(res.statusCode, 202);
    assert.equal(res.body.job.productId, PRODUCT_A.id);
    assert.equal(res.body.job.status, 'processing');
    assert.equal(repo.calls.credits, 1, 'the daily credit must be consumed exactly once');
    assert.equal(provider.calls.submit.length, 1);

    const input = provider.calls.submit[0];
    assert.ok(input.personImage.startsWith('data:image/jpeg;base64,'));
    assert.ok(!Buffer.from(input.personImage.split(',')[1], 'base64').toString('latin1').includes('UserGPSData'),
      'user EXIF/GPS data was forwarded to the provider');
    assert.equal(input.garmentImage, await sanitizedCatalogImage(PRODUCT_A.img));
    assert.equal(input.garmentDescription, 'Adinkra Royal Stole');
    assert.equal(input.garmentCategory, 'upper_body');
    assert.equal(input.webhookUrl, null, 'no webhook without secret + public URL');

    const stored = [...repo.jobs.values()][0];
    assert.equal(stored.productId, PRODUCT_A.id);
    assert.equal(stored.vendorId, PRODUCT_A.vendorId);
    assert.equal(stored.providerJobId, 'prov-1');
  });

  test("Product A uses Product A's own image — never Product B's, and vice versa", async () => {
    const [imgA, imgB] = [await sanitizedCatalogImage(PRODUCT_A.img), await sanitizedCatalogImage(PRODUCT_B.img)];
    assert.notEqual(imgA, imgB, 'fixture images must differ for this test to mean anything');

    for (const [chosen, expected, other] of [[PRODUCT_A, imgA, imgB], [PRODUCT_B, imgB, imgA]]) {
      install();
      const lookups = mockProducts([PRODUCT_A, PRODUCT_B]);
      const { res, err } = await run(createTryOnJob, await submitReq({ productId: chosen.id }));
      assert.equal(err, null, err?.message);
      assert.deepEqual(lookups, [chosen.id], 'only the chosen product may be looked up');
      assert.equal(provider.calls.submit[0].garmentImage, expected);
      assert.notEqual(provider.calls.submit[0].garmentImage, other);
      assert.equal(provider.calls.submit[0].garmentDescription, chosen.title);
      assert.equal(res.body.job.productId, chosen.id);
      assert.equal([...repo.jobs.values()][0].vendorId, chosen.vendorId);
      mock.restoreAll();
    }
  });

  test('browser-supplied garment image, vendor, price and category are ignored', async () => {
    mockProducts([PRODUCT_A]);
    const { err } = await run(createTryOnJob, await submitReq({
      garmentImage: 'https://evil.example/random-shirt.jpg',
      productImage: '/images/image4.jpeg',
      garm_img: 'https://evil.example/x.jpg',
      garmentDescription: 'a random red t-shirt',
      vendorId: 999,
      price: 1,
      category: 'lower_body',
    }));
    assert.equal(err, null, err?.message);
    const input = provider.calls.submit[0];
    assert.equal(input.garmentImage, await sanitizedCatalogImage(PRODUCT_A.img));
    assert.equal(input.garmentDescription, PRODUCT_A.title);
    assert.equal(input.garmentCategory, 'upper_body');
    assert.equal([...repo.jobs.values()][0].vendorId, PRODUCT_A.vendorId);
  });

  test('a provider can never re-bind a job to another product', async () => {
    install({
      getJobStatus: async (id) => ({ providerJobId: id, status: 'succeeded', resultRef: 'r1', errorCode: null, productId: 12 }),
      fetchResult: async () => resultJpeg(),
    });
    mockProducts([PRODUCT_A]);
    const { res } = await run(createTryOnJob, await submitReq());
    makeDue(res.body.job.jobId);
    const polled = await run(getTryOnJob, { user: { id: 101 }, params: { id: res.body.job.jobId } });
    assert.equal(polled.res.body.job.status, 'succeeded');
    assert.equal(polled.res.body.job.productId, PRODUCT_A.id);
  });
});

// ---------------------------------------------------------------------------
// refusals spend nothing
// ---------------------------------------------------------------------------
describe('refused requests reserve and spend nothing', () => {
  const assertNothingSpent = () => {
    assert.equal(repo.calls.credits, 0, 'a refused request must not burn a daily credit');
    assert.equal(provider.calls.submit.length, 0, 'the provider must not be called');
    assert.equal(repo.jobs.size, 0, 'no job row may remain');
  };

  test('missing or invalid product ids never select a product', async () => {
    const lookups = mockProducts([PRODUCT_A]);
    for (const productId of [undefined, null, '', 0, -3, 'abc', 1.5]) {
      const { res } = await run(createTryOnJob, await submitReq({ productId }));
      assert.equal(res.statusCode, 400, `productId=${JSON.stringify(productId)}`);
    }
    assert.deepEqual(lookups, []);
    assertNothingSpent();
  });

  test('unknown, unapproved and suspended-vendor products answer the same 404', async () => {
    for (const product of [
      null,
      { ...PRODUCT_A, approvalStatus: 'pending' },
      { ...PRODUCT_A, approvalStatus: 'rejected' },
      { ...PRODUCT_A, vendorId: 55, vendorStatus: 'suspended' },
    ]) {
      mockProducts(product ? [product] : []);
      const { res } = await run(createTryOnJob, await submitReq());
      assert.equal(res.statusCode, 404, JSON.stringify(product));
      assert.match(res.body.message, /not available for AI try-on/);
      mock.restoreAll();
    }
    assertNothingSpent();
  });

  test('non-wearable products and unusable product images are refused with 422', async () => {
    for (const [product, pattern] of [
      [{ ...PRODUCT_A, title: 'Kente Table Runner' }, /not a wearable item/],
      [{ ...PRODUCT_A, category: 'Kente Decor', title: 'Royal Throw' }, /not a wearable item/],
      [{ ...PRODUCT_A, img: null }, /photo can't be used/],
      [{ ...PRODUCT_A, img: '/uploads/products/missing-9999.jpg' }, /photo can't be used/],
      [{ ...PRODUCT_A, img: 'https://random-cdn.example/stole.jpg' }, /photo can't be used/],
    ]) {
      mockProducts([product]);
      const { res } = await run(createTryOnJob, await submitReq());
      assert.equal(res.statusCode, 422, product.title);
      assert.match(res.body.message, pattern);
      mock.restoreAll();
    }
    assertNothingSpent();
  });

  test('a garment category the provider does not support is refused', async () => {
    install({ capabilities: { garmentCategories: ['dresses'] } });
    mockProducts([PRODUCT_A]);
    const { res } = await run(createTryOnJob, await submitReq());
    assert.equal(res.statusCode, 422);
    assert.match(res.body.message, /doesn't support this kind of garment/);
    assertNothingSpent();
  });

  test('an invalid photo, or a URL instead of a photo, is refused', async () => {
    mockProducts([PRODUCT_A]);
    const pdfAsJpeg = `data:image/jpeg;base64,${Buffer.from('%PDF-1.4 fake pdf payload').toString('base64')}`;
    const corrupt = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64')}`;
    for (const modelImage of [pdfAsJpeg, corrupt, 'https://cdn.kentemarket.com/x.jpg']) {
      const { res } = await run(createTryOnJob, await submitReq({ modelImage }));
      assert.equal(res.statusCode, 400, modelImage.slice(0, 40));
    }
    assertNothingSpent();
  });

  test('processing consent is required', async () => {
    mockProducts([PRODUCT_A]);
    for (const consent of [undefined, false, 'true', 1]) {
      const { res } = await run(createTryOnJob, await submitReq({ consent }));
      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /agree to your photo being processed/);
    }
    assertNothingSpent();
  });

  test('per-user and global capacity caps answer 429 before the credit', async () => {
    mockProducts([PRODUCT_A]);
    // Two active jobs for this user already (default cap 2).
    for (let i = 0; i < 2; i++) {
      await repo.insert({ id: `00000000-0000-4000-8000-00000000000${i}`, userId: 101, productId: 11, provider: 'scripted', idempotencyKey: `seed-${i}`, garmentCategory: 'upper_body', timeoutMinutes: 10 });
    }
    const before = repo.jobs.size;
    const { res } = await run(createTryOnJob, await submitReq());
    assert.equal(res.statusCode, 429);
    assert.match(res.body.message, /already have a try-on in progress/);
    assert.equal(res.headers['Retry-After'], '30');
    assert.equal(repo.jobs.size, before, 'the refused job row must be removed');
    assert.equal(repo.calls.credits, 0);
    assert.equal(provider.calls.submit.length, 0);

    // Global: eight active jobs from other users (default cap 8).
    install();
    mockProducts([PRODUCT_A]);
    for (let i = 0; i < 8; i++) {
      await repo.insert({ id: `00000000-0000-4000-8000-00000000001${i}`, userId: 900 + i, productId: 11, provider: 'scripted', idempotencyKey: `g-${i}`, garmentCategory: 'upper_body', timeoutMinutes: 10 });
    }
    const global = await run(createTryOnJob, await submitReq());
    assert.equal(global.res.statusCode, 429);
    assert.match(global.res.body.message, /capacity/);
    assert.equal(repo.calls.credits, 0);
    assert.equal(provider.calls.submit.length, 0);
  });

  test('daily limit exhaustion answers 429 and does not call the provider', async () => {
    install({}, { dailyLimitReached: true });
    mockProducts([PRODUCT_A]);
    const { res } = await run(createTryOnJob, await submitReq());
    assert.equal(res.statusCode, 429);
    assert.match(res.body.message, /daily limit/);
    assert.equal(provider.calls.submit.length, 0);
    assert.equal(repo.jobs.size, 0);
  });

  test('the kill switch and a missing provider answer 503 and spend nothing', async () => {
    mockProducts([PRODUCT_A]);
    process.env.AI_TRYON_ENABLED = 'false';
    let r = await run(createTryOnJob, await submitReq());
    assert.equal(r.res.statusCode, 503);
    assert.equal(r.res.body.code, 'not_enabled');

    process.env.AI_TRYON_ENABLED = 'true';
    setProviderForTests(null); // AI_TRYON_PROVIDER unset
    r = await run(createTryOnJob, await submitReq());
    assert.equal(r.res.statusCode, 503);
    assert.equal(r.res.body.code, 'provider_not_configured');
    assert.equal(repo.calls.credits, 0);
  });
});

// ---------------------------------------------------------------------------
// duplicates and paid-call discipline
// ---------------------------------------------------------------------------
describe('duplicate submissions and provider failures', () => {
  test('the same idempotency key returns the original job with no second submit or credit', async () => {
    mockProducts([PRODUCT_A]);
    const req = await submitReq();
    const first = await run(createTryOnJob, req);
    const second = await run(createTryOnJob, req);
    assert.equal(first.res.statusCode, 202);
    assert.equal(second.res.statusCode, 200);
    assert.equal(second.res.body.job.jobId, first.res.body.job.jobId);
    assert.equal(provider.calls.submit.length, 1);
    assert.equal(repo.calls.credits, 1);
  });

  test('re-using a key for a different product is refused', async () => {
    mockProducts([PRODUCT_A, PRODUCT_B]);
    const req = await submitReq();
    await run(createTryOnJob, req);
    const other = await run(createTryOnJob, { ...req, body: { ...req.body, productId: PRODUCT_B.id } });
    assert.equal(other.res.statusCode, 409);
    assert.equal(provider.calls.submit.length, 1);
  });

  test('a submit timeout is recorded as outcome-unknown and NOT retried', async () => {
    install({
      submitJob: async () => { throw Object.assign(new Error('timeout of 60000ms exceeded'), { code: 'ECONNABORTED' }); },
      classifyError: () => 'submit_outcome_unknown',
    });
    mockProducts([PRODUCT_A]);
    const { res } = await run(createTryOnJob, await submitReq());
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'submit_outcome_unknown');
    assert.equal(provider.calls.submit.length, 1, 'a paid submit must never be retried automatically');
    const job = [...repo.jobs.values()][0];
    assert.equal(job.status, 'failed');
    assert.equal(job.errorCode, 'submit_outcome_unknown');
    assert.equal(repo.calls.credits, 1, 'the credit stays consumed: the provider may have billed');

    // Nothing later resubmits it either.
    await sweepTryOnJobs();
    assert.equal(provider.calls.submit.length, 1);
  });

  for (const [code, http] of [['provider_quota', 429], ['provider_rate_limited', 429], ['provider_auth', 503], ['provider_unavailable', 503], ['provider_rejected_input', 422]]) {
    test(`provider error ${code} answers ${http} with a fixed message and no provider text`, async () => {
      install({
        submitJob: async () => { throw Object.assign(new Error('detail: account r8_secret token leaked /etc/passwd'), { tryOnCode: code }); },
      });
      mockProducts([PRODUCT_A]);
      const { res } = await run(createTryOnJob, await submitReq());
      assert.equal(res.statusCode, http);
      assert.equal(res.body.code, code);
      assert.ok(!/r8_secret|passwd|detail/.test(res.body.message), 'provider text leaked');
    });
  }
});

// ---------------------------------------------------------------------------
// completion: polling, webhook, ownership, result
// ---------------------------------------------------------------------------
describe('job completion and result access', () => {
  const startJob = async (script) => {
    install(script);
    mockProducts([PRODUCT_A]);
    const { res } = await run(createTryOnJob, await submitReq());
    return res.body.job.jobId;
  };

  test('polling completes the job, stores a re-encoded result and serves it to the owner only', async () => {
    let status = 'processing';
    const jobId = await startJob({
      getJobStatus: async (id) => ({ providerJobId: id, status, resultRef: status === 'succeeded' ? 'out-1' : null, errorCode: null }),
      fetchResult: async () => resultJpeg(),
    });

    // Not due yet: no provider call.
    let r = await run(getTryOnJob, { user: { id: 101 }, params: { id: jobId } });
    assert.equal(r.res.body.job.status, 'processing');
    assert.equal(provider.calls.status.length, 0, 'polls are throttled by nextPollAt');

    makeDue(jobId);
    r = await run(getTryOnJob, { user: { id: 101 }, params: { id: jobId } });
    assert.equal(r.res.body.job.status, 'processing');
    assert.equal(provider.calls.status.length, 1);

    status = 'succeeded';
    makeDue(jobId);
    r = await run(getTryOnJob, { user: { id: 101 }, params: { id: jobId } });
    assert.equal(r.res.body.job.status, 'succeeded');
    assert.equal(r.res.body.job.resultAvailable, true);
    assert.equal(r.res.body.job.productId, PRODUCT_A.id);
    assert.equal(r.res.headers['Cache-Control'], 'private, no-store');
    assert.ok(!JSON.stringify(r.res.body).includes('out-1'), 'the provider result reference must not reach the browser');

    const img = await run(getTryOnJobResult, { user: { id: 101 }, params: { id: jobId } });
    assert.equal(img.res.statusCode, 200);
    assert.equal(img.res.headers['Content-Type'], 'image/jpeg');
    assert.equal(img.res.headers['Cache-Control'], 'private, no-store');
    assert.equal((await sharp(img.res.body).metadata()).format, 'jpeg');

    for (const [handler, label] of [[getTryOnJob, 'status'], [getTryOnJobResult, 'result']]) {
      const other = await run(handler, { user: { id: 202 }, params: { id: jobId } });
      assert.equal(other.res.statusCode, 404, `another user must not see the ${label}`);
    }
    const bogus = await run(getTryOnJob, { user: { id: 101 }, params: { id: '../../etc/passwd' } });
    assert.equal(bogus.res.statusCode, 404);
  });

  test('concurrent status reads poll the provider once per window', async () => {
    const jobId = await startJob();
    makeDue(jobId);
    await Promise.all([1, 2, 3, 4].map(() => run(getTryOnJob, { user: { id: 101 }, params: { id: jobId } })));
    assert.equal(provider.calls.status.length, 1);
  });

  test('a provider failure ends the job with a safe, retryable error', async () => {
    const jobId = await startJob({
      getJobStatus: async (id) => ({ providerJobId: id, status: 'failed', resultRef: null, errorCode: 'generation_failed' }),
    });
    makeDue(jobId);
    const r = await run(getTryOnJob, { user: { id: 101 }, params: { id: jobId } });
    assert.equal(r.res.body.job.status, 'failed');
    assert.deepEqual(r.res.body.job.error, {
      code: 'generation_failed',
      message: 'The AI could not create a try-on from this photo. Please try a different photo.',
      retryable: true,
    });
    const img = await run(getTryOnJobResult, { user: { id: 101 }, params: { id: jobId } });
    assert.equal(img.res.statusCode, 409);
  });

  test('a provider result that is not an image fails the job; nothing is stored', async () => {
    const jobId = await startJob({
      getJobStatus: async (id) => ({ providerJobId: id, status: 'succeeded', resultRef: 'x', errorCode: null }),
      fetchResult: async () => Buffer.from('<html>not an image</html>'),
    });
    makeDue(jobId);
    const r = await run(getTryOnJob, { user: { id: 101 }, params: { id: jobId } });
    assert.equal(r.res.body.job.status, 'failed');
    assert.equal(r.res.body.job.error.code, 'result_unavailable');
    assert.equal(store.files.size, 0);
  });

  test('webhook: verified callbacks complete the job; repeats are idempotent; bad signatures are refused', async () => {
    process.env.AI_TRYON_WEBHOOK_SECRET = 'whsec_dGVzdA==';
    process.env.AI_TRYON_PUBLIC_API_URL = 'https://api.kente.test';
    const jobId = await startJob({
      verifyWebhook: ({ headers }) => headers['webhook-signature'] === 'good',
      parseWebhook: (body) => ({ providerJobId: body.id, status: body.status, resultRef: body.out, errorCode: null }),
      fetchResult: async () => resultJpeg(),
    });
    assert.equal(provider.calls.submit[0].webhookUrl, 'https://api.kente.test/api/tryon/webhooks/scripted');
    const providerJobId = repo.jobs.get(jobId).providerJobId;
    const body = Buffer.from(JSON.stringify({ id: providerJobId, status: 'succeeded', out: 'o' }));

    const bad = await run(tryOnWebhook, { params: { provider: 'scripted' }, body, headers: { 'webhook-signature': 'forged' } });
    assert.equal(bad.res.statusCode, 401);
    assert.equal(repo.jobs.get(jobId).status, 'processing', 'an unverified webhook must not change state');

    const ok1 = await run(tryOnWebhook, { params: { provider: 'scripted' }, body, headers: { 'webhook-signature': 'good' } });
    const ok2 = await run(tryOnWebhook, { params: { provider: 'scripted' }, body, headers: { 'webhook-signature': 'good' } });
    assert.equal(ok1.res.statusCode, 200);
    assert.equal(ok2.res.statusCode, 200);
    assert.equal(repo.jobs.get(jobId).status, 'succeeded');
    assert.equal(store.calls.puts, 1, 'a repeated webhook must not re-download or re-store');
    assert.equal(provider.calls.fetch.length, 1);

    // A late "failed" delivery cannot overwrite a finished job.
    const late = Buffer.from(JSON.stringify({ id: providerJobId, status: 'failed' }));
    await run(tryOnWebhook, { params: { provider: 'scripted' }, body: late, headers: { 'webhook-signature': 'good' } });
    assert.equal(repo.jobs.get(jobId).status, 'succeeded');

    // Unknown job ids are acknowledged without revealing anything.
    const unknown = Buffer.from(JSON.stringify({ id: 'nope', status: 'succeeded' }));
    const u = await run(tryOnWebhook, { params: { provider: 'scripted' }, body: unknown, headers: { 'webhook-signature': 'good' } });
    assert.equal(u.res.statusCode, 200);

    // Without a configured secret the endpoint does not exist.
    delete process.env.AI_TRYON_WEBHOOK_SECRET;
    const off = await run(tryOnWebhook, { params: { provider: 'scripted' }, body, headers: { 'webhook-signature': 'good' } });
    assert.equal(off.res.statusCode, 404);
  });
});

// ---------------------------------------------------------------------------
// reliability: deadlines, interruptions, expiry, cleanup
// ---------------------------------------------------------------------------
describe('sweeper: deadlines, interrupted jobs, expiry and cleanup', () => {
  test('a job past its deadline is expired and cancelled at the provider exactly once', async () => {
    install();
    mockProducts([PRODUCT_A]);
    const { res } = await run(createTryOnJob, await submitReq());
    const jobId = res.body.job.jobId;
    repo.jobs.get(jobId).deadlineAt = new Date(Date.now() - 1000);

    await sweepTryOnJobs();
    await sweepTryOnJobs();
    assert.equal(repo.jobs.get(jobId).status, 'expired');
    assert.equal(repo.jobs.get(jobId).errorCode, 'job_timeout');
    assert.deepEqual(provider.calls.cancel, ['prov-1']);
    assert.equal(provider.calls.submit.length, 1);

    const r = await run(getTryOnJob, { user: { id: 101 }, params: { id: jobId } });
    assert.equal(r.res.body.job.status, 'expired');
    assert.equal(r.res.body.job.error.code, 'job_timeout');
  });

  test('a submit interrupted by a restart is failed, never resubmitted', async () => {
    install();
    const id = '00000000-0000-4000-8000-0000000000aa';
    await repo.insert({ id, userId: 101, productId: 11, provider: 'scripted', idempotencyKey: 'crashed-1', garmentCategory: 'upper_body', timeoutMinutes: 10 });
    repo.jobs.get(id).createdAt = new Date(Date.now() - 10 * 60_000);
    await sweepTryOnJobs();
    assert.equal(repo.jobs.get(id).status, 'failed');
    assert.equal(repo.jobs.get(id).errorCode, 'interrupted');
    assert.equal(provider.calls.submit.length, 0);
  });

  test('jobs left processing across a restart are reconciled by the sweeper', async () => {
    install({
      getJobStatus: async (id) => ({ providerJobId: id, status: 'succeeded', resultRef: 'o', errorCode: null }),
      fetchResult: async () => resultJpeg(),
    });
    mockProducts([PRODUCT_A]);
    const { res } = await run(createTryOnJob, await submitReq());
    makeDue(res.body.job.jobId);
    await sweepTryOnJobs();
    assert.equal(repo.jobs.get(res.body.job.jobId).status, 'succeeded');
    assert.ok(store.files.has(res.body.job.jobId));
  });

  test('expired results are deleted and reported as expired; lost files are never substituted', async () => {
    install({
      getJobStatus: async (id) => ({ providerJobId: id, status: 'succeeded', resultRef: 'o', errorCode: null }),
      fetchResult: async () => resultJpeg(),
    });
    mockProducts([PRODUCT_A]);
    const a = (await run(createTryOnJob, await submitReq())).res.body.job.jobId;
    const b = (await run(createTryOnJob, await submitReq())).res.body.job.jobId;
    makeDue(a);
    makeDue(b);
    await sweepTryOnJobs();
    assert.equal(store.files.size, 2);

    // a: retention passed -> sweeper deletes it.
    repo.jobs.get(a).expiresAt = new Date(Date.now() - 1);
    await sweepTryOnJobs();
    assert.equal(store.files.has(a), false);
    assert.equal(repo.jobs.get(a).status, 'expired');
    const ra = await run(getTryOnJobResult, { user: { id: 101 }, params: { id: a } });
    assert.equal(ra.res.statusCode, 410);
    assert.equal(ra.res.body.code, 'result_expired');

    // b: file vanished (instance disk lost) -> expired, not someone else's image.
    store.files.delete(b);
    const rb = await run(getTryOnJobResult, { user: { id: 101 }, params: { id: b } });
    assert.equal(rb.res.statusCode, 410);
    assert.equal(repo.jobs.get(b).status, 'expired');
  });

  test('orphan result files with no live job are removed', async () => {
    install();
    store.files.set('00000000-0000-4000-8000-0000000000ff', Buffer.from('x'));
    await sweepTryOnJobs();
    assert.equal(store.files.size, 0);
  });
});

// ---------------------------------------------------------------------------
// privacy
// ---------------------------------------------------------------------------
describe('customer photo privacy', () => {
  test('the photo is never written to the job record or the logs', async () => {
    const logged = [];
    install({
      submitJob: async () => { throw Object.assign(new Error('boom'), { tryOnCode: 'provider_unavailable' }); },
    });
    mockProducts([PRODUCT_A]);
    const req = await submitReq();
    mock.method(console, 'log', (...a) => logged.push(a.join(' ')));
    mock.method(console, 'error', (...a) => logged.push(a.join(' ')));
    await run(createTryOnJob, req);
    mock.restoreAll();

    const photoB64 = req.body.modelImage.split(',')[1];
    for (const row of [...repo.jobs.values(), ...repo.calls.inserts]) {
      const text = JSON.stringify(row);
      assert.ok(!text.includes('base64'), 'image data in a job record');
      assert.ok(!text.includes(photoB64.slice(0, 40)));
    }
    assert.ok(logged.length > 0, 'the failure should have been logged');
    for (const line of logged) {
      assert.ok(!line.includes('base64'), `image data logged: ${line.slice(0, 80)}`);
    }
  });
});

// ---------------------------------------------------------------------------
// eligibility endpoint
// ---------------------------------------------------------------------------
describe('GET /api/tryon/product/:productId eligibility', () => {
  const call = (productId) => run(getProductTryOnEligibility, { params: { productId: String(productId) } });

  test('an eligible product reports eligible without reading the image', async () => {
    mockProducts([PRODUCT_A]);
    const { res, err } = await call(11);
    assert.equal(err, null);
    assert.deepEqual(res.body, { productId: 11, enabled: true, eligible: true, reason: null });
  });

  test('an unsupported product is explained, not hidden', async () => {
    mockProducts([{ ...PRODUCT_A, title: 'Kente Table Runner' }]);
    const { res } = await call(11);
    assert.equal(res.body.eligible, false);
    assert.match(res.body.reason, /not a wearable item/);
  });

  test('missing, unapproved and suspended-vendor products all answer the same 404', async () => {
    for (const product of [null, { ...PRODUCT_A, approvalStatus: 'pending' }, { ...PRODUCT_A, vendorId: 5, vendorStatus: 'suspended' }]) {
      mockProducts(product ? [product] : []);
      const { res, err } = await call(11);
      assert.equal(res.statusCode, 404);
      assert.match(err.message, /not available for AI try-on/);
      mock.restoreAll();
    }
  });

  test('reports enabled=false when the feature is off or the provider is not ready', async () => {
    mockProducts([PRODUCT_A]);
    process.env.AI_TRYON_ENABLED = 'false';
    assert.equal((await call(11)).res.body.enabled, false);
    process.env.AI_TRYON_ENABLED = 'true';
    setProviderForTests(null);
    assert.equal((await call(11)).res.body.enabled, false);
  });
});

// ---------------------------------------------------------------------------
// The real FASHN adapter through the real job service (only HTTP is faked)
// ---------------------------------------------------------------------------
describe('FASHN adapter end to end (axios mocked, no spend)', () => {
  test('upload -> run -> poll -> CDN download -> sanitized, owner-only result', async () => {
    install();
    process.env.AI_TRYON_API_KEY = ['fa', 'flow', 'not', 'real'].join('-');
    setProviderForTests(fashnTryOn);
    mockProducts([PRODUCT_A]);

    const posts = [];
    const gets = [];
    let fashnStatus = 'in_queue';
    const cdnUrl = 'https://cdn.fashn.ai/pred-77-u1/output_0.jpeg';
    mock.method(axios, 'post', async (url, body, opts) => {
      posts.push({ url, body, opts });
      return { data: { id: 'pred-77-u1', error: null } };
    });
    mock.method(axios, 'get', async (url, opts) => {
      gets.push({ url, opts });
      if (url === 'https://api.fashn.ai/v1/status/pred-77-u1') {
        return { data: { id: 'pred-77-u1', status: fashnStatus, output: fashnStatus === 'completed' ? [cdnUrl] : null, error: null } };
      }
      if (url === cdnUrl) return { data: await resultJpeg() };
      throw new Error(`unexpected GET ${url}`);
    });

    const { res } = await run(createTryOnJob, await submitReq());
    assert.equal(res.statusCode, 202, JSON.stringify(res.body));
    const jobId = res.body.job.jobId;

    // Exactly one run, carrying this product's own (sanitized) image and the
    // re-encoded photo with its EXIF stripped.
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, 'https://api.fashn.ai/v1/run');
    assert.equal(posts[0].body.model_name, 'tryon-max');
    assert.equal(posts[0].body.inputs.product_image, await sanitizedCatalogImage(PRODUCT_A.img));
    const sentPhoto = Buffer.from(posts[0].body.inputs.model_image.split(',')[1], 'base64');
    assert.equal((await sharp(sentPhoto).metadata()).exif, undefined, 'photo EXIF must not leave the server');

    // Still in FASHN's queue: the submitted job stays in progress.
    makeDue(jobId);
    let r = await run(getTryOnJob, { user: { id: 101 }, params: { id: jobId } });
    assert.equal(r.res.body.job.status, 'processing');

    fashnStatus = 'completed';
    makeDue(jobId);
    r = await run(getTryOnJob, { user: { id: 101 }, params: { id: jobId } });
    assert.equal(r.res.body.job.status, 'succeeded');
    assert.ok(!JSON.stringify(r.res.body).includes('fashn.ai'), 'the provider URL must not reach the browser');

    const cdnGet = gets.find((g) => g.url === cdnUrl);
    assert.ok(cdnGet, 'result downloaded from the CDN');
    assert.equal(cdnGet.opts.headers, undefined, 'no API key sent to the CDN');

    const img = await run(getTryOnJobResult, { user: { id: 101 }, params: { id: jobId } });
    assert.equal(img.res.statusCode, 200);
    assert.equal((await sharp(img.res.body).metadata()).format, 'jpeg');
    const other = await run(getTryOnJobResult, { user: { id: 202 }, params: { id: jobId } });
    assert.equal(other.res.statusCode, 404);
  });
});

