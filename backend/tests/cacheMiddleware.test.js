// FILE LOCATION: backend/tests/cacheMiddleware.test.js
// DESCRIPTION: The response cache replays a hit with status 200, so it must
//              only ever store successful bodies. It used to store every
//              res.json body: one transient DB error on GET /api/products/:id
//              was then served as "200 { message: 'An error occurred' }" to
//              every visitor for the cache TTL. No database is needed.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cacheMiddleware, clearAllCache } from '../middleware/cacheMiddleware.js';

const run = (mw, url, handler, user) => new Promise((resolve) => {
  const req = { method: 'GET', originalUrl: url, url, user };
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; resolve(this); return this; },
  };
  mw(req, res, () => handler(req, res));
});

describe('cacheMiddleware', () => {
  beforeEach(() => clearAllCache());

  test('a successful body is cached and replayed', async () => {
    const mw = cacheMiddleware(60);
    let calls = 0;
    const handler = (_req, res) => { calls += 1; res.json({ id: 1 }); };
    await run(mw, '/api/products/1', handler);
    const second = await run(mw, '/api/products/1', handler);
    assert.equal(calls, 1, 'second request is served from cache');
    assert.deepEqual(second.body, { id: 1 });
  });

  for (const status of [404, 500, 503]) {
    test(`a ${status} body is never cached (a hit would replay it as 200)`, async () => {
      const mw = cacheMiddleware(60);
      let calls = 0;
      const handler = (_req, res) => {
        calls += 1;
        if (calls === 1) res.status(status).json({ message: 'An error occurred' });
        else res.json({ id: 2, title: 'Kente' });
      };
      const first = await run(mw, '/api/products/2', handler);
      assert.equal(first.statusCode, status);
      const second = await run(mw, '/api/products/2', handler);
      assert.equal(calls, 2, 'the handler runs again after an error');
      assert.equal(second.statusCode, 200);
      assert.deepEqual(second.body, { id: 2, title: 'Kente' });
    });
  }

  test('entries are per user', async () => {
    const mw = cacheMiddleware(60);
    const handler = (req, res) => res.json({ who: req.user?.id ?? 'anon' });
    await run(mw, '/api/x', handler, { id: 7 });
    const anon = await run(mw, '/api/x', handler);
    assert.deepEqual(anon.body, { who: 'anon' });
  });
});
