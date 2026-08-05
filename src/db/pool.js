import pg from 'pg';
import { config } from '../config.js';

/**
 * Managed Postgres (Render, Neon, …) requires TLS on its *external* hostname,
 * while internal hostnames and a local Docker container do not offer it at all
 * — forcing TLS there fails the connection outright. Detect rather than assume;
 * `DATABASE_SSL=true|false` overrides when the heuristic guesses wrong.
 */
function sslConfig(url) {
  if (process.env.DATABASE_SSL === 'true') return { rejectUnauthorized: false };
  if (process.env.DATABASE_SSL === 'false') return false;
  return /\.render\.com|\.neon\.tech|sslmode=require/.test(url) ? { rejectUnauthorized: false } : false;
}

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: sslConfig(config.databaseUrl),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // An idle client blew up (network drop, DB restart). Log and let the pool
  // replace it rather than taking the process down.
  console.error('[pg] idle client error:', err.message);
});

export const query = (text, params) => pool.query(text, params);

export const UNIQUE_VIOLATION = '23505';
