import pg from 'pg';
import { config } from '../config';

/**
 * PostgreSQL connection pool.
 * Lazy-initialised so `migrate` and tests can import repo without a live DB.
 */

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Test/DI helper: inject an external pool (e.g. from a test harness). */
export function setPool(p: pg.Pool | null): void {
  pool = p;
}
