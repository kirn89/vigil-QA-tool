import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase');

/** Applies every supabase/*.sql (idempotent) against the given connection. */
export async function applyRls(connectionString: string): Promise<void> {
  const ssl = (process.env.DATABASE_SSL ?? '').toLowerCase();
  const pool = new pg.Pool({ connectionString, ssl: ssl === 'true' || ssl === 'require' ? { rejectUnauthorized: false } : undefined });
  try {
    const sql = await readFile(join(SQL_DIR, '001_web_rls.sql'), 'utf8');
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const conn = process.env.DATABASE_URL;
  if (!conn) { console.error('DATABASE_URL required'); process.exit(1); }
  applyRls(conn).then(() => { console.log('applied web RLS'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
