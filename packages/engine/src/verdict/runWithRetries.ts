import { setTimeout as sleep } from 'node:timers/promises';
import type { FlowAttempt } from '../replay/executor.js';
import { classifyAttempts, type FlowVerdict } from './classify.js';

export interface RetryOptions { maxAttempts: number; backoffMs: number; }

export async function runWithRetries(
  attempt: (attemptIndex: number) => Promise<FlowAttempt>,
  opts: RetryOptions = { maxAttempts: 3, backoffMs: 2_000 },
): Promise<FlowVerdict> {
  const attempts: FlowAttempt[] = [];
  for (let i = 0; i < opts.maxAttempts; i++) {
    const a = await attempt(i);
    attempts.push(a);
    if (a.outcome === 'completed') break;
    if (i < opts.maxAttempts - 1) await sleep(opts.backoffMs * (i + 1));
  }
  return classifyAttempts(attempts);
}
