'use server';
import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server.js';
import { linkUser } from '../../lib/linkUser.js';

export async function signInAction(_prev: { message: string }, formData: FormData): Promise<{ message: string }> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { message: 'Enter your email and password.' };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const msg = /confirm/i.test(error.message)
      ? 'Please confirm your email first — check your inbox.'
      : 'Email or password is incorrect.';
    return { message: msg };
  }
  if (data.user?.email) await linkUser(data.user.id, data.user.email);
  redirect('/');
}
