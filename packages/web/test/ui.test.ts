import { describe, expect, it } from 'vitest';
import { statusStyles, relativeTime } from '../src/lib/ui.js';

describe('statusStyles', () => {
  it('maps verdicts to calm labels and tokenized pills', () => {
    expect(statusStyles('pass').label).toBe('All clear');
    expect(statusStyles('pass').pill).toContain('pass');
    expect(statusStyles('broken').label).toBe('Broken');
    expect(statusStyles('broken').pill).toContain('broken');
    const unsure = statusStyles('unsure');
    expect(unsure.label).toBe('Needs a look');
    expect(unsure.pill).toContain('warn');     // amber family
    expect(unsure.pill).not.toContain('broken'); // never red
    expect(statusStyles(null).label).toBe('Not checked yet');
  });
});

describe('relativeTime', () => {
  it('returns a never-checked hint for null and a relative string otherwise', () => {
    expect(relativeTime(null)).toBe('Not checked yet');
    const out = relativeTime(new Date(Date.now() - 2 * 3600_000).toISOString());
    expect(out).toMatch(/hour|hours/);
  });
});
