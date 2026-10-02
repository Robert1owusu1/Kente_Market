// FILE LOCATION: utils/redisClient.js
// DESCRIPTION: Shared Redis client + rate-limit store factory. Fully optional —
// active only when REDIS_URL is set. Without it the app keeps working on a
// single instance with in-memory state, so enabling Redis later (multi-instance
// scale-out) is purely additive and needs no code changes.

import { createClient } from 'redis';
import { RedisStore } from 'rate-limit-redis';

let _client = null;

export const isRedisConfigured = () => Boolean(process.env.REDIS_URL);

export const getRedisClient = () => {
  if (!isRedisConfigured()) return null;
  if (_client) return _client;

  _client = createClient({
    url: process.env.REDIS_URL,
    // TLS handshake to a remote Redis (e.g. Upstash) routinely takes 1-6s from
    // this host; node-redis's default connectTimeout is 5s, which surfaced as
    // intermittent "Connection timeout" on cold connects.
    socket: { connectTimeout: 15_000 },
  });
  _client.on('error', (err) => {
 console.error(' Redis error:', err.message);
  });
  _client.connect().catch((err) => {
 console.error(' Redis connect failed:', err.message);
  });
  return _client;
};

/**
 * Build an express-rate-limit store backed by Redis, or `undefined` when Redis
 * is not configured (express-rate-limit then uses its own default MemoryStore).
 * Each limiter must pass a distinct `prefix` so limiters do not share keys.
 *
 * When Redis IS configured but currently unreachable, the store keeps limiting
 * using a per-instance in-memory counter instead of going open. This used to
 * return the string '0', which is a hard fail-open: express-rate-limit derives
 * its own local total from the value the store hands back, so a constant 0
 * means the counter never advances and the limiter NEVER trips. That silently
 * disabled every limiter - including authLimiter and staffAuthLimiter - for
 * the entire outage, leaving login brute-force unlimited. Degrading to
 * per-instance limits is strictly better than both alternatives: requests are
 * still served, and brute force is still capped.
 */
export const createRateLimitStore = (prefix) => {
  const client = getRedisClient();
  if (!client) return undefined;

  const redis = new RedisStore({
    sendCommand: (...args) => client.sendCommand(args),
    prefix,
  });

  // Fallback used only while Redis is down. Keyed and windowed the same way as
  // the Redis path so a limiter's configured max still means the same thing.
  // windowMs is only known once express-rate-limit calls init(), so it starts
  // at the 1h default and is corrected in init() below - otherwise every
  // limiter would fall back to a 1h window even though most use 15 min.
  const local = new Map();
  let localWindowMs = 60 * 60 * 1000;
  const localStore = {
    async increment(key) {
      const now = Date.now();
      const existing = local.get(key);
      // Internal expiry is kept as an epoch number for comparisons, but the
      // returned resetTime MUST be a Date: express-rate-limit calls
      // resetTime.getTime() when writing RateLimit-* draft-6 headers, and a
      // plain number throws (500) on every request while Redis is degraded.
      const entry =
        existing && existing.resetAt > now
          ? existing
          : { totalHits: 0, resetAt: now + localWindowMs };
      entry.totalHits += 1;
      local.set(key, entry);
      // Opportunistic sweep so a long outage cannot grow this map unbounded.
      if (local.size > 10_000) {
        for (const [k, v] of local) if (v.resetAt <= now) local.delete(k);
      }
      return { totalHits: entry.totalHits, resetTime: new Date(entry.resetAt) };
    },
    async decrement(key) {
      const entry = local.get(key);
      if (entry && entry.totalHits > 0) entry.totalHits -= 1;
    },
    async resetKey(key) {
      local.delete(key);
    },
    async resetAll() {
      local.clear();
    },
  };

  let warnedAt = 0;
  let initOptions = null;
  let initPromise = null;

  // express-rate-limit calls init() SYNCHRONOUSLY when the limiter is built,
  // but our connect() is still in flight (TLS to a remote Redis takes 1-6s),
  // so client.isReady is false and the options were previously dropped on the
  // floor. That left RedisStore.windowMs undefined forever, and since
  // windowMs is read on every increment, EVERY rate-limited request threw ->
  // 500 for the whole site (express-rate-limit has passOnStoreError:false).
  // Fix: remember the options and apply them lazily on the first request
  // that actually reaches Redis.
  const ensureInit = () => {
    if (!initOptions) return Promise.resolve(false);
    if (!initPromise) {
      initPromise = Promise.resolve(redis.init(initOptions)).then(
        () => true,
        (err) => {
          initPromise = null; // transient failure (e.g. dropped mid-connect) -> retry next call
          throw err;
        }
      );
    }
    return initPromise;
  };

  // Run one Redis-backed store op, degrading to the per-instance fallback on
  // ANY failure - not just a closed socket. A rejected store call would
  // otherwise propagate to express-rate-limit, which rethrows (passOnStoreError
  // defaults to false) and turns e.g. an exhausted Upstash command quota into
  // a 500 on every rate-limited route. Degrading keeps limits enforced and
  // requests served, which is the same behaviour as a Redis outage.
  const viaRedis = async (op, fallback) => {
    if (!client.isReady) {
      reportDegraded('Redis not ready');
      return fallback();
    }
    try {
      await ensureInit();
      return await op();
    } catch (err) {
      reportDegraded(err.message);
      return fallback();
    }
  };

  return {
    async increment(key) {
      return viaRedis(() => redis.increment(key), () => localStore.increment(key));
    },
    async decrement(key) {
      return viaRedis(() => redis.decrement(key), () => localStore.decrement(key));
    },
    async resetKey(key) {
      return viaRedis(() => redis.resetKey(key), () => localStore.resetKey(key));
    },
    async resetAll() {
      return viaRedis(() => redis.resetAll(), () => localStore.resetAll());
    },
    init(options) {
      initOptions = options;
      if (Number.isFinite(options?.windowMs) && options.windowMs > 0) {
        localWindowMs = options.windowMs;
      }
      // Only start loading scripts once the socket is usable; otherwise
      // apply them lazily in ensureInit() on the first request. Returning a
      // rejected promise here would only add boot-time log noise - the real
      // work happens in ensureInit().
      return client.isReady ? ensureInit() : undefined;
    },
  };

  function reportDegraded(reason) {
    const now = Date.now();
    if (now - warnedAt < 5 * 60 * 1000) return;
    warnedAt = now;
    console.error(
      `Redis unusable (${reason}) - rate limiting is DEGRADED to per-instance memory (still enforced) until Redis recovers`
    );
    import('@sentry/node')
      .then((Sentry) =>
        Sentry.captureMessage(
          `Redis unavailable (${reason}): rate limiting degraded to per-instance memory`,
          'warning'
        )
      )
      .catch(() => { /* Sentry optional */ });
  }
};

/**
 * Atomically consume a one-time-use value (e.g. an OAuth exchange jti).
 * Returns:
 *   - true  when acquired (not used before) — caller may proceed
 *   - false when already consumed — caller must reject
 *   - null  when Redis is unavailable → caller falls back to in-memory state
 */
export const consumeOnce = async (key, ttlSeconds) => {
  const client = getRedisClient();
  if (!client || !client.isReady) return null;
  try {
    // node-redis v6 has no setNx() - it throws "not a function". SET ... NX EX
    // is the v6 equivalent: 'OK' when acquired (key was absent), null when the
    // key already existed (token replayed).
    const reply = await client.set(key, '1', {
      condition: 'NX',
      expiration: { type: 'EX', value: ttlSeconds },
    });
    return reply === 'OK';
  } catch (err) {
 console.error(' Redis consumeOnce error:', err.message);
    return null;
  }
};