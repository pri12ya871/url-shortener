import Redis from 'ioredis';
import { config } from '../config.js';

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

let warned = false;
redis.on('error', (err) => {
  // Redis is a cache and a rate-limit store, not the source of truth. Log the
  // first failure and keep serving from Postgres instead of crashing.
  if (!warned) {
    console.error('[redis] connection error:', err.message);
    warned = true;
  }
});
redis.on('ready', () => {
  warned = false;
});

export const keys = {
  link: (code) => `link:${code}`,
  clicks: (code) => `clicks:${code}`,
  rate: (bucket, id) => `rl:${bucket}:${id}`,
};

/** Cache reads must never break a request; a cache miss is always survivable. */
export async function safeGet(key) {
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

export async function safeSet(key, value, ttlSeconds) {
  try {
    await redis.set(key, value, 'EX', ttlSeconds);
  } catch {
    /* cache write is best-effort */
  }
}

export async function safeDel(...keys) {
  try {
    await redis.del(...keys);
  } catch {
    /* best-effort */
  }
}
