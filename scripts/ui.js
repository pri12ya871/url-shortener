/**
 * Frontend preview server.
 *
 * The same Express app as `npm start`, minus the migrate-on-boot step. That step
 * is what makes `npm start` require Postgres: it exits(1) when the schema can't
 * be applied, so the UI can never be looked at on a machine without a database.
 *
 * Here the app just listens. /health reports `db: down`, the frontend sees that
 * and switches to generated data, and every screen still renders. Bring the real
 * infra up (`docker compose up -d`) and the same page talks to the real API with
 * no code change — so this is for looking at the UI, never for serving traffic.
 */
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';

const server = createApp().listen(config.port, () => {
  console.log(`UI preview on ${config.baseUrl} (port ${config.port})`);
  console.log('No database expected — the frontend falls back to demo data.');
  console.log('A single [redis] connection error above is normal here.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
