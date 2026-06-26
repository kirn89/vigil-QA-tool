import { describe, expect, it, vi } from 'vitest';
import { parseLocator, signedUrlFor } from '../src/lib/screenshots.js';

describe('parseLocator', () => {
  it('splits a Supabase bucket locator into bucket + key', () => {
    expect(parseLocator('Vigil_screenshots/app/run/s1.png')).toEqual({ bucket: 'Vigil_screenshots', key: 'app/run/s1.png' });
  });
  it('returns null for a local filesystem path', () => {
    expect(parseLocator('/Users/x/artifacts/run/s1.png')).toBeNull();
    expect(parseLocator('artifacts/run/s1.png')).toBeNull();
  });
});

describe('signedUrlFor', () => {
  it('mints a signed URL for a bucket locator', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed/x' } });
    const storage = { from: vi.fn().mockReturnValue({ createSignedUrl }) };
    const url = await signedUrlFor(storage, 'Vigil_screenshots/a/s1.png', 60);
    expect(storage.from).toHaveBeenCalledWith('Vigil_screenshots');
    expect(createSignedUrl).toHaveBeenCalledWith('a/s1.png', 60);
    expect(url).toBe('https://signed/x');
  });
  it('returns null (placeholder) for a local path without calling storage', async () => {
    const storage = { from: vi.fn() };
    expect(await signedUrlFor(storage, '/tmp/s1.png')).toBeNull();
    expect(storage.from).not.toHaveBeenCalled();
  });
});
