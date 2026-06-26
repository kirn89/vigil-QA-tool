import { describe, expect, it } from 'vitest';
import { statusLabel } from '../src/lib/format.js';

describe('statusLabel', () => {
  it('maps verdicts to plain-English, non-alarmist labels', () => {
    expect(statusLabel('pass')).toBe('All clear');
    expect(statusLabel('broken')).toBe('Broken');
    expect(statusLabel('unsure')).toBe('Needs a look');
    expect(statusLabel(null)).toBe('Not checked yet');
  });
});
