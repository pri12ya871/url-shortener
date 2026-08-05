import { config } from '../config.js';
import { query } from '../db/pool.js';
import { keys, safeDel, safeGet, safeSet } from '../cache/redis.js';
import { randomCode } from '../lib/base62.js';
import { conflict, notFound, serverError } from '../lib/errors.js';

// Sentinel for the negative cache. Not valid JSON, so it can never be confused
// with a cached link payload.
const MISS = '__miss__';

const rowToLink = (row) => ({
  id: String(row.id),
  code: row.code,
  targetUrl: row.target_url,
  shortUrl: `${config.baseUrl}/${row.code}`,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  isActive: row.is_active,
});

/**
 * Insert with a caller-supplied code, or retry random codes until one lands.
 *
 * Collision strategy: generate, attempt the insert, let the unique index
 * arbitrate. `ON CONFLICT DO NOTHING` returns zero rows on a taken code, so a
 * collision costs one extra round trip and never a wrong answer — unlike
 * "SELECT then INSERT", which races between the two statements.
 *
 * With a 7-char base62 space (~3.5e12 codes), the chance of even one retry
 * stays negligible until the table holds hundreds of millions of rows.
 */
export async function createLink({ url, customCode = null, expiresAt = null }) {
  const attempts = customCode ? 1 : config.maxCodeAttempts;

  for (let i = 0; i < attempts; i++) {
    const code = customCode ?? randomCode(config.codeLength);
    const { rows } = await query(
      `INSERT INTO links (code, target_url, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO NOTHING
       RETURNING id, code, target_url, created_at, expires_at, is_active`,
      [code, url, expiresAt],
    );

    if (rows.length > 0) {
      const link = rowToLink(rows[0]);
      // Drop any negative-cache entry for this code so the first redirect hits.
      await safeDel(keys.link(code));
      return link;
    }

    if (customCode) throw conflict(`Code "${customCode}" is already taken`);
  }

  throw serverError(`Could not allocate a unique code after ${attempts} attempts`);
}

/**
 * Cache-aside read on the hot path.
 *
 * Redirects are read-heavy and the mapping is immutable in practice, so the
 * cache absorbs nearly all of them. Misses (including "no such code") are
 * cached too — otherwise a scanner hitting random codes sends every request
 * straight to Postgres.
 */
export async function resolveCode(code) {
  const key = keys.link(code);

  const cached = await safeGet(key);
  if (cached === MISS) return null;
  if (cached) {
    try {
      const link = JSON.parse(cached);
      if (isExpired(link)) {
        await safeDel(key);
      } else {
        return link;
      }
    } catch {
      await safeDel(key);
    }
  }

  const { rows } = await query(
    `SELECT id, code, target_url, created_at, expires_at, is_active
       FROM links WHERE code = $1`,
    [code],
  );

  if (rows.length === 0 || !rows[0].is_active) {
    await safeSet(key, MISS, config.negativeCacheTtlSeconds);
    return null;
  }

  const link = rowToLink(rows[0]);
  if (isExpired(link)) {
    await safeSet(key, MISS, config.negativeCacheTtlSeconds);
    return null;
  }

  // Never cache past the link's own expiry.
  const ttl = link.expiresAt
    ? Math.max(
        1,
        Math.min(config.cacheTtlSeconds, Math.floor((new Date(link.expiresAt) - Date.now()) / 1000)),
      )
    : config.cacheTtlSeconds;
  await safeSet(key, JSON.stringify(link), ttl);
  return link;
}

export async function getLink(code) {
  const { rows } = await query(
    `SELECT id, code, target_url, created_at, expires_at, is_active
       FROM links WHERE code = $1`,
    [code],
  );
  if (rows.length === 0) throw notFound(`No link with code "${code}"`);
  return rowToLink(rows[0]);
}

export async function listLinks({ limit = 20, offset = 0 } = {}) {
  const { rows } = await query(
    `SELECT id, code, target_url, created_at, expires_at, is_active
       FROM links ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows.map(rowToLink);
}

/** Soft delete: the row stays so historical click data keeps its foreign key. */
export async function deactivateLink(code) {
  const { rowCount } = await query(
    `UPDATE links SET is_active = FALSE WHERE code = $1 AND is_active`,
    [code],
  );
  if (rowCount === 0) throw notFound(`No active link with code "${code}"`);
  await safeDel(keys.link(code));
}

function isExpired(link) {
  return Boolean(link.expiresAt) && new Date(link.expiresAt).getTime() <= Date.now();
}
