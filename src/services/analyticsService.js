import { createHash, randomBytes } from 'node:crypto';
import { query } from '../db/pool.js';
import { redis, keys, safeGet } from '../cache/redis.js';
import { classifyUserAgent, normalizeReferrer } from '../lib/userAgent.js';

// Rotating per-process salt: enough to correlate a visitor within a session
// for unique-visitor counts, not enough to reverse a stored hash back to an IP.
const VISITOR_SALT = process.env.VISITOR_SALT || randomBytes(16).toString('hex');

const visitorId = (ip, ua) =>
  createHash('sha256').update(`${VISITOR_SALT}|${ip || ''}|${ua || ''}`).digest('hex').slice(0, 32);

/**
 * Record a click without blocking the redirect.
 *
 * The user gets their 302 as soon as the target URL is known; the insert and
 * the counter bump run after the response is on the wire. A dropped click is
 * an acceptable loss here — a slow redirect is not. At real volume this is
 * where you'd push onto a queue and batch-insert instead.
 */
export function recordClick(link, req) {
  const ua = req.get('user-agent') || null;
  const { device, browser } = classifyUserAgent(ua);
  const payload = {
    linkId: link.id,
    code: link.code,
    visitor: visitorId(clientIp(req), ua),
    referrer: normalizeReferrer(req.get('referer') || req.get('referrer')),
    userAgent: ua ? ua.slice(0, 512) : null,
    device,
    browser,
    // Populated by a CDN/proxy when one is in front of the app.
    country: req.get('cf-ipcountry') || req.get('x-vercel-ip-country') || null,
  };

  setImmediate(() => {
    persistClick(payload).catch((err) => console.error('[analytics] click insert failed:', err.message));
  });
}

async function persistClick(p) {
  await query(
    `INSERT INTO clicks (link_id, visitor_id, referrer, user_agent, device, browser, country)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [p.linkId, p.visitor, p.referrer, p.userAgent, p.device, p.browser, p.country],
  );
  // Hot counter so "how many clicks?" never needs a COUNT(*) over the table.
  try {
    await redis.incr(keys.clicks(p.code));
  } catch {
    /* counter is a convenience; Postgres remains authoritative */
  }
}

export function clientIp(req) {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

/** Live total: Redis if warm, otherwise count from Postgres and backfill. */
export async function totalClicks(link) {
  const cached = await safeGet(keys.clicks(link.code));
  if (cached !== null) return Number(cached);

  const { rows } = await query('SELECT COUNT(*)::bigint AS n FROM clicks WHERE link_id = $1', [link.id]);
  const n = Number(rows[0].n);
  try {
    await redis.set(keys.clicks(link.code), n);
  } catch {
    /* best-effort */
  }
  return n;
}

export async function linkAnalytics(link, { days = 30, topN = 10 } = {}) {
  const [summary, timeline, referrers, devices, browsers, countries] = await Promise.all([
    query(
      `SELECT COUNT(*)::bigint            AS total,
              COUNT(DISTINCT visitor_id)::bigint AS unique_visitors,
              MAX(clicked_at)             AS last_click,
              COUNT(*) FILTER (WHERE clicked_at > now() - INTERVAL '24 hours')::bigint AS last_24h
         FROM clicks WHERE link_id = $1`,
      [link.id],
    ),
    query(
      // $2 is multiplied by a literal interval rather than concatenated into
      // one: Postgres cannot infer a parameter's type inside `$2 || ' days'`.
      `SELECT date_trunc('day', clicked_at)::date AS day, COUNT(*)::bigint AS clicks
         FROM clicks
        WHERE link_id = $1 AND clicked_at > now() - ($2::int * INTERVAL '1 day')
        GROUP BY 1 ORDER BY 1`,
      [link.id, days],
    ),
    topBy('referrer', link.id, topN),
    topBy('device', link.id, topN),
    topBy('browser', link.id, topN),
    topBy('country', link.id, topN),
  ]);

  const s = summary.rows[0];
  return {
    code: link.code,
    shortUrl: link.shortUrl,
    targetUrl: link.targetUrl,
    createdAt: link.createdAt,
    totals: {
      clicks: Number(s.total),
      uniqueVisitors: Number(s.unique_visitors),
      last24h: Number(s.last_24h),
      lastClickAt: s.last_click,
    },
    timeline: timeline.rows.map((r) => ({ day: r.day, clicks: Number(r.clicks) })),
    topReferrers: referrers,
    devices,
    browsers,
    countries,
  };
}

async function topBy(column, linkId, limit) {
  // `column` is never user-supplied — it comes from the fixed list above.
  const { rows } = await query(
    `SELECT COALESCE(${column}, 'unknown') AS value, COUNT(*)::bigint AS clicks
       FROM clicks WHERE link_id = $1
      GROUP BY 1 ORDER BY clicks DESC, value ASC LIMIT $2`,
    [linkId, limit],
  );
  return rows.map((r) => ({ value: r.value, clicks: Number(r.clicks) }));
}
