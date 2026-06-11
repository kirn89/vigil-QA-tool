import type { FlowAttempt } from '../replay/executor.js';

export type Verdict = 'pass' | 'broken' | 'unsure';

export interface FlowVerdict {
  verdict: Verdict;
  failedStepId?: string;
  attempts: FlowAttempt[];
}

/** Spec §4.4: three states, never binary. BROKEN requires consistent failure at one
 *  step across all attempts; anything inconsistent or crash-flavored is UNSURE. */
export function classifyAttempts(attempts: FlowAttempt[]): FlowVerdict {
  if (attempts.some((a) => a.outcome === 'completed')) return { verdict: 'pass', attempts };
  const failurePoints = new Set(attempts.map((a) => a.failedStepId ?? `__${a.outcome}`));
  const only = attempts[0]?.failedStepId;
  if (failurePoints.size === 1 && only) return { verdict: 'broken', failedStepId: only, attempts };
  return { verdict: 'unsure', attempts };
}
