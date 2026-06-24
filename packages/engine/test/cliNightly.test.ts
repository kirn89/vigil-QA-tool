import { describe, expect, it, vi } from 'vitest';
import { cmdNightly } from '../src/cli.js';

describe('cmdNightly', () => {
  it('runs check + sweep for every app, prunes once, and one failing app does not abort the rest', async () => {
    const checked: string[] = [];
    const swept: string[] = [];
    let pruned = 0;
    const errs = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await cmdNightly({
      listApps: async () => [{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }],
      check: async (name) => { checked.push(name); if (name === 'beta') throw new Error('beta check broke'); },
      sweep: async (name) => { swept.push(name); },
      prune: async () => { pruned++; },
    });

    // every app was attempted for both lanes despite beta's check throwing
    expect(checked).toEqual(['alpha', 'beta', 'gamma']);
    expect(swept).toEqual(['alpha', 'beta', 'gamma']);
    // prune runs exactly once, after all apps
    expect(pruned).toBe(1);
    // the failure was logged, not swallowed silently
    expect(errs.mock.calls.flat().join(' ')).toMatch(/beta/);
    errs.mockRestore();
  });
});
