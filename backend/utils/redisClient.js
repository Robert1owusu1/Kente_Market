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

  _client = createClient({ url: process.env.REDIS_URL });
  _client.on('error', (err) => {
    console.error('❌ Redis error:', err.message);
  });
  _client.connect().catch((err) => {
    console.error('❌ Redis connect failed:', err.message);
  });
  return _client;
};

/**
 * Build an express-rate-limit store backed by Redis, or `undefined` when Redis
 * is not configured (express-rate-limit then uses its default MemoryStore).
 * Each limiter must pass a distinct `prefix` so limiters do not share keys.
 * If Redis is configured but temporarily unreachable, enforcement degrades to
 * per-instance memory (fail-open) rather than erroring the request path.
 */
export const createRateLimitStore = (prefix) => {
  const client = getRedisClient();
  if (!client) return undefined;

  let warnedAt = 0;
  const sendCommand = async (args) => {
    if (client.isReady) return client.sendCommand(args);
    // Fail-open by design (availability over strictness), but a degraded
    // limiter means unlimited auth/login attempts — so make the failure mode
    // IMPOSSIBLE TO MISS: re-warn every 5 minutes (not just once per boot)
    // and surface it to Sentry when configured.
    const now = Date.now();
    if (now - warnedAt > 5 * 60 * 1000) {
      warnedAt = now;
      console.warn('⚠️  Redis not ready — rate-limit enforcement DEGRADED (fail-open) for this instance');
      try {
        const Sentry = await import('@sentry/node');
        Sentry.captureMessage('Redis unavailable: rate limiting degraded (fail-open)', 'warning');
      } catch { /* Sentry optional */ }
    }
    return '0';
  };

  return new RedisStore({ sendCommand, prefix });
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
    return await client.setNx(key, '1', { EX: ttlSeconds });
  } catch (err) {
    console.error('❌ Redis consumeOnce error:', err.message);
    return null;
  }
};