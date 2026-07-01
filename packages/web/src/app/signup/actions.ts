'use server';
import { headers } from 'next/headers';
import { createClient } from '../../lib/supabase/server.js';
import { validateSignup } from '../../lib/authValidation.js';

export async function signUpAction(_prev: { message: string }, formData: FormData): Promise<{ message: string; sent?: boolean }> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const invalid = validateSignup(email, password, confirm);
  if (invalid) return { message: invalid };

  const supabase = await createClient();
  const origin = (await headers()).get('origin') ?? '';
  const { error } = await supabase.auth.signUp({
    email, password, options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return { message: error.message };
  return { message: 'Check your email to confirm your account.', sent: true };
}
