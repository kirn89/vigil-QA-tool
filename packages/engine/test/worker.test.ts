import { describe, expect, it, vi } from 'vitest';
import { runWorkerOnce, runWorkerLoop } from '../src/worker.js';

describe('runWorkerOnce', () => {
  it('returns idle and runs nothing when the queue is empty', async () => {
    const run = vi.fn();
    const finish = vi.fn();
    const r = await runWorkerOnce({ claim: async () => null, run, finish });
    expect(r).toBe('idle');
    expect(run).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  it('runs a claimed job and finishes it done', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const finish = vi.fn();
    const r = await runWorkerOnce({ claim: async () => ({ id: 'j1', appId: 'a1', environment: 'preview' }), run, finish });
    expect(run).toHaveBeenCalledWith('a1', 'preview');
    expect(finish).toHaveBeenCalledWith('j1', true, null);
    expect(r).toBe('done');
  });

  it('marks the job failed with the error message when the run throws', async () => {
    const run = vi.fn().mockRejectedValue(new Error('crawler died'));
    const finish = vi.fn();
    const r = await runWorkerOnce({ claim: async () => ({ id: 'j2', appId: 'a2', environment: 'production' }), run, finish });
    expect(finish).toHaveBeenCalledWith('j2', false, 'crawler died');
    expect(r).toBe('failed');
  });
});

describe('runWorkerLoop', () => {
  it('keeps polling when an iteration throws instead of crashing', async () => {
    const ctrl = new AbortController();
    let calls = 0;
    const errs = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const deps = {
      claim: async () => { calls++; if (calls >= 2) ctrl.abort(); throw new Error('db blip'); },
      run: vi.fn(),
      finish: vi.fn(),
    };
    await expect(runWorkerLoop(deps, { pollMs: 0, signal: ctrl.signal })).resolves.toBeUndefined();
    expect(calls).toBeGreaterThanOrEqual(2);
    errs.mockRestore();
  });
});
