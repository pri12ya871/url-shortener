# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A URL shortener with click analytics. Node 20+, Express, Postgres, Redis. ESM
(`"type": "module"`) — use `import`, not `require`. Despite the directory name
("ecommerce"), there is no ecommerce code here.

## Commands

```bash
docker compose up -d   # Postgres :5432 and Redis :6379
npm start              # applies schema, then serves on :3000
npm run dev            # same with --watch
npm run ui             # frontend only, no database needed (see below)
npm run migrate        # apply src/db/schema.sql on its own
npm test               # node:test; integration tests skip without infra
```

There is no lint or build step.

## Architecture

- `src/app.js` builds the Express app; `src/server.js` boots it, applies the
  schema and handles graceful shutdown. Route order matters — the catch-all
  `GET /:code` redirect is registered last so it cannot shadow `/api` or
  `/health`.
- `public/` is the frontend (plain HTML/CSS/JS, no build, no dependencies). It is
  mounted at `/static`, never at the root — a root mount would stat the disk on
  every `/:code` request just to miss, putting file I/O on the redirect path.
  `static` is already in the `RESERVED` code list so no alias can shadow it. The
  UI degrades to generated data when `/health` reports the database down, which
  is what `npm run ui` (`scripts/ui.js`) exists to exercise.
- `src/services/linkService.js` owns code allocation and the cache-aside read
  path. Collisions are resolved by `INSERT ... ON CONFLICT (code) DO NOTHING`
  against the unique index, retried up to `MAX_CODE_ATTEMPTS` — never by
  `SELECT`-then-`INSERT`, which races.
- `src/services/analyticsService.js` writes clicks *after* the redirect response
  via `setImmediate`. Keep writes off the redirect path.
- Redis is optional by design: `src/cache/redis.js` exposes fail-soft helpers,
  and the rate limiter fails open. Never make a request path depend on Redis
  being up.
- Redirects must stay `302`. A `301` is browser-cached and silently kills the
  click analytics.

## Conventions

- Errors: throw the helpers in `src/lib/errors.js`; the handler in
  `src/middleware/errorHandler.js` renders them as
  `{"error": {"code", "message"}}`. Wrap async routes in `asyncHandler`.
- All SQL is parameterised. The one interpolated identifier (`topBy` in
  analyticsService) is fed from a fixed internal list, never user input.
- Config goes through `src/config.js` and `.env.example`, not `process.env` reads
  scattered across modules.
- Never store raw IPs; visitors are a salted hash, referrers are origin-only.

See README.md for the design rationale behind these choices.
