import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));

export async function migrate() {
  const sql = await readFile(schemaPath, 'utf8');
  await pool.query(sql);
}

// Only run (and exit) when invoked directly: `npm run migrate`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => {
      console.log('Schema applied.');
      return pool.end();
    })
    .catch(async (err) => {
      console.error('Migration failed:', err.message);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
