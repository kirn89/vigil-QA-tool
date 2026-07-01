'use server';
import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server.js';
import { validatePassword } from '../../../lib/authValidation.js';

export async function updatePasswordAction(_prev: { message: string }, formData: FormData): Promise<{ message: string }> {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const invalid = validatePassword(password);
  if (invalid) return { message: invalid };
  if (password !== confirm) return { message: 'Passwords do not match.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { message: 'This reset link has expired — request a new one.' };
  redirect('/');
}
