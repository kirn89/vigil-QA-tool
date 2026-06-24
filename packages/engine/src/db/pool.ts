import pg from 'pg';
import { env } from '../env.js';

let pool: pg.Pool | undefined;

/** Build the pg pool config. SSL is off by default (local embedded Postgres needs
 *  none) and enabled when DATABASE_SSL is "true"/"require" — Supabase (and most
 *  hosted Postgres) require TLS. We use rejectUnauthorized:false for MVP: the
 *  connection is encrypted in transit; pinning Supabase's CA for full verification
 *  is a later hardening step. */
export function buildPoolConfig(opts?: { connectionString?: string; ssl?: string }): pg.PoolConfig {
  const connectionString = opts?.connectionString ?? env('DATABASE_URL');
  const flag = (opts?.ssl ?? process.env.DATABASE_SSL ?? '').toLowerCase();
  const ssl = flag === 'true' || flag === 'require' ? { rejectUnauthorized: false } : undefined;
  return ssl ? { connectionString, ssl } : { connectionString };
}

export function getPool(): pg.Pool {
  pool ??= new pg.Pool(buildPoolConfig());
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
