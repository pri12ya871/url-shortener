import { redis, keys } from '../cache/redis.js';
import { config } from '../config.js';
import { clientIp } from '../services/analyticsService.js';
import { tooManyRequests } from '../lib/errors.js';

/**
 * Sliding-window rate limiter backed by a Redis sorted set.
 *
 * A fixed window lets a caller send 2x the limit across a window boundary; the
 * sorted set holds one member per request timestamp, so the window really does
 * slide. The whole read-trim-write sequence runs as one Lua script, which makes
 * it atomic without WATCH/MULTI retries.
 */
const SCRIPT = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return {0, count, tonumber(oldest[2]) + window}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, count + 1, 0}
`;

let sha;
async function runScript(key, now, windowMs, limit, member) {
  const args = [1, key, now, windowMs, limit, member];
  if (!sha) sha = await redis.script('LOAD', SCRIPT);
  try {
    return await redis.evalsha(sha, ...args);
  } catch (err) {
    if (String(err.message).includes('NOSCRIPT')) {
      sha = await redis.script('LOAD', SCRIPT);
      return redis.evalsha(sha, ...args);
    }
    throw err;
  }
}

export function rateLimit({
  bucket = 'default',
  max = config.rateLimit.max,
  windowSeconds = config.rateLimit.windowSeconds,
  keyFn = clientIp,
} = {}) {
  const windowMs = windowSeconds * 1000;

  return async function rateLimitMiddleware(req, res, next) {
    const key = keys.rate(bucket, keyFn(req) || 'unknown');
    const now = Date.now();

    let allowed;
    let count;
    let resetAtMs;
    try {
      [allowed, count, resetAtMs] = await runScript(key, now, windowMs, max, `${now}-${Math.random()}`);
    } catch (err) {
      // Fail open. Redis being down should degrade throttling, not the service.
      console.error('[ratelimit] redis unavailable, allowing request:', err.message);
      return next();
    }

    const remaining = Math.max(0, max - count);
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(remaining));

    if (allowed === 1) return next();

    const retryAfter = Math.max(1, Math.ceil((resetAtMs - now) / 1000));
    res.set('Retry-After', String(retryAfter));
    return next(tooManyRequests(`Rate limit exceeded: ${max} requests per ${windowSeconds}s`, { retryAfter }));
  };
}
