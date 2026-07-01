import pg from 'pg';
import { claimUser, type ClaimDb } from './claimUser.js';

export interface LinkDeps { claim?: (db: ClaimDb, authId: string, email: string) => Promise<void>; }

/** Link a Supabase auth identity to the engine users table, via a short-lived pg pool.
 *  Reused by the confirm callback, password sign-in, and password reset. */
export async function linkUser(authId: string, email: string, deps: LinkDeps = {}): Promise<void> {
  const claim = deps.claim ?? claimUser;
  const ssl = (process.env.DATABASE_SSL ?? '').toLowerCase();
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: ssl === 'true' || ssl === 'require' ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await claim(
      { query: (sql, params) => pool.query(sql, params).then((r) => ({ rowCount: r.rowCount ?? 0 })) },
      authId,
      email,
    );
  } finally {
    await pool.end();
  }
}
