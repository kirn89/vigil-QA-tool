import { describe, expect, it } from 'vitest';
import { runWithRetries } from '../src/verdict/runWithRetries.js';
import type { FlowAttempt } from '../src/replay/executor.js';

const completed: FlowAttempt = { outcome: 'completed', steps: [], consoleErrors: [] };
const failedAt = (id: string): FlowAttempt => ({ outcome: 'failed_step', failedStepId: id, steps: [], consoleErrors: [] });

describe('runWithRetries', () => {
  it('stops after the first success', async () => {
    let calls = 0;
    const v = await runWithRetries(async () => { calls++; return completed; }, { maxAttempts: 3, backoffMs: 1 });
    expect(v.verdict).toBe('pass');
    expect(calls).toBe(1);
  });

  it('makes 3 attempts before declaring BROKEN (spec §6: retried twice before alerting)', async () => {
    let calls = 0;
    const v = await runWithRetries(async () => { calls++; return failedAt('s5'); }, { maxAttempts: 3, backoffMs: 1 });
    expect(v.verdict).toBe('broken');
    expect(calls).toBe(3);
  });

  it('recovers to PASS when a retry succeeds', async () => {
    let calls = 0;
    const v = await runWithRetries(async () => (++calls < 2 ? failedAt('s1') : completed), { maxAttempts: 3, backoffMs: 1 });
    expect(v.verdict).toBe('pass');
    expect(calls).toBe(2);
  });

  it('passes the attempt index to the runner (used for per-attempt artifacts)', async () => {
    const seen: number[] = [];
    await runWithRetries(async (attempt) => { seen.push(attempt); return failedAt('s1'); }, { maxAttempts: 3, backoffMs: 1 });
    expect(seen).toEqual([0, 1, 2]);
  });
});
