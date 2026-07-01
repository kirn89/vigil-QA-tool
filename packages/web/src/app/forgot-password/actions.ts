'use server';
import { headers } from 'next/headers';
import { createClient } from '../../lib/supabase/server.js';

export async function requestReset(_prev: { message: string }, formData: FormData): Promise<{ message: string; sent?: boolean }> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { message: 'Enter your email.' };
  const supabase = await createClient();
  const origin = (await headers()).get('origin') ?? '';
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/auth/reset` });
  return { message: 'If that email has an account, a reset link is on its way.', sent: true };
}
