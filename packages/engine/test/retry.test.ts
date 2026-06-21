import { describe, expect, it } from 'vitest';
import { withRetry, isTransientError } from '../src/map/retry.js';

describe('isTransientError', () => {
  it('treats connection-drop / network errors as transient', () => {
    for (const m of ['terminated', 'ECONNRESET', 'socket hang up', 'fetch failed', 'ETIMEDOUT']) {
      expect(isTransientError(new Error(m)), m).toBe(true);
    }
  });
  it('treats 429 and 5xx as transient, 4xx (except 429) as not', () => {
    expect(isTransientError(Object.assign(new Error('x'), { status: 429 }))).toBe(true);
    expect(isTransientError(Object.assign(new Error('x'), { status: 503 }))).toBe(true);
    expect(isTransientError(Object.assign(new Error('x'), { status: 400 }))).toBe(false);
    expect(isTransientError(Object.assign(new Error('x'), { status: 401 }))).toBe(false);
  });
  it('treats a plain validation error as not transient', () => {
    expect(isTransientError(new Error('invalid model'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('retries a transient failure with backoff then succeeds', async () => {
    let calls = 0;
    const r = await withRetry(async () => { calls++; if (calls < 3) throw new Error('terminated'); return 'ok'; }, { retries: 3, baseDelayMs: 1 });
    expect(r).toBe('ok');
    expect(calls).toBe(3);
  });
  it('does not retry a non-transient error', async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw Object.assign(new Error('bad request'), { status: 400 }); }, { retries: 3, baseDelayMs: 1 }))
      .rejects.toThrow('bad request');
    expect(calls).toBe(1);
  });
  it('throws the last error after exhausting retries', async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw new Error('terminated'); }, { retries: 2, baseDelayMs: 1 }))
      .rejects.toThrow('terminated');
    expect(calls).toBe(3); // initial + 2 retries
  });
});
