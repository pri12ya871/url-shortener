import 'dotenv/config';

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Env ${name} must be an integer, got "${raw}"`);
  return n;
}

export const config = {
  port: int('PORT', 3000),
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  databaseUrl: process.env.DATABASE_URL || 'postgres://shortener:shortener@localhost:5432/shortener',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  cacheTtlSeconds: int('CACHE_TTL_SECONDS', 3600),
  negativeCacheTtlSeconds: int('NEGATIVE_CACHE_TTL_SECONDS', 60),
  rateLimit: {
    windowSeconds: int('RATE_LIMIT_WINDOW_SECONDS', 60),
    max: int('RATE_LIMIT_MAX', 20),
  },
  codeLength: int('CODE_LENGTH', 7),
  // How many times we retry on a short-code collision before giving up.
  maxCodeAttempts: int('MAX_CODE_ATTEMPTS', 5),
};
