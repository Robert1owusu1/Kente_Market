// FILE LOCATION: backend/tests/tryOnGenerateFlow.test.js
// DESCRIPTION: Integration-level suite for POST /api/tryon/generate — the
// controller driven directly with fake req/res, a mocked MySQL pool and a
// mocked Replicate client. No network, no database, no provider spend, and
// only synthetic images.
//
// What this proves beyond the unit suites:
//   - the happy path forwards ONLY sanitized (re-encoded, EXIF-free) bytes
//     and server-derived product text to the provider;
//   - an invalid photo or unknown/unapproved product is refused BEFORE the
//     daily credit row is touched (a rejected request must not spend);
//   - the in-flight concurrency caps answer 429 before the credit is spent;
//   - provider failures surface as controlled 429/502, never provider text.
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import pool from '../config/db.js';
import axios from 'axios';
import { generateTryOn, tryOnTestHooks } from '../controllers/tryOnController.js';

const SAVE_ENV = ['AI_TRYON_ENABLED', 'REPLICATE_API_TOKEN', 'AI_TRYON_ALLOWED_HOSTS'];

const withTryOnEnabled = async (fn) => {
  const saved = Object.fromEntries(SAVE_ENV.map((k) => [k, process.env[k]]));
  process.env.AI_TRYON_ENABLED = 'true';
  process.env.REPLICATE_API_TOKEN = 'test-token-not-a-real-secret';
  try {
    return await fn();
  } finally {
    for (const k of SAVE_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
};

/** Minimal express-like res recorder. */
const makeRes = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
};

const makeReq = (body, userId = 101) => ({ body, user: { id: userId } });

/** Solid synthetic JPEG — a stand-in for a user photo (never a real one). */
const photoDataUri = async () => {
  const buf = await sharp({ create: { width: 120, height: 160, channels: 3, background: { r: 120, g: 60, b: 30 } } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'UserGPSData' } })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
};

/**
 * Mock pool.execute by SQL shape. Product lookups return `product`; the
 * credit table behaves as a counter starting at `creditCount` (the insert
 * increments and the select reads it back).
 */
const mockPool = ({ product, creditCount = 1 }) => {
  const calls = { creditWrites: 0 };
  mock.method(pool, 'execute', async (sql) => {
    if (/FROM product WHERE id/.test(sql)) {
      return [product ? [product] : []];
    }
    if (/INSERT INTO ai_tryon_usage/.test(sql)) {
      calls.creditWrites += 1;
      return [{ affectedRows: 1 }];
    }
    if (/SELECT count FROM ai_tryon_usage/.test(sql)) {
      return [[{ count: creditCount + calls.creditWrites }]];
    }
    throw new Error(`unexpected SQL in test: ${sql}`);
  });
  return calls;
};

describe('POST /api/tryon/generate flow (mocked DB + provider)', () => {
  beforeEach(() => {
    // Keep the shared in-flight map clean between tests.
    tryOnTestHooks.predictions.clear();
  });

  afterEach(() => {
    mock.restoreAll();
    tryOnTestHooks.predictions.clear();
  });

  test('happy path: only sanitized bytes and server-derived text reach the provider', async () => {
    await withTryOnEnabled(async () => {
      const calls = mockPool({
        product: { id: 7, title: '  Adweneasa   Royal Wrap ', img: '/images/image2.jpeg', category: 'Kente Wraps', approvalStatus: 'approved' },
      });
      const replicateCalls = [];
      mock.method(axios, 'post', async (url, body) => {
        replicateCalls.push({ url, body });
        return { data: { id: 'pred-happy-1' } };
      });

      const res = makeRes();
      let nextErr = null;
      await generateTryOn(makeReq({ modelImage: await photoDataUri(), productId: 7 }), res, (e) => { nextErr = e; });

      assert.equal(nextErr, null, `expected success, got: ${nextErr?.message}`);
      assert.equal(res.statusCode, 202);
      assert.equal(res.body.predictionId, 'pred-happy-1');
      assert.equal(calls.creditWrites, 1, 'the daily credit must be consumed exactly once');

      assert.equal(replicateCalls.length, 1);
      const input = replicateCalls[0].body.input;
      assert.ok(input.human_img.startsWith('data:image/jpeg;base64,'), 'model image must be a sanitized jpeg data URI');
      assert.ok(input.garm_img.startsWith('data:image/jpeg;base64,'), 'local catalog garment must be inlined as sanitized jpeg');
      assert.ok(!Buffer.from(input.human_img.split(',')[1], 'base64').toString('latin1').includes('UserGPSData'),
        'user EXIF/GPS data was forwarded to the provider');
      assert.equal(input.garment_des, 'Adweneasa Royal Wrap', 'garment name must be server-derived and trimmed');
      assert.equal(input.category, 'upper_body', 'garment category must be mapped server-side');
      assert.ok(String(replicateCalls[0].url).startsWith('https://api.replicate.com/v1/predictions'));
    });
  });

  test('an invalid photo is refused and NO credit is consumed', async () => {
    await withTryOnEnabled(async () => {
      const calls = mockPool({ product: { id: 7, title: 'T', img: '/images/image2.jpeg', category: '', approvalStatus: 'approved' } });
      const post = mock.method(axios, 'post', async () => { throw new Error('must not be called'); });

      const res = makeRes();
      let nextErr = null;
      const pdfAsJpeg = `data:image/jpeg;base64,${Buffer.from('%PDF-1.4 fake pdf payload').toString('base64')}`;
      await generateTryOn(makeReq({ modelImage: pdfAsJpeg, productId: 7 }), res, (e) => { nextErr = e; });

      assert.equal(res.statusCode, 400);
      assert.match(nextErr.message, /not a valid jpeg, png or webp/);
      assert.equal(calls.creditWrites, 0, 'a rejected photo must not burn a daily credit');
      assert.equal(post.mock.callCount(), 0, 'the provider must not be called');
    });
  });

  test('a URL as modelImage is refused (it would bypass sanitization)', async () => {
    await withTryOnEnabled(async () => {
      const calls = mockPool({ product: { id: 7, title: 'T', img: '/images/image2.jpeg', category: '', approvalStatus: 'approved' } });
      const res = makeRes();
      let nextErr = null;
      await generateTryOn(
        makeReq({ modelImage: 'https://cdn.kentemarket.com/x.jpg', productId: 7 }),
        res,
        (e) => { nextErr = e; },
      );
      assert.equal(res.statusCode, 400);
      assert.match(nextErr.message, /uploaded photo/);
      assert.equal(calls.creditWrites, 0);
    });
  });

  test('unknown and unapproved products answer 404 without spending', async () => {
    await withTryOnEnabled(async () => {
      for (const product of [
        undefined, // no such row
        { id: 7, title: 'T', img: '/images/image2.jpeg', category: '', approvalStatus: 'pending' },
        { id: 7, title: 'T', img: '/images/image2.jpeg', category: '', approvalStatus: 'rejected' },
      ]) {
        const calls = mockPool({ product });
        const post = mock.method(axios, 'post', async () => { throw new Error('must not be called'); });
        const res = makeRes();
        let nextErr = null;
        await generateTryOn(makeReq({ modelImage: await photoDataUri(), productId: 7 }), res, (e) => { nextErr = e; });
        assert.equal(res.statusCode, 404, `expected 404 for ${JSON.stringify(product)}`);
        assert.match(nextErr.message, /not available for AI try-on/);
        assert.equal(calls.creditWrites, 0);
        assert.equal(post.mock.callCount(), 0);
        mock.restoreAll();
      }
    });
  });

  test('per-user and global concurrency caps answer 429 before spending', async () => {
    await withTryOnEnabled(async () => {
      const calls = mockPool({ product: { id: 7, title: 'T', img: '/images/image2.jpeg', category: '', approvalStatus: 'approved' } });
      const post = mock.method(axios, 'post', async () => ({ data: { id: 'pred-x' } }));
      const photo = await photoDataUri();

      // Saturate THIS user's slots.
      for (let i = 0; i < tryOnTestHooks.MAX_ACTIVE_PER_USER; i++) {
        tryOnTestHooks.predictions.set(`seed-u-${i}`, { userId: 101, status: 'processing', createdAt: Date.now() });
      }
      const res1 = makeRes();
      let err1 = null;
      await generateTryOn(makeReq({ modelImage: photo, productId: 7 }), res1, (e) => { err1 = e; });
      assert.equal(res1.statusCode, 429);
      assert.match(err1.message, /already have a try-on in progress/);
      assert.equal(calls.creditWrites, 0, 'capacity refusal must not burn a credit');
      assert.equal(post.mock.callCount(), 0);

      // Saturate the GLOBAL slots with other users' jobs.
      tryOnTestHooks.predictions.clear();
      for (let i = 0; i < tryOnTestHooks.MAX_ACTIVE_GLOBAL; i++) {
        tryOnTestHooks.predictions.set(`seed-g-${i}`, { userId: 999, status: 'processing', createdAt: Date.now() });
      }
      const res2 = makeRes();
      let err2 = null;
      await generateTryOn(makeReq({ modelImage: photo, productId: 7 }), res2, (e) => { err2 = e; });
      assert.equal(res2.statusCode, 429);
      assert.match(err2.message, /capacity/);
      assert.equal(calls.creditWrites, 0);
      assert.equal(post.mock.callCount(), 0);
    });
  });

  test('daily limit exhaustion answers 429 and does not call the provider', async () => {
    await withTryOnEnabled(async () => {
      mockPool({ product: { id: 7, title: 'T', img: '/images/image2.jpeg', category: '', approvalStatus: 'approved' }, creditCount: 999 });
      const post = mock.method(axios, 'post', async () => ({ data: { id: 'pred-y' } }));
      const res = makeRes();
      let nextErr = null;
      await generateTryOn(makeReq({ modelImage: await photoDataUri(), productId: 7 }), res, (e) => { nextErr = e; });
      assert.equal(res.statusCode, 429);
      assert.match(nextErr.message, /daily limit/);
      assert.equal(post.mock.callCount(), 0);
    });
  });

  test('provider failures surface as controlled 429/502 with no provider text', async () => {
    await withTryOnEnabled(async () => {
      mockPool({ product: { id: 7, title: 'T', img: '/images/image2.jpeg', category: '', approvalStatus: 'approved' } });
      const photo = await photoDataUri();

      // 402 = provider out of credit → controlled 429.
      mock.method(axios, 'post', async () => {
        const err = new Error('Request failed with status code 402');
        err.response = { status: 402, data: { detail: 'insufficient credit for account r8w9 token r8_xxx' } };
        throw err;
      });
      const res1 = makeRes();
      let err1 = null;
      await generateTryOn(makeReq({ modelImage: photo, productId: 7 }), res1, (e) => { err1 = e; });
      assert.equal(res1.statusCode, 429);
      assert.match(err1.message, /out of capacity/);
      assert.ok(!err1.message.includes('token'), 'provider detail leaked into the client message');

      // Generic upstream failure → 502 (errorMiddleware genericizes 5xx text).
      mock.restoreAll();
      mockPool({ product: { id: 7, title: 'T', img: '/images/image2.jpeg', category: '', approvalStatus: 'approved' } });
      mock.method(axios, 'post', async () => {
        const err = new Error('socket hang up');
        err.response = { status: 500, data: { detail: 'Internal provider stack trace /etc/passwd' } };
        throw err;
      });
      const res2 = makeRes();
      let err2 = null;
      await generateTryOn(makeReq({ modelImage: photo, productId: 7 }), res2, (e) => { err2 = e; });
      assert.equal(res2.statusCode, 502);
      assert.ok(!err2.message.includes('/etc/passwd'), 'provider detail leaked into the client message');
    });
  });

  test('the feature flag off answers 503 and spends nothing', async () => {
    delete process.env.AI_TRYON_ENABLED;
    const calls = mockPool({ product: null });
    const post = mock.method(axios, 'post', async () => ({ data: { id: 'pred-z' } }));
    const res = makeRes();
    let nextErr = null;
    await generateTryOn(makeReq({ modelImage: await photoDataUri(), productId: 7 }), res, (e) => { nextErr = e; });
    assert.equal(res.statusCode, 503);
    assert.match(nextErr.message, /not enabled/);
    assert.equal(calls.creditWrites, 0);
    assert.equal(post.mock.callCount(), 0);
  });
});
