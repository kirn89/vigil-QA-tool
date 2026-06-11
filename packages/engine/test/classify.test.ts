import { describe, expect, it } from 'vitest';
import { classifyAttempts } from '../src/verdict/classify.js';
import type { FlowAttempt } from '../src/replay/executor.js';

const completed: FlowAttempt = { outcome: 'completed', steps: [], consoleErrors: [] };
const failedAt = (id: string): FlowAttempt => ({ outcome: 'failed_step', failedStepId: id, steps: [], consoleErrors: [] });
const crashed: FlowAttempt = { outcome: 'crashed', steps: [], consoleErrors: [], error: 'browser died' };

describe('classifyAttempts', () => {
  it('PASS if any attempt completed', () => {
    expect(classifyAttempts([failedAt('s5'), completed]).verdict).toBe('pass');
  });
  it('BROKEN when every attempt fails at the same step', () => {
    const v = classifyAttempts([failedAt('s5'), failedAt('s5'), failedAt('s5')]);
    expect(v.verdict).toBe('broken');
    expect(v.failedStepId).toBe('s5');
  });
  it('UNSURE when attempts fail at different steps', () => {
    expect(classifyAttempts([failedAt('s2'), failedAt('s5'), failedAt('s4')]).verdict).toBe('unsure');
  });
  it('UNSURE when attempts crash (might be us, not them)', () => {
    expect(classifyAttempts([crashed, crashed, crashed]).verdict).toBe('unsure');
  });
});
