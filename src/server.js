import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { redis } from './cache/redis.js';
import { migrate } from './db/migrate.js';

const app = createApp();

// Applying the schema on boot keeps `docker compose up && npm start` a
// one-command setup; a real deployment would run migrations as a separate step.
try {
  await migrate();
} catch (err) {
  console.error('Could not apply schema — is Postgres running? (docker compose up -d)');
  console.error(err.message);
  process.exit(1);
}

const server = app.listen(config.port, () => {
  console.log(`URL shortener listening on ${config.baseUrl} (port ${config.port})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal} received, shutting down...`);
    server.close(async () => {
      await Promise.allSettled([pool.end(), redis.quit()]);
      process.exit(0);
    });
    // Don't hang forever on lingering keep-alive connections.
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
