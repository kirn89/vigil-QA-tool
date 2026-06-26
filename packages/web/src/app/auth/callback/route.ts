import { NextResponse } from 'next/server';
import pg from 'pg';
import { createClient } from '../../../lib/supabase/server.js';
import { claimUser } from '../../../lib/claimUser.js';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  if (!code) return NextResponse.redirect(`${origin}/login`);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login`);

  const { data: { user } } = await supabase.auth.getUser();
  if (user?.email) {
    const ssl = (process.env.DATABASE_SSL ?? '').toLowerCase();
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: ssl === 'true' || ssl === 'require' ? { rejectUnauthorized: false } : undefined });
    try {
      await claimUser({ query: (sql, params) => pool.query(sql, params).then((r) => ({ rowCount: r.rowCount ?? 0 })) }, user.id, user.email);
    } finally {
      await pool.end();
    }
  }
  return NextResponse.redirect(`${origin}/`);
}
