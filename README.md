# URL Shortener with Analytics

A short-link service built around the parts that actually come up in system-design
interviews: short-code generation and collision handling, cache-aside reads on the
redirect path, click analytics that stay off the hot path, and a sliding-window
rate limiter in Redis.

Node 20+ · Express · Postgres · Redis

## Running it

```bash
docker compose up -d
```

```bash
cp .env.example .env && npm install && npm start
```

The schema is applied automatically on boot. The API listens on
`http://localhost:3000`.

```bash
npm test
```

Unit tests run anywhere. The integration tests skip themselves unless Postgres and
Redis are reachable, so a bare checkout still goes green.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/links` | Create a short link |
| `GET` | `/api/links` | List links (`?limit=&offset=`) |
| `GET` | `/api/links/:code` | Link detail + click count |
| `GET` | `/api/links/:code/analytics` | Full analytics (`?days=30`) |
| `DELETE` | `/api/links/:code` | Deactivate a link |
| `GET` | `/:code` | Redirect (302) and record the click |
| `GET` | `/health` | Liveness of app, DB and cache |

Create a link:

```bash
curl -s -X POST localhost:3000/api/links -H 'content-type: application/json' -d '{"url":"https://example.com/some/long/path","customCode":"launch","expiresAt":"2026-12-31T00:00:00Z"}'
```

```json
{
  "id": "1",
  "code": "launch",
  "targetUrl": "https://example.com/some/long/path",
  "shortUrl": "http://localhost:3000/launch",
  "createdAt": "2026-08-06T09:12:44.101Z",
  "expiresAt": "2026-12-31T00:00:00.000Z",
  "isActive": true
}
```

Read the analytics:

```bash
curl -s localhost:3000/api/links/launch/analytics
```

```json
{
  "code": "launch",
  "totals": { "clicks": 128, "uniqueVisitors": 74, "last24h": 31, "lastClickAt": "..." },
  "timeline": [{ "day": "2026-08-05", "clicks": 97 }],
  "topReferrers": [{ "value": "https://news.site", "clicks": 61 }],
  "devices": [{ "value": "mobile", "clicks": 80 }],
  "browsers": [{ "value": "chrome", "clicks": 92 }],
  "countries": [{ "value": "IN", "clicks": 55 }]
}
```

Errors are uniform: `{"error": {"code": "bad_request", "message": "..."}}`.

## Deploying to Render

[render.yaml](render.yaml) is a Blueprint that provisions all three pieces — the
web service, a managed Postgres, and a Key Value (Redis) instance — wired
together. In the Render dashboard: **New → Blueprint**, point it at this repo,
apply.

Nothing needs configuring by hand. `DATABASE_URL` and `REDIS_URL` come from the
provisioned instances, `VISITOR_SALT` is generated once and kept stable across
restarts, and `BASE_URL` falls back to `RENDER_EXTERNAL_URL` so short URLs carry
the live hostname. The schema is applied on boot, so there is no migration step.

Everything is on free plans, which carry three caveats worth knowing before you
show it to anyone:

- **Free Postgres expires 30 days after creation** (then a 14-day grace period).
  This is the one that bites: the demo link dies a month after you deploy it.
  Upgrading the database to a paid instance is the fix.
- **Free web services spin down after 15 minutes of inactivity**, so the first
  request after a quiet spell takes ~30s to cold-start.
- **Free Key Value has no persistence** — a restart drops every key, and only
  one free instance is allowed per workspace. Harmless here by design: the cache
  refills from Postgres on the next request, and a cleared rate-limit window
  only forgives requests that already happened.

`region: singapore` is set for latency from India; change all three entries
together if you want it elsewhere, since cross-region internal connections
aren't allowed.

## Design notes

**Short-code generation.** Codes are 7 random base62 characters (~3.5 × 10¹²
possibilities) drawn from `crypto.randomBytes` with rejection sampling, since
`256 % 62 ≠ 0` and naive modulo would bias the first 8 characters of the alphabet.

The two alternatives both lose. A **counter** encoded in base62 is dense and
collision-free, but it makes every code guessable — you can walk the whole
corpus — and every write contends on one sequence. **Hashing the URL** means two
users who shorten the same URL get the same code and therefore share each other's
analytics, and you still need a collision probe.

**Collision handling.** The unique index on `links.code` is the arbiter:

```sql
INSERT INTO links (code, target_url, expires_at)
VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING RETURNING ...
```

Zero rows back means the code was taken, so we generate another and retry (up to
5 times). `SELECT` then `INSERT` would be a race — two writers can both see the
code as free. At 100M links the load factor is still ~3 × 10⁻⁵, so a retry is
rare enough not to matter, and the retry budget is what tells you it's time to
lengthen the code.

**Caching.** Redirects are cache-aside on `link:{code}` with a 1h TTL. Misses are
cached too, as a `MISS` sentinel with a short TTL — without a negative cache, a
scanner hitting random codes sends every single request to Postgres. Cache TTL is
clamped to the link's own expiry so an expired link can't outlive itself in Redis.
Deactivating a link invalidates the key.

Redis is treated as optional throughout: every cache read and write is wrapped so
a Redis outage degrades to Postgres reads instead of an outage. `/health` reports
the cache as down but still returns 200 — Postgres is what makes the service
serveable.

**Why 302 and not 301.** A permanent redirect gets cached by the browser, and
every subsequent click never reaches the service — which silently zeroes out the
analytics that are the point of the project.

**Click analytics.** The redirect responds first; the click insert runs after via
`setImmediate`, plus a Redis `INCR` for the hot counter so "how many clicks" never
needs a `COUNT(*)`. A dropped click on a crash is an acceptable trade for a
redirect that never waits on a write. The next step at real volume is a queue and
batched inserts rather than a row per click.

No raw IP is stored. Visitors are counted by a salted SHA-256 of IP + user-agent,
truncated to 32 hex characters — enough to count uniques, not enough to reverse.
Referrers are reduced to their origin, since the full path is often sensitive.

**Rate limiting.** A sliding window over a Redis sorted set, driven by a Lua
script so the trim-count-add sequence is atomic without `WATCH`/`MULTI` retries.
A fixed window would let a caller send 2× the limit across a window boundary. It
fails **open**: if Redis is unreachable the request is allowed, because losing
throttling is better than losing the service. Only writes are limited — redirects
are cheap and cached.

**Validation.** Only absolute `http`/`https` URLs with a fully-qualified host are
accepted. A shortener that will redirect to `javascript:` or `data:` is an XSS
vector for everyone who trusts the short domain. Custom codes are shape-checked
and screened against a reserved list so an alias can't shadow `/api` or `/health`.

## Layout

```
src/
  app.js, server.js        Express wiring, boot, graceful shutdown
  config.js                Env parsing with defaults
  cache/redis.js           Client + fail-soft get/set/del helpers
  db/                      Pool, schema.sql, migration runner
  lib/                     base62, validation, UA classification, errors
  middleware/              Sliding-window rate limiter, error handler
  routes/                  /api/links, /:code redirect
  services/                linkService (codes, cache), analyticsService
test/                      Unit tests + skippable integration tests
```

## Known limits

- Country comes from a CDN header (`CF-IPCountry`); there is no GeoIP database.
- User-agent classification is a small heuristic, not a maintained UA database.
- The schema is applied on boot; a real deployment wants versioned migrations.
- Analytics queries scan the `clicks` table per link — the next step is a rollup
  table (or a partitioned `clicks`) once a single link's history gets large.
