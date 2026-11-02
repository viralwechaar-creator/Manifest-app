import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from './config';
import { logger } from './logger';

export const pool = new Pool({ connectionString: config.DATABASE_URL, max: config.DB_POOL_MAX, idleTimeoutMillis: 10000 });

// A pooler or the database can close an idle connection at any time. Without this handler Node treats that as a crash
// of the whole process, which on a serverless host cuts off requests that are in flight.
pool.on('error', (err) => logger.warn({ err: { message: err.message } }, 'idle database connection closed'));

export async function query<T extends QueryResultRow = any>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params as any[]);
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
