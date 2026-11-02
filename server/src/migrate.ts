import fs from 'fs';
import path from 'path';
import { pool } from './db';

export async function migrate() {
  const dir = path.resolve(__dirname, '../migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  // Fast path (the common case on every restart): one query, no transaction, when nothing is pending.
  try {
    const applied = new Set((await pool.query('select name from schema_migrations')).rows.map((r) => r.name));
    if (files.every((f) => applied.has(f))) return;
  } catch { /* table not there yet: fall through to the full migration */ }
  const c = await pool.connect();
  try {
    // One transaction with a transaction-scoped lock: only one instance migrates at a time (several can start together
    // on serverless hosts), and it also works behind connection poolers that share connections between requests.
    await c.query('begin');
    await c.query('select pg_advisory_xact_lock(727001)');
    await c.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await c.query('select name from schema_migrations')).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      try {
        await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
        await c.query('insert into schema_migrations (name) values ($1)', [f]);
        console.log('applied', f);
      } catch (e) {
        throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
      }
    }
    await c.query('commit');
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

if (require.main === module) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
