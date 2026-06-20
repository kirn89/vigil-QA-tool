import { replayFlow } from '../replay/executor.js';
import type { GoldenPath } from '../flows/goldenPath.js';

export interface VerifyOptions {
  baseUrl: string;
  credentials?: { email: string; password: string };
  artifactsDir?: string;
  stepTimeoutMs?: number;
}

export interface VerifyResult { verified: boolean; note?: string; }

/** Replays a golden path once in a fresh browser (same conditions as a real check).
 *  A flow that only worked inside the mapper's already-logged-in session — i.e. is not
 *  self-contained — correctly fails here. Zero LLM cost: pure deterministic replay. */
export async function verifyFlow(flow: GoldenPath, opts: VerifyOptions): Promise<VerifyResult> {
  const attempt = await replayFlow(flow, {
    baseUrl: opts.baseUrl,
    credentials: opts.credentials,
    artifactsDir: opts.artifactsDir ?? 'artifacts/verify',
    runId: `verify-${flow.name}-${Date.now()}`,
    stepTimeoutMs: opts.stepTimeoutMs,
  });
  if (attempt.outcome === 'completed') return { verified: true };
  const failed = attempt.steps.find((s) => s.status === 'failed');
  const where = attempt.failedStepId ?? attempt.outcome;
  const why = failed?.error ?? attempt.error ?? 'did not complete';
  return { verified: false, note: `step ${where}: ${why.split('\n')[0]!.slice(0, 160)}` };
}
