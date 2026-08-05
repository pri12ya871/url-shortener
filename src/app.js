import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { linksRouter } from './routes/links.js';
import { redirectRouter } from './routes/redirect.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { pool } from './db/pool.js';
import { redis } from './cache/redis.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

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

  // The UI is served from an explicit /static prefix rather than mounted at the
  // root: a root mount would stat the filesystem on every /:code request just to
  // miss, putting disk I/O on the redirect path. "static" is already a reserved
  // code, so no alias can ever shadow it.
  // No max-age: these filenames carry no content hash, so a far-future cache
  // would serve stale CSS/JS for an hour after every deploy. ETag revalidation
  // costs one conditional request and answers 304 when nothing changed.
  app.use('/static', express.static(PUBLIC_DIR, { index: false, etag: true }));
  app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

  // Registered last: the catch-all /:code must not shadow /api, /health or /static.
  app.use('/', redirectRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
