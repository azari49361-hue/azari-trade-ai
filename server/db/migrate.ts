import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool } from './pool';
import { log } from '../lib/logger';

/**
 * Forward-only SQL migrations.
 * Files in migrations/ are applied in lexicographic order and recorded in schema_migrations.
 * Safe to run on every boot (idempotent).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (rows.length > 0) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log('info', 'Migration', `Applied migration: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
}

// Allow direct execution: npm run migrate
const isDirect = process.argv[1] && process.argv[1].endsWith('migrate.ts');
if (isDirect) {
  runMigrations()
    .then(() => {
      console.log('All migrations applied.');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
