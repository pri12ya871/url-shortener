import express from 'express';
import { linksRouter } from './routes/links.js';
import { redirectRouter } from './routes/redirect.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { pool } from './db/pool.js';
import { redis } from './cache/redis.js';

export function createApp() {
  const app = express();

  // Behind a proxy/CDN, req.ip must come from X-Forwarded-For or every client
  // shares one rate-limit bucket.
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  app.get('/health', async (req, res) => {
    const [db, cache] = await Promise.all([
      pool.query('SELECT 1').then(() => 'up', () => 'down'),
      redis.ping().then(() => 'up', () => 'down'),
    ]);
    // Postgres is required to serve; Redis degrades gracefully, so a Redis
    // outage alone must not fail the readiness probe.
    res.status(db === 'up' ? 200 : 503).json({ status: db === 'up' ? 'ok' : 'degraded', db, cache });
  });

  app.use('/api', linksRouter);
  // Registered last: the catch-all /:code must not shadow /api or /health.
  app.use('/', redirectRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
