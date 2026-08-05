import pg from 'pg';
import { config } from '../config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
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
