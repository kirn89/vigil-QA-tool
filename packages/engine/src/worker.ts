export interface ClaimedJob { id: string; appId: string; environment: 'production' | 'preview'; }
export interface WorkerDeps {
  claim: () => Promise<ClaimedJob | null>;
  run: (appId: string, environment: 'production' | 'preview') => Promise<void>;
  finish: (id: string, ok: boolean, error?: string | null) => Promise<void>;
}

/** Process at most one job. Returns 'idle' (none queued), 'done', or 'failed'. */
export async function runWorkerOnce(deps: WorkerDeps): Promise<'idle' | 'done' | 'failed'> {
  const job = await deps.claim();
  if (!job) return 'idle';
  try {
    await deps.run(job.appId, job.environment);
    await deps.finish(job.id, true, null);
    return 'done';
  } catch (e) {
    await deps.finish(job.id, false, e instanceof Error ? e.message : String(e));
    return 'failed';
  }
}

/** Poll-and-run loop. Sleeps `pollMs` only when idle; stops on abort. */
export async function runWorkerLoop(deps: WorkerDeps, opts: { pollMs?: number; signal?: AbortSignal } = {}): Promise<void> {
  const pollMs = opts.pollMs ?? 5_000;
  while (!opts.signal?.aborted) {
    const result = await runWorkerOnce(deps);
    if (result === 'idle') await new Promise((r) => setTimeout(r, pollMs));
  }
}
