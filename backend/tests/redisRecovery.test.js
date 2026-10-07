// FILE LOCATION: backend/tests/redisRecovery.test.js
// DESCRIPTION: N-10 — the Redis switch threw away everything counted during
//              the outage.
//
// `createRateLimitStore` degrades to a per-instance Map when Redis is
// unreachable, which is the right call for the outage itself: requests keep
// being served and brute force stays capped. The bug was in coming back.
// `viaRedis` simply started using Redis again and abandoned the Map, so the
// allowance an attacker had already spent during the outage was restored in
// full the moment the connection recovered. redteam-final.test.js had already
// seen the symptom from the other direction and written it down as a quirk of
// the transport: "That migration restarts the counter on the Redis side, so
// the same 14-request probe can observe 8 allowed instead of 5."
//
// The merge is `max(redis, local)`, never a sum. The two counts can overlap —
// a request counted locally just before Redis returned may also be counted by
// Redis — and a sum would both let a caller manufacture attempts by flapping
// the connection and let a limiter exceed its own `max`.
//
// It runs BEFORE the pending operation, so the first request on the restored
// connection already sees the carried total; running it after would let one
// more attempt through a limit that was already exhausted.
//
// These tests are transport-free on purpose: `sendCommand` is injected, so
// they assert the exact Redis commands rather than needing a server. The one
// assumption worth pinning independently is that `${prefix}${key}` is really
// how rate-limit-redis builds its keys — a mismatch would merge into orphan
// keys the limiter never reads, silently and forever. That is checked against
// the library itself below.
//
// NOTE: pure — no database, runs in the no-DB CI job.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RedisStore } from 'rate-limit-redis';

const { carryLocalCountsForward } = await import('../utils/redisClient.js');

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/**
 * Records every command and answers from a scripted table.
 * `kv` maps full Redis key -> value; `ttls` maps full key -> TTL reply
 * (-2 absent, -1 no expiry, else seconds).
 */
const makeBus = ({ kv = {}, ttls = {} } = {}) => {
  const commands = [];
  const sendCommand = async ([op, ...args]) => {
    commands.push([op, ...args]);
    const key = args[0];
    switch (op) {
      case 'GET':
        return kv[key] === undefined ? null : kv[key];
      case 'INCRBY': {
        const next = (Number(kv[key]) || 0) + Number(args[1]);
        kv[key] = String(next);
        return String(next);
      }
      case 'TTL':
        if (ttls[key] !== undefined) return ttls[key];
        return kv[key] === undefined ? -2 : -1;
      case 'EXPIRE':
        ttls[key] = Number(args[1]);
        return 1;
      default:
        throw new Error(`unexpected command in test bus: ${op}`);
    }
  };
  const signed = () => commands.map((c) => c.join(' '));
  return { sendCommand, commands, kv, ttls, signed };
};

describe('N-10: counts survive the switch back to Redis', () => {
  test('an empty Redis is topped up to the local total and given the remaining window', async () => {
    const bus = makeBus();
    const carried = await carryLocalCountsForward({
      sendCommand: bus.sendCommand,
      prefix: 'rl:auth',
      entries: new Map([['::ffff:1.2.3.4', { totalHits: 4, resetAt: 60_000 }]]),
      now: 0,
    });
    assert.equal(carried, 1);
    assert.deepEqual(bus.signed(), [
      'GET rl:auth::ffff:1.2.3.4',
      'INCRBY rl:auth::ffff:1.2.3.4 4',
      'TTL rl:auth::ffff:1.2.3.4',
      'EXPIRE rl:auth::ffff:1.2.3.4 60',
    ]);
    assert.equal(bus.kv['rl:auth::ffff:1.2.3.4'], '4');
  });

  test('a HIGHER Redis count is left alone — max, not sum', async () => {
    // The two counts can overlap: something counted locally right before the
    // connection recovered may already be in Redis. Summing would hand the
    // caller attempts they never spent and could push a limiter past its max.
    const key = 'rl:auth::ffff:9.9.9.9';
    const bus = makeBus({ kv: { [key]: '10' }, ttls: { [key]: 500 } });
    await carryLocalCountsForward({
      sendCommand: bus.sendCommand,
      prefix: 'rl:auth',
      entries: new Map([['::ffff:9.9.9.9', { totalHits: 4, resetAt: 60_000 }]]),
      now: 0,
    });
    assert.deepEqual(bus.signed(), [
      `GET ${key}`,
      `TTL ${key}`,
    ]);
    assert.equal(bus.kv[key], '10', 'Redis already had the higher count');
  });

  test('a LOWER Redis count is topped up by the difference only', async () => {
    const key = 'rl:auth::ffff:5.5.5.5';
    const bus = makeBus({ kv: { [key]: '2' }, ttls: { [key]: 400 } });
    await carryLocalCountsForward({
      sendCommand: bus.sendCommand,
      prefix: 'rl:auth',
      entries: new Map([['::ffff:5.5.5.5', { totalHits: 5, resetAt: 60_000 }]]),
      now: 0,
    });
    assert.ok(bus.signed().includes(`INCRBY ${key} 3`), `got ${bus.signed().join(' | ')}`);
    assert.equal(bus.kv[key], '5');
    assert.ok(!bus.signed().some((c) => c.startsWith('EXPIRE')), 're-issuing EXPIRE restarts the window');
  });

  test('a key that already has a TTL keeps it — EXPIRE would restart the window', async () => {
    const key = 'rl:auth::ffff:7.7.7.7';
    const bus = makeBus({ kv: { [key]: '1' }, ttls: { [key]: 30 } });
    await carryLocalCountsForward({
      sendCommand: bus.sendCommand,
      prefix: 'rl:auth',
      entries: new Map([['::ffff:7.7.7.7', { totalHits: 4, resetAt: 60_000 }]]),
      now: 0,
    });
    assert.ok(
      !bus.signed().some((c) => c.startsWith('EXPIRE')),
      'a 30-second key was just given a 60-second life',
    );
    assert.equal(bus.ttls[key], 30);
  });

  test('a key present with NO expiry gets one (-1)', async () => {
    const key = 'rl:auth::ffff:8.8.8.8';
    const bus = makeBus({ kv: { [key]: '100' }, ttls: { [key]: -1 } });
    await carryLocalCountsForward({
      sendCommand: bus.sendCommand,
      prefix: 'rl:auth',
      entries: new Map([['::ffff:8.8.8.8', { totalHits: 4, resetAt: 30_000 }]]),
      now: 0,
    });
    assert.ok(bus.signed().includes(`EXPIRE ${key} 30`), `got ${bus.signed().join(' | ')}`);
  });

  test('an entry whose local window already closed is not carried', async () => {
    const bus = makeBus();
    const carried = await carryLocalCountsForward({
      sendCommand: bus.sendCommand,
      prefix: 'rl:auth',
      entries: new Map([
        ['expired', { totalHits: 9, resetAt: 100 }],
        ['live', { totalHits: 2, resetAt: 50_000 }],
      ]),
      now: 10_000,
    });
    assert.equal(carried, 1, 'the expired entry was carried — its window is over');
    assert.ok(!bus.signed().some((c) => c.includes('expired')), 'expired key reached Redis');
    assert.ok(bus.signed().some((c) => c.includes('rl:authlive')));
  });

  test('a zero-hit entry issues no commands at all', async () => {
    const bus = makeBus();
    const carried = await carryLocalCountsForward({
      sendCommand: bus.sendCommand,
      prefix: 'rl:auth',
      entries: new Map([['cleared', { totalHits: 0, resetAt: 30_000 }]]),
      now: 0,
    });
    assert.equal(carried, 0);
    assert.deepEqual(bus.signed(), []);
  });

  test('the TTL handed to Redis is the local window that is actually left', async () => {
    const bus = makeBus();
    await carryLocalCountsForward({
      sendCommand: bus.sendCommand,
      prefix: 'rl:auth',
      entries: new Map([['k', { totalHits: 1, resetAt: 1_500 }]]),
      now: 0,
    });
    assert.ok(bus.signed().includes('EXPIRE rl:authk 2'), `got ${bus.signed().join(' | ')}`);
  });
});

// ---------------------------------------------------------------------------
// The one assumption that cannot be tested from this side alone
// ---------------------------------------------------------------------------
describe('N-10: the merged key is the key the limiter reads', () => {
  test('rate-limit-redis builds keys as `${prefix}${key}`', async () => {
    // carryLocalCountsForward reconstructs the key itself instead of going
    // through the store (the store exposes no way to set an absolute count).
    // If rate-limit-redis ever changes that format the merge would write to
    // keys nobody reads and the fix would fail silently — so the shape is
    // asserted against the library, not against our own restatement of it.
    const seen = [];
    const store = new RedisStore({
      sendCommand: (...args) => {
        seen.push(args);
        return Promise.resolve(null);
      },
      prefix: 'rl:probe:',
    });
    // resetKey sends a bare `DEL <key>` — no script loading, no reply parsing —
    // and goes through the same prefixKey() every other method uses.
    await store.resetKey('::ffff:1.2.3.4');
    assert.equal(store.prefix, 'rl:probe:', 'the store stopped exposing its prefix');
    assert.deepEqual(seen, [['DEL', 'rl:probe:::ffff:1.2.3.4']]);
  });

  test('the store passes its OWN prefix into the carry', () => {
    const src = read('../utils/redisClient.js');
    const viaRedis = src.slice(src.indexOf('const viaRedis'), src.indexOf('function reportDegraded'));
    assert.match(viaRedis, /prefix: redis\.prefix/, 'the carry hard-codes a prefix the store does not use');
  });
});

// ---------------------------------------------------------------------------
// Ordering: a merge that runs too late lets one more attempt through
// ---------------------------------------------------------------------------
describe('N-10: the carry runs before the request is counted', () => {
  const src = read('../utils/redisClient.js');
  const viaRedis = src.slice(src.indexOf('const viaRedis'), src.indexOf('function reportDegraded'));

  test('carry happens before the operation, not after', () => {
    const carryAt = viaRedis.indexOf('await carryLocalCountsForward');
    const opAt = viaRedis.indexOf('return await op()');
    assert.ok(carryAt > -1, 'viaRedis no longer carries local counts');
    assert.ok(opAt > -1, 'viaRedis no longer calls the operation');
    assert.ok(carryAt < opAt, 'the request is counted BEFORE the outage counts are merged — one attempt slips past');
  });

  test('local is cleared only after the carry succeeded', () => {
    // A failure has to leave `local` in place: clearing it in a finally would
    // discard exactly the counts this fix exists to preserve, and the retry
    // would have nothing left to merge.
    const carryAt = viaRedis.indexOf('await carryLocalCountsForward');
    const clearAt = viaRedis.indexOf('local.clear()');
    assert.ok(clearAt > carryAt, 'local is cleared before/without the carry running');
    assert.ok(
      !/finally\s*\{[^}]*local\.clear\(\)/.test(viaRedis),
      'local.clear() sits in a finally block — a failed carry would still discard the counts',
    );
    // The clear must be inside the try, after the carry: prove no clear exists
    // between the start of the function and the carry.
    assert.equal(
      (viaRedis.slice(0, carryAt).match(/local\.clear\(\)/g) || []).length,
      0,
      'local is cleared before the carry is attempted',
    );
  });

  test('a failed carry degrades instead of proceeding with a stale counter', () => {
    // The carry sits inside the same try as `op()`, so a throw lands in the
    // catch and the request is served from `local` — limits stay enforced
    // and `local` keeps its counts for the next attempt.
    const carryAt = viaRedis.indexOf('await carryLocalCountsForward');
    const catchAt = viaRedis.indexOf('} catch (err)');
    assert.ok(carryAt < catchAt, 'the carry is outside the try, so its failure is not handled');
    assert.match(viaRedis, /reportDegraded\(err\.message\);\s*\n\s*return fallback\(\);/);
  });

  test('the carry is gated on having something to carry', () => {
    assert.match(viaRedis, /if \(local\.size > 0\)/, 'the carry is not guarded — every request would pay for it');
  });
});
