export interface SignerLike {
  from(bucket: string): { createSignedUrl(key: string, ttl: number): Promise<{ data: { signedUrl: string } | null }> };
}

/** A Supabase storage locator is "<bucket>/<key>"; a local dev path is absolute or
 *  starts with "artifacts/". Only the former can be signed. */
export function parseLocator(locator: string): { bucket: string; key: string } | null {
  if (locator.startsWith('/') || locator.startsWith('artifacts/')) return null;
  const slash = locator.indexOf('/');
  if (slash <= 0) return null;
  return { bucket: locator.slice(0, slash), key: locator.slice(slash + 1) };
}

export async function signedUrlFor(storage: SignerLike, locator: string, ttlSeconds = 60): Promise<string | null> {
  const parsed = parseLocator(locator);
  if (!parsed) return null;
  const { data } = await storage.from(parsed.bucket).createSignedUrl(parsed.key, ttlSeconds);
  return data?.signedUrl ?? null;
}
