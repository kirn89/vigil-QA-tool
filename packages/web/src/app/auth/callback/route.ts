import { NextResponse } from 'next/server';
import { createClient } from '../../../lib/supabase/server.js';
import { linkUser } from '../../../lib/linkUser.js';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next');
  const next = nextParam && nextParam.startsWith('/') ? nextParam : '/';
  if (!code) return NextResponse.redirect(`${origin}/login`);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login`);

  const { data: { user } } = await supabase.auth.getUser();
  if (user?.email) await linkUser(user.id, user.email);
  return NextResponse.redirect(`${origin}${next}`);
}
