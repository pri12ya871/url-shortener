import test, { after } from 'node:test';
import assert from 'node:assert/strict';

/**
 * End-to-end tests against real Postgres + Redis.
 *
 * They skip when the infrastructure is not reachable, so `npm test` still
 * passes on a bare checkout. Bring it up with `docker compose up -d` to run
 * them for real.
 *
 * The probe runs at module scope rather than in a before() hook because
 * node:test evaluates each test's options when the test is *registered* —
 * a hook would run too late to decide the skip.
 */
process.env.BASE_URL ||= 'http://localhost:3000';

const load = (file) => import(new URL(`../src/${file}`, import.meta.url).href);

let pool;
let redis;
let server;
let baseUrl;
let skip = 'Postgres/Redis not reachable — run `docker compose up -d`';

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms).unref()),
  ]);

try {
  ({ pool } = await load('db/pool.js'));
  ({ redis } = await load('cache/redis.js'));
  await withTimeout(pool.query('SELECT 1'), 3000, 'postgres');
  await withTimeout(redis.ping(), 3000, 'redis');
  const { migrate } = await load('db/migrate.js');
  await migrate();
  const { createApp } = await load('app.js');

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  skip = false;
} catch {
  // Tear the clients down now: ioredis reconnects forever by default, which
  // would keep the event loop alive and hang the runner after the skips.
  await teardown();
}

after(teardown);

async function teardown() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
  }
  if (redis) {
    redis.disconnect();
    redis = null;
  }
}

const api = (path, init) => fetch(`${baseUrl}${path}`, init);
const postLink = (body) =>
  api('/api/links', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('creates a short link and redirects to the target', { skip }, async () => {
  const created = await postLink({ url: 'https://example.com/docs?x=1' });
  assert.equal(created.status, 201);
  const link = await created.json();
  assert.match(link.code, /^[0-9A-Za-z]{7}$/);
  assert.equal(link.targetUrl, 'https://example.com/docs?x=1');

  const res = await api(`/${link.code}`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://example.com/docs?x=1');
});

test('rejects unsafe schemes', { skip }, async () => {
  const res = await postLink({ url: 'javascript:alert(1)' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'bad_request');
});

test('custom codes are honoured and collisions return 409', { skip }, async () => {
  const code = `t-${process.hrtime.bigint() % 100000000n}`;
  assert.equal((await postLink({ url: 'https://example.com/a', customCode: code })).status, 201);
  const dup = await postLink({ url: 'https://example.com/b', customCode: code });
  assert.equal(dup.status, 409);
});

test('unknown codes 404', { skip }, async () => {
  assert.equal((await api('/zzzzzzz', { redirect: 'manual' })).status, 404);
});

test('clicks show up in analytics', { skip }, async () => {
  const link = await (await postLink({ url: 'https://example.com/tracked' })).json();

  for (let i = 0; i < 3; i++) {
    await api(`/${link.code}`, {
      redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Safari/604.1', referer: 'https://news.site/post/1' },
    });
  }
  // Click writes are deliberately off the response path, so let them land.
  await new Promise((r) => setTimeout(r, 400));

  const stats = await (await api(`/api/links/${link.code}/analytics`)).json();
  assert.equal(stats.totals.clicks, 3);
  assert.equal(stats.totals.uniqueVisitors, 1);
  assert.deepEqual(stats.topReferrers[0], { value: 'https://news.site', clicks: 3 });
  assert.equal(stats.devices[0].value, 'mobile');
});

test('deactivated links stop redirecting', { skip }, async () => {
  const link = await (await postLink({ url: 'https://example.com/gone' })).json();
  await api(`/${link.code}`, { redirect: 'manual' }); // warm the cache
  assert.equal((await api(`/api/links/${link.code}`, { method: 'DELETE' })).status, 204);
  assert.equal((await api(`/${link.code}`, { redirect: 'manual' })).status, 404);
});

test('write rate limit kicks in and reports Retry-After', { skip }, async () => {
  const { config } = await load('config.js');
  const burst = config.rateLimit.max + 5;
  const results = [];
  for (let i = 0; i < burst; i++) {
    results.push(await postLink({ url: `https://example.com/burst/${i}` }));
  }
  const limited = results.filter((r) => r.status === 429);
  assert.ok(limited.length > 0, `expected some 429s within a burst of ${burst}`);
  assert.ok(Number(limited[0].headers.get('retry-after')) > 0);
});
