import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/** Server-only service-role client. Bypasses RLS — never import from a client component.
 *  Used for signed URLs and claim-by-email linking. */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  if (!key) throw new Error('Missing SUPABASE_SERVICE_KEY');
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
