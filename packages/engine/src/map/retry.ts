export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
}

/** Should this error be retried? Covers transient network drops (undici `terminated`,
 *  connection resets, timeouts), and retryable HTTP statuses (429 + 5xx). A 4xx other
 *  than 429 (bad request, auth) is permanent — retrying won't help. */
export function isTransientError(e: unknown): boolean {
  const status = (e as { status?: number }).status;
  if (status === 429) return true;
  if (typeof status === 'number') return status >= 500; // any other classified status (4xx) is permanent
  const text = `${(e as { name?: string }).name ?? ''} ${e instanceof Error ? e.message : String(e)}`.toLowerCase();
  return /terminated|econnreset|econnrefused|enotfound|etimedout|socket hang up|fetch failed|network error|apiconnection/.test(text);
}

/** Runs `fn`, retrying it on transient errors with exponential backoff. Non-transient
 *  errors throw immediately; after `retries` exhausted, the last error is rethrown. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 500;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === retries || !isTransientError(e)) throw e;
      await new Promise((r) => setTimeout(r, base * 2 ** attempt));
    }
  }
  throw lastErr;
}
