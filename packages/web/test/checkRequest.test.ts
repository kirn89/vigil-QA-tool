import { describe, expect, it, vi } from 'vitest';
import { createCheckJob } from '../src/lib/checkRequest.js';

function deps(over: Partial<Parameters<typeof createCheckJob>[0]> = {}) {
  return {
    getApp: vi.fn(async () => ({ id: 'a1', previewUrl: 'https://p.test' })),
    hasActiveJob: vi.fn(async () => false),
    insertJob: vi.fn(async () => 'job-1'),
    ...over,
  };
}

describe('createCheckJob', () => {
  it('inserts a job for an owned app and returns the id', async () => {
    const d = deps();
    const r = await createCheckJob(d, 'a1', 'production');
    expect(r).toEqual({ ok: true, jobId: 'job-1' });
    expect(d.insertJob).toHaveBeenCalledWith('a1', 'production');
  });
  it('rejects an unknown/unowned app', async () => {
    const r = await createCheckJob(deps({ getApp: vi.fn(async () => null) }), 'x', 'production');
    expect(r).toEqual({ ok: false, reason: 'not_found' });
  });
  it('rejects preview when the app has no preview URL', async () => {
    const r = await createCheckJob(deps({ getApp: vi.fn(async () => ({ id: 'a1', previewUrl: null })) }), 'a1', 'preview');
    expect(r).toEqual({ ok: false, reason: 'no_preview' });
  });
  it('dedupes when a job is already active', async () => {
    const d = deps({ hasActiveJob: vi.fn(async () => true) });
    const r = await createCheckJob(d, 'a1', 'production');
    expect(r).toEqual({ ok: false, reason: 'busy' });
    expect(d.insertJob).not.toHaveBeenCalled();
  });
});
