// FILE LOCATION: backend/tests/metricsAuth.test.js
// DESCRIPTION: X4a — `/metrics` was unauthenticated.
//
// What the endpoint publishes: `http_requests_total` and
// `http_request_duration_seconds` labelled with method/route/status_code
// (i.e. every route plus its traffic shape), `db_pool_usage`,
// `rate_limit_hits_total` per limiter, and the order/escrow counters. No PII,
// but a reconnaissance-grade map of the application — and it sat *outside*
// `/api/`, so `apiLimiter` never covered it either.
//
// These are behavioural tests of the guard itself (not source greps): the
// middleware is invoked the way Express invokes it, and the assertions are on
// the status it emits and whether it hands over to the handler. A separate
// static test pins the wiring in `server.js`, because a correct guard that is
// no longer mounted protects nothing.
//
// The fail-closed half matters most: with `METRICS_TOKEN` unset, an
// unconfigured deploy must not advertise the endpoint at all.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { metricsTokenGuard, safeTokenEqual } from '../utils/metrics.js';

const ORIGINAL_TOKEN = process.env.METRICS_TOKEN;
after(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.METRICS_TOKEN;
  else process.env.METRICS_TOKEN = ORIGINAL_TOKEN;
});

/** Express-shaped request carrying a single header (or none). */
const makeReq = (token) => ({
  headers: token === undefined ? {} : { 'x-metrics-token': token },
  get(name) {
    return this.headers[name];
  },
});

/** Express-shaped response that records what it was told to send. */
const makeRes = () => {
  const res = {
    statusCode: 200,
    contentType: null,
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    type(value) {
      res.contentType = value;
      return res;
    },
    send(value) {
      res.body = value;
      return res;
    },
  };
  return res;
};

/** Run the guard and report whether it called `next()`. */
const runGuard = (req) => {
  const res = makeRes();
  let passed = false;
  metricsTokenGuard(req, res, () => {
    passed = true;
  });
  return { res, passed };
};

describe('X4a: /metrics is gated', () => {
  test('fails closed with 404 when no token is configured', () => {
    delete process.env.METRICS_TOKEN;
    const { res, passed } = runGuard(makeReq('anything'));
    assert.equal(passed, false, 'handler must not run when unconfigured');
    assert.equal(res.statusCode, 404);
    // 404, not 401: an unconfigured deploy must not reveal that the endpoint
    // exists, or scanners would learn to look for it.
    assert.notEqual(res.statusCode, 401);
  });

  test('treats an empty METRICS_TOKEN as unconfigured', () => {
    process.env.METRICS_TOKEN = '';
    const { res, passed } = runGuard(makeReq(''));
    assert.equal(passed, false);
    assert.equal(res.statusCode, 404, 'an empty secret must not act as a wildcard');
  });

  test('rejects a request with no token header', () => {
    process.env.METRICS_TOKEN = 'correct-horse-battery-staple';
    const { res, passed } = runGuard(makeReq(undefined));
    assert.equal(passed, false);
    assert.equal(res.statusCode, 401);
  });

  test('rejects a wrong token, short and long alike, with the same answer', () => {
    process.env.METRICS_TOKEN = 'correct-horse-battery-staple';
    for (const wrong of ['nope', 'correct-horse-battery-stapl', 'correct-horse-battery-staple!', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']) {
      const { res, passed } = runGuard(makeReq(wrong));
      assert.equal(passed, false, `"${wrong}" must not pass`);
      assert.equal(res.statusCode, 401, 'wrong-length and right-length wrong tokens must look identical');
    }
  });

  test('rejects a prefix of the real token (no startsWith shortcut)', () => {
    process.env.METRICS_TOKEN = 'correct-horse-battery-staple';
    const { res, passed } = runGuard(makeReq('correct-horse'));
    assert.equal(passed, false);
    assert.equal(res.statusCode, 401);
  });

  test('rejects a header that merely contains the real token', () => {
    process.env.METRICS_TOKEN = 'correct-horse-battery-staple';
    const { res, passed } = runGuard(makeReq(`xx correct-horse-battery-staple xx`));
    assert.equal(passed, false);
    assert.equal(res.statusCode, 401);
  });

  test('lets the exact token through, exactly once', () => {
    process.env.METRICS_TOKEN = 'correct-horse-battery-staple';
    const { res, passed } = runGuard(makeReq('correct-horse-battery-staple'));
    assert.equal(passed, true, 'the correct token must reach the handler');
    assert.equal(res.statusCode, 200, 'a passing guard must not write a status of its own');
    assert.equal(res.body, undefined);
  });

  test('a guard running behind `req.get` (Express) behaves identically', () => {
    process.env.METRICS_TOKEN = 'correct-horse-battery-staple';
    // Express exposes headers through `req.get()`; the guard must not depend
    // on which shape it is handed.
    const expressShaped = { get: (name) => (name === 'x-metrics-token' ? 'correct-horse-battery-staple' : undefined) };
    assert.equal(runGuard(expressShaped).passed, true);
    const expressNoHeader = { get: () => undefined };
    assert.equal(runGuard(expressNoHeader).passed, false);
  });
});

describe('X4a: the comparison has no length oracle', () => {
  test('safeTokenEqual is exact-match only', () => {
    const token = 'correct-horse-battery-staple';
    assert.equal(safeTokenEqual(token, token), true);
    assert.equal(safeTokenEqual(token, `${token}x`), false);
    assert.equal(safeTokenEqual(`x${token}`, token), false);
    assert.equal(safeTokenEqual('', ''), true, 'empty equals empty — the guard rejects empties before this is reachable');
  });

  test('the source uses crypto.timingSafeEqual, not ===', () => {
    // `===` (or `a.length !== b.length` short-circuit) would reintroduce the
    // timing side channel this guard exists to remove. Hashing both sides
    // first is what makes the compared buffers a fixed 32 bytes, so
    // timingSafeEqual never bails out early.
    const src = readFileSync(fileURLToPath(new URL('../utils/metrics.js', import.meta.url)), 'utf8');
    assert.match(src, /crypto\.timingSafeEqual\(/, 'constant-time comparison was replaced');
    assert.match(src, /createHash\('sha256'\)/, 'digest-first comparison was removed, restoring a length oracle');
  });
});

describe('X4a: the guard is actually wired to the route', () => {
  // Match on real code lines only. A naive regex over the whole file matches
  // *comments* too — this very file once did, because the explanatory comment
  // above the mount quoted the old unguarded form. Stripping the comment
  // tail from each line (rather than blanket-stripping `//` across the file)
  // keeps URLs inside string literals intact.
  const codeLines = readFileSync(fileURLToPath(new URL('../server.js', import.meta.url)), 'utf8')
    .split('\n')
    .map((line) => line.replace(/\/\/[^\r\n]*/, ''))
    .filter((line) => !/^\s*\/\*/.test(line));

  const mountLine = codeLines.find((line) => /app\.get\(\s*['"]\/metrics['"]/.test(line));

  test('/metrics mounts the guard in front of the handler', () => {
    assert.ok(mountLine, 'no live app.get("/metrics", …) call found in server.js');
    assert.match(mountLine, /metricsTokenGuard/, '/metrics no longer passes through metricsTokenGuard');
    assert.match(mountLine, /metricsHandler/, '/metrics no longer reaches the handler');
    assert.ok(
      mountLine.indexOf('metricsTokenGuard') < mountLine.indexOf('metricsHandler'),
      'the guard must run before the handler',
    );
  });

  test('the old unguarded mount is gone', () => {
    const unguarded = codeLines.find((line) =>
      /app\.get\(\s*['"]\/metrics['"],\s*metricsHandler\s*\)/.test(line),
    );
    assert.equal(unguarded, undefined, 'server.js reverted to the public /metrics mount');
  });

  test('health endpoints stay public (do not over-apply the guard)', () => {
    // Prometheus and the platform both scrape these; gating them would take
    // the service out of rotation for a metrics problem.
    const joined = codeLines.join('\n');
    for (const route of ['/health', '/health/ready', '/health/live']) {
      assert.ok(joined.includes(`'${route}'`), `${route} disappeared from server.js`);
    }
    assert.ok(
      !/app\.get\(\s*['"]\/health[^']*['"],\s*metricsTokenGuard/.test(joined),
      'health endpoints must not be behind the metrics token',
    );
  });
});
