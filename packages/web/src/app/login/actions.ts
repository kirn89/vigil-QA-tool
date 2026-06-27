'use server';
import { createClient } from '../../lib/supabase/server.js';
import { headers } from 'next/headers';

export async function sendMagicLink(_prev: unknown, formData: FormData): Promise<{ message: string }> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { message: 'Enter your email.' };
  const supabase = await createClient();
  const origin = (await headers()).get('origin') ?? '';
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  return { message: error ? `Could not send link: ${error.message}` : 'Check your email for a sign-in link.' };
}
