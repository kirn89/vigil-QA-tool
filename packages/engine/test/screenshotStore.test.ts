import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalScreenshotStore,
  SupabaseScreenshotStore,
  screenshotStoreFromEnv,
} from '../src/replay/screenshotStore.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'vigil-shots-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('LocalScreenshotStore', () => {
  it('writes the buffer to baseDir/key and returns that path', async () => {
    const store = new LocalScreenshotStore(dir);
    const loc = await store.put('login-run1-s1.png', Buffer.from('img'));
    expect(loc).toBe(join(dir, 'login-run1-s1.png'));
    expect((await readdir(dir))).toContain('login-run1-s1.png');
  });

  it('prune deletes files older than the cutoff, keeps recent ones, returns the deleted count', async () => {
    const store = new LocalScreenshotStore(dir);
    await writeFile(join(dir, 'old.png'), 'x');
    await writeFile(join(dir, 'fresh.png'), 'y');
    const tenDaysAgo = Date.now() / 1000 - 10 * 86_400;
    await utimes(join(dir, 'old.png'), tenDaysAgo, tenDaysAgo);
    const deleted = await store.prune(7);
    expect(deleted).toBe(1);
    const left = await readdir(dir);
    expect(left).toContain('fresh.png');
    expect(left).not.toContain('old.png');
  });

  it('prune on a missing directory is a no-op (returns 0)', async () => {
    const store = new LocalScreenshotStore(join(dir, 'does-not-exist'));
    expect(await store.prune(7)).toBe(0);
  });
});

describe('SupabaseScreenshotStore', () => {
  it('put uploads to the Storage REST API with the service key and upsert', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 200 });
    };
    const store = new SupabaseScreenshotStore(
      { url: 'https://proj.supabase.co', serviceKey: 'svc-key', bucket: 'shots' },
      fakeFetch as unknown as typeof fetch,
    );
    const loc = await store.put('login-run1-s1.png', Buffer.from('img'));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://proj.supabase.co/storage/v1/object/shots/login-run1-s1.png');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer svc-key');
    expect(headers['x-upsert']).toBe('true');
    // the returned locator is the bucket-relative object path
    expect(loc).toBe('shots/login-run1-s1.png');
  });

  it('put throws when the upload response is not ok', async () => {
    const fakeFetch = async () => new Response('denied', { status: 403 });
    const store = new SupabaseScreenshotStore(
      { url: 'https://proj.supabase.co', serviceKey: 'k', bucket: 'shots' },
      fakeFetch as unknown as typeof fetch,
    );
    await expect(store.put('a.png', Buffer.from('x'))).rejects.toThrow(/upload failed/i);
  });
});

describe('screenshotStoreFromEnv', () => {
  const KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SCREENSHOT_BUCKET'] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('returns a LocalScreenshotStore when Supabase env is absent', () => {
    expect(screenshotStoreFromEnv('artifacts/x')).toBeInstanceOf(LocalScreenshotStore);
  });

  it('returns a SupabaseScreenshotStore when all Supabase env vars are present', () => {
    process.env.SUPABASE_URL = 'https://proj.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'svc';
    process.env.SUPABASE_SCREENSHOT_BUCKET = 'shots';
    expect(screenshotStoreFromEnv('artifacts/x')).toBeInstanceOf(SupabaseScreenshotStore);
  });
});
