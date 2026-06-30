import { describe, expect, it, vi } from 'vitest';
import { cmdNightly } from '../src/cli.js';

describe('cmdNightly', () => {
  it('runs check + sweep for every app, prunes once, and one failing app does not abort the rest', async () => {
    const ran: string[] = [];
    let pruned = 0;
    const errs = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await cmdNightly({
      listApps: async () => [{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }],
      runApp: async (name) => { ran.push(name); if (name === 'beta') throw new Error('beta run broke'); },
      prune: async () => { pruned++; },
    });

    expect(ran).toEqual(['alpha', 'beta', 'gamma']); // every app attempted despite beta throwing
    expect(pruned).toBe(1);                          // prune runs once, after all apps
    expect(errs.mock.calls.flat().join(' ')).toMatch(/beta/);
    errs.mockRestore();
  });
});
