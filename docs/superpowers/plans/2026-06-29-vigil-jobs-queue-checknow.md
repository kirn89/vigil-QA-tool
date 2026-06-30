# Jobs Queue + Worker + Check-now (Phase 2.2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Check-now a complete feature: from an app's page the user runs an on-demand full test (deep flows + breadth sweep) against production or preview, executed by a worker the web dispatches to via a Supabase jobs queue.

**Architecture:** A `jobs` table (engine migration) + RLS (web/supabase). The engine gains a `jobsRepo`, a `cmdSweep` target option, a shared `runAppFull(appName, environment)` (used by both nightly and the worker), and a `vigil worker` that claims jobs (`FOR UPDATE SKIP LOCKED`) and runs them. The web gains a `requestCheck` server action (enqueue, RLS-scoped), a `latestJob` reader, and a client Check-now control that polls job status.

**Tech Stack:** TypeScript ESM, node-postgres, Playwright (existing engine), Next.js 15 + @supabase/ssr (web), Vitest (+ @testing-library/react for the web control).

## Global Constraints

- Check-now lives ONLY on the individual app page (`/apps/[id]`), never the Overview.
- Check-now runs on an already-mapped app (first run or re-test); the full test = confirmed flows (check) + breadth sweep, both against the chosen target.
- Target is production or preview; preview is only offered/allowed when the app has a preview URL.
- `runAppFull(appName, environment)` is the single shared run for nightly AND the worker; nightly behavior is unchanged (it runs `runAppFull(app, 'production')` per app).
- `runAppFull` skips the check (does NOT throw) when an app has no confirmed flows, but still runs the sweep.
- The `jobs` TABLE goes in `packages/engine/migrations/004_jobs.sql` (no auth refs — applies in embedded-PG tests and Supabase). Its RLS goes in `packages/web/supabase/001_web_rls.sql` (Supabase-only), never the engine migrate runner.
- The worker uses the service role (bypasses RLS); the web enqueues under the user session (INSERT RLS scopes to owned apps).
- Job status lifecycle: queued → running → done | failed.
- Engine tests run from repo root via `pnpm --filter @vigil/engine test` (global setup pins the embedded DB — never source the prod `.env`). Web tests via `pnpm --filter @vigil/web test`.
- ESM `.js` import specifiers throughout.

---

## File Structure

- `packages/engine/migrations/004_jobs.sql` — jobs table (create)
- `packages/engine/src/db/jobsRepo.ts` — claim/finish/enqueue/active (create)
- `packages/engine/src/cli.ts` — `cmdSweep` gains `environment`; add `runAppFull`; refactor `cmdNightly`; add `cmdWorker` + commander wiring (modify)
- `packages/engine/src/worker.ts` — `runWorkerOnce` + loop (create)
- `packages/web/supabase/001_web_rls.sql` — append jobs RLS (modify)
- `packages/web/src/lib/data.ts` — `latestJob` (modify)
- `packages/web/src/lib/checkRequest.ts` — testable `createCheckJob` core (create)
- `packages/web/src/app/(app)/apps/[id]/check-now-actions.ts` — `requestCheck` / `pollJob` server actions (create)
- `packages/web/src/components/CheckNowButton.tsx` — live client control (replace the disabled stub)
- `packages/web/src/app/(app)/apps/[id]/page.tsx` — pass previewUrl + latestJob to the control (modify)
- Tests under `packages/engine/test/` and `packages/web/test/`

---

## Task 1: jobs table (migration 004) + jobsRepo

**Files:**
- Create: `packages/engine/migrations/004_jobs.sql`, `packages/engine/src/db/jobsRepo.ts`
- Test: `packages/engine/test/jobsRepo.test.ts`

**Interfaces:**
- Produces:
  - `type JobStatus = 'queued' | 'running' | 'done' | 'failed'`; `type JobEnvironment = 'production' | 'preview'`
  - `interface JobRecord { id: string; appId: string; type: 'check_now'; environment: JobEnvironment; status: JobStatus; error: string | null }`
  - `enqueueJob(appId: string, type: 'check_now', environment: JobEnvironment, requestedBy?: string | null): Promise<string>`
  - `claimNextJob(): Promise<JobRecord | null>`
  - `finishJob(id: string, ok: boolean, error?: string | null): Promise<void>`
  - `hasActiveJob(appId: string): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/jobsRepo.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, createApp } from '../src/db/appsRepo.js';
import { enqueueJob, claimNextJob, finishJob, hasActiveJob } from '../src/db/jobsRepo.js';

let appId: string;
beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings, journey_candidates, jobs cascade');
  const userId = await ensureUser('founder@vigil.test');
  appId = (await createApp({ userId, name: 'demo', productionUrl: 'http://x.test', previewUrl: null, credentials: null })).id;
});

describe('jobsRepo', () => {
  it('enqueues, then claims exactly one queued job (oldest first) and marks it running', async () => {
    await enqueueJob(appId, 'check_now', 'production');
    const claimed = await claimNextJob();
    expect(claimed?.appId).toBe(appId);
    expect(claimed?.status).toBe('running');
    expect(claimed?.environment).toBe('production');
    // queue now empty
    expect(await claimNextJob()).toBeNull();
  });

  it('hasActiveJob is true while queued/running, false once finished', async () => {
    const id = await enqueueJob(appId, 'check_now', 'preview');
    expect(await hasActiveJob(appId)).toBe(true);   // queued
    await claimNextJob();
    expect(await hasActiveJob(appId)).toBe(true);   // running
    await finishJob(id, true);
    expect(await hasActiveJob(appId)).toBe(false);  // done
  });

  it('finishJob records failure with an error message', async () => {
    const id = await enqueueJob(appId, 'check_now', 'production');
    await claimNextJob();
    await finishJob(id, false, 'boom');
    const { rows } = await getPool().query('select status, error from jobs where id=$1', [id]);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error).toBe('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test jobsRepo`
Expected: FAIL — `jobs` relation does not exist / module not found.

- [ ] **Step 3: Write the migration**

Create `packages/engine/migrations/004_jobs.sql`:

```sql
create table jobs (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references apps(id) on delete cascade,
  type text not null check (type in ('check_now')),
  environment text not null default 'production' check (environment in ('production', 'preview')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  error text,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index jobs_claim_idx on jobs (status, requested_at);
```

- [ ] **Step 4: Implement `jobsRepo.ts`**

```typescript
import { getPool } from './pool.js';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type JobEnvironment = 'production' | 'preview';
export interface JobRecord { id: string; appId: string; type: 'check_now'; environment: JobEnvironment; status: JobStatus; error: string | null; }

interface Row { id: string; app_id: string; type: 'check_now'; environment: JobEnvironment; status: JobStatus; error: string | null; }
const map = (r: Row): JobRecord => ({ id: r.id, appId: r.app_id, type: r.type, environment: r.environment, status: r.status, error: r.error });

export async function enqueueJob(appId: string, type: 'check_now', environment: JobEnvironment, requestedBy: string | null = null): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    'insert into jobs (app_id, type, environment, requested_by) values ($1, $2, $3, $4) returning id',
    [appId, type, environment, requestedBy]);
  return rows[0]!.id;
}

/** Atomically claim the oldest queued job, marking it running. Concurrent workers
 *  skip a locked row (FOR UPDATE SKIP LOCKED), so no two claim the same job. */
export async function claimNextJob(): Promise<JobRecord | null> {
  const { rows } = await getPool().query<Row>(
    `update jobs set status = 'running', started_at = now()
     where id = (select id from jobs where status = 'queued' order by requested_at for update skip locked limit 1)
     returning id, app_id, type, environment, status, error`);
  return rows[0] ? map(rows[0]) : null;
}

export async function finishJob(id: string, ok: boolean, error: string | null = null): Promise<void> {
  await getPool().query(
    "update jobs set status = $2, error = $3, finished_at = now() where id = $1",
    [id, ok ? 'done' : 'failed', ok ? null : error]);
}

export async function hasActiveJob(appId: string): Promise<boolean> {
  const { rows } = await getPool().query<{ n: number }>(
    "select count(*)::int n from jobs where app_id = $1 and status in ('queued','running')", [appId]);
  return rows[0]!.n > 0;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test jobsRepo`
Expected: PASS (all three).

- [ ] **Step 6: Commit**

```bash
git add packages/engine/migrations/004_jobs.sql packages/engine/src/db/jobsRepo.ts packages/engine/test/jobsRepo.test.ts
git commit -m "feat(engine): jobs table + jobsRepo (claim/finish/enqueue/active)"
```

---

## Task 2: cmdSweep target environment

**Files:**
- Modify: `packages/engine/src/cli.ts` (`cmdSweep`)
- Test: `packages/engine/test/cli.test.ts` (add a case)

**Interfaces:**
- Consumes: existing `cmdSweep`, `sweepSite`.
- Produces: `cmdSweep(appName, opts?: { deep?: boolean; environment?: 'production' | 'preview' })` — sweeps the preview URL when `environment==='preview'`, else production.

- [ ] **Step 1: Write the failing test**

Add to `packages/engine/test/cli.test.ts` (it already imports `* as crawler` and spies `sweepSite`; follow that pattern). Append inside the existing top-level `describe`:

```typescript
  it('cmdSweep targets the preview URL when environment is preview', async () => {
    const sweep = vi.spyOn(crawler, 'sweepSite').mockResolvedValue({ pages: [], findings: [] });
    await cmdAppAdd({ name: 'prevapp', url: 'https://prod.test', previewUrl: 'https://preview.test' });
    await cmdSweep('prevapp', { environment: 'preview' });
    expect(sweep).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: 'https://preview.test' }));
    sweep.mockRestore();
  });
```

Ensure `cmdSweep` and `cmdAppAdd` are imported in the test file (add to the existing import from `../src/cli.js` if missing).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test cli -- -t "targets the preview URL"`
Expected: FAIL — `cmdSweep` ignores `environment`; `baseUrl` is the production URL.

- [ ] **Step 3: Update `cmdSweep`**

In `packages/engine/src/cli.ts`, change the `cmdSweep` signature and `baseUrl`:

```typescript
export async function cmdSweep(appName: string, opts: { deep?: boolean; environment?: 'production' | 'preview' } = {}): Promise<void> {
  const app = await requireApp(appName);
  const baseUrl = opts.environment === 'preview' ? app.previewUrl : app.productionUrl;
  if (!baseUrl) throw new Error(`App "${appName}" has no ${opts.environment === 'preview' ? 'preview' : 'production'} URL`);
  const flows = await listConfirmedFlows(app.id);
  const loginFlow = flows.find((f) => f.goldenPath.name.toLowerCase() === 'login')?.goldenPath;
  let navDiscovery = opts.deep ?? false;
  if (navDiscovery && UNSAFE_NAV_APPS.has(app.name)) {
    console.warn(`deep nav-discovery disabled for "${app.name}" (clicking controls is unsafe here)`);
    navDiscovery = false;
  }
  const result = await sweepSite({
    baseUrl, maxPages: 200,
    loginFlow, credentials: app.credentials ?? undefined, navDiscovery,
  });
  await recordSweep(app.id, result);
  console.log(`Swept ${result.pages.length} pages, ${result.findings.length} raw findings (confirmation needs 2 consecutive sweeps)`);
}
```

Update the commander `sweep` command to pass environment if a `--preview` flag is desired (optional): leave the CLI flag as-is; the new option is used programmatically by `runAppFull`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test cli`
Expected: PASS — including the new case and existing CLI tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/cli.ts packages/engine/test/cli.test.ts
git commit -m "feat(engine): cmdSweep can target the preview environment"
```

---

## Task 3: runAppFull + cmdNightly refactor

**Files:**
- Modify: `packages/engine/src/cli.ts`
- Test: `packages/engine/test/runAppFull.test.ts`

**Interfaces:**
- Consumes: `cmdCheck`, `cmdSweep`, `requireApp`, `listConfirmedFlows`.
- Produces:
  - `interface RunAppDeps { check?: (appName: string, environment: 'production'|'preview') => Promise<unknown>; sweep?: (appName: string, environment: 'production'|'preview') => Promise<unknown>; flowCount?: (appId: string) => Promise<number> }`
  - `runAppFull(appName: string, environment?: 'production'|'preview', deps?: RunAppDeps): Promise<void>` — runs the check (only if confirmed flows exist) then the sweep, both at `environment`.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/runAppFull.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, createApp } from '../src/db/appsRepo.js';
import { addFlow } from '../src/db/flowsRepo.js';
import { runAppFull } from '../src/cli.js';

beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings, journey_candidates, jobs cascade');
});

const flow = (name: string) => ({ name, steps: [{ id: 's1', action: { kind: 'goto', path: '/' } }] });

describe('runAppFull', () => {
  it('runs check + sweep with the given environment when confirmed flows exist', async () => {
    const userId = await ensureUser(process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local');
    const app = await createApp({ userId, name: 'demo', productionUrl: 'http://x.test', previewUrl: 'http://p.test', credentials: null });
    await addFlow(app.id, flow('login'), 'confirmed', { verified: true });
    const calls: string[] = [];
    await runAppFull('demo', 'preview', {
      check: async (n, env) => { calls.push(`check:${n}:${env}`); },
      sweep: async (n, env) => { calls.push(`sweep:${n}:${env}`); },
    });
    expect(calls).toEqual(['check:demo:preview', 'sweep:demo:preview']);
  });

  it('skips the check (no throw) when there are no confirmed flows, but still sweeps', async () => {
    const userId = await ensureUser(process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local');
    await createApp({ userId, name: 'fresh', productionUrl: 'http://x.test', previewUrl: null, credentials: null });
    const calls: string[] = [];
    await runAppFull('fresh', 'production', {
      check: async () => { calls.push('check'); },
      sweep: async (n, env) => { calls.push(`sweep:${n}:${env}`); },
    });
    expect(calls).toEqual(['sweep:fresh:production']); // no check
  });

  it('still sweeps when the check throws, then rethrows so the worker sees the failure', async () => {
    const userId = await ensureUser(process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local');
    const app = await createApp({ userId, name: 'broken', productionUrl: 'http://x.test', previewUrl: null, credentials: null });
    await addFlow(app.id, flow('login'), 'confirmed', { verified: true });
    const calls: string[] = [];
    await expect(runAppFull('broken', 'production', {
      check: async () => { calls.push('check'); throw new Error('check crashed'); },
      sweep: async () => { calls.push('sweep'); },
    })).rejects.toThrow('check crashed');
    expect(calls).toEqual(['check', 'sweep']); // sweep ran despite the check failure
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test runAppFull`
Expected: FAIL — `runAppFull` not exported.

- [ ] **Step 3: Implement `runAppFull` and refactor `cmdNightly`**

In `packages/engine/src/cli.ts`, add `runAppFull` (place it after `cmdSweep`):

```typescript
export interface RunAppDeps {
  check?: (appName: string, environment: 'production' | 'preview') => Promise<unknown>;
  sweep?: (appName: string, environment: 'production' | 'preview') => Promise<unknown>;
}

/** The single full test (check + sweep) shared by nightly and the on-demand worker.
 *  Skips the check when the app has no confirmed flows yet, but always sweeps. Runs
 *  the two lanes INDEPENDENTLY — a check failure does not skip the sweep — then
 *  re-throws if either lane failed, so the worker can mark the job failed and
 *  nightly can log it (preserving nightly's per-lane resilience). */
export async function runAppFull(appName: string, environment: 'production' | 'preview' = 'production', deps: RunAppDeps = {}): Promise<void> {
  const check = deps.check ?? ((n, env) => cmdCheck(n, { preview: env === 'preview' }));
  const sweep = deps.sweep ?? ((n, env) => cmdSweep(n, { environment: env }));
  const flowCount = (await listConfirmedFlows((await requireApp(appName)).id)).length;
  const errors: unknown[] = [];
  if (flowCount > 0) {
    try { await check(appName, environment); } catch (e) { errors.push(e); }
  }
  try { await sweep(appName, environment); } catch (e) { errors.push(e); }
  if (errors.length > 0) throw errors[0];
}
```

Then refactor `cmdNightly` to inject a single per-app run (`runApp`) instead of separate `check`/`sweep`, defaulting to `runAppFull`. Change `NightlyDeps` to:

```typescript
export interface NightlyDeps {
  listApps: () => Promise<Array<{ name: string }>>;
  runApp: (name: string) => Promise<unknown>;
  prune: () => Promise<unknown>;
}
```

And rewrite `cmdNightly`'s body:

```typescript
export async function cmdNightly(deps: Partial<NightlyDeps> = {}): Promise<void> {
  const listApps = deps.listApps ?? listAllApps;
  const runApp = deps.runApp ?? ((name: string) => runAppFull(name, 'production'));
  const prune = deps.prune ?? (() => cmdPruneScreenshots({}));
  const fail = (name: string, e: unknown) =>
    console.error(`nightly run failed for ${name}: ${e instanceof Error ? e.message : String(e)}`);

  const apps = await listApps();
  console.log(`Nightly run: ${apps.length} app(s)`);
  for (const app of apps) {
    try { await runApp(app.name); } catch (e) { fail(app.name, e); }
  }
  await prune();
}
```

Remove the old `check`/`sweep` members and the old per-lane loop. `runAppFull` already runs both lanes (check + sweep) with per-lane resilience, so nightly still attempts both for every app — the resilience moves from cmdNightly's two try/catch blocks into `runAppFull`.

Also update the existing `packages/engine/test/cliNightly.test.ts` to the new `runApp` injection (it currently injects `check`/`sweep`). Replace its `cmdNightly({...})` call + assertions with:

```typescript
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
```

(Per-lane resilience — that a check failure still lets the sweep run — now lives in `runAppFull` and is covered by its own test below; the nightly test verifies the orchestration: every app run, one failure logged not fatal, prune once.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test runAppFull && pnpm --filter @vigil/engine test cliNightly`
Expected: both PASS — `runAppFull` branches correctly; nightly still processes every app.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/cli.ts packages/engine/test/runAppFull.test.ts packages/engine/test/cliNightly.test.ts
git commit -m "feat(engine): runAppFull shared by nightly + worker (env-aware, per-lane resilient)"
```

---

## Task 4: vigil worker

**Files:**
- Create: `packages/engine/src/worker.ts`
- Modify: `packages/engine/src/cli.ts` (commander `worker` command)
- Test: `packages/engine/test/worker.test.ts`

**Interfaces:**
- Consumes: `claimNextJob`, `finishJob` (Task 1); `runAppFull` (Task 3); `getAppByName`/`ensureUser` for the job's app name.
- Produces:
  - `interface WorkerDeps { claim: () => Promise<{ id: string; appId: string; environment: 'production'|'preview' } | null>; run: (appId: string, environment: 'production'|'preview') => Promise<void>; finish: (id: string, ok: boolean, error?: string | null) => Promise<void> }`
  - `runWorkerOnce(deps: WorkerDeps): Promise<'idle' | 'done' | 'failed'>`
  - `runWorkerLoop(deps: WorkerDeps, opts?: { pollMs?: number; signal?: AbortSignal }): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/worker.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { runWorkerOnce } from '../src/worker.js';

describe('runWorkerOnce', () => {
  it('returns idle and runs nothing when the queue is empty', async () => {
    const run = vi.fn();
    const finish = vi.fn();
    const r = await runWorkerOnce({ claim: async () => null, run, finish });
    expect(r).toBe('idle');
    expect(run).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  it('runs a claimed job and finishes it done', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const finish = vi.fn();
    const r = await runWorkerOnce({ claim: async () => ({ id: 'j1', appId: 'a1', environment: 'preview' }), run, finish });
    expect(run).toHaveBeenCalledWith('a1', 'preview');
    expect(finish).toHaveBeenCalledWith('j1', true, null);
    expect(r).toBe('done');
  });

  it('marks the job failed with the error message when the run throws', async () => {
    const run = vi.fn().mockRejectedValue(new Error('crawler died'));
    const finish = vi.fn();
    const r = await runWorkerOnce({ claim: async () => ({ id: 'j2', appId: 'a2', environment: 'production' }), run, finish });
    expect(finish).toHaveBeenCalledWith('j2', false, 'crawler died');
    expect(r).toBe('failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test worker`
Expected: FAIL — `../src/worker.js` not found.

- [ ] **Step 3: Implement `worker.ts`**

```typescript
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
```

- [ ] **Step 4: Wire the `worker` command in `cli.ts`**

Add imports near the others in `packages/engine/src/cli.ts`:

```typescript
import { claimNextJob, finishJob } from './db/jobsRepo.js';
import { runWorkerLoop } from './worker.js';
import { getAppById } from './db/appsRepo.js';
```

Add `cmdWorker` (after `cmdNightly`):

```typescript
/** Long-running worker: claims check_now jobs and runs the full test for each. */
export async function cmdWorker(opts: { pollMs?: number } = {}): Promise<void> {
  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());
  process.on('SIGTERM', () => controller.abort());
  console.log('vigil worker started; polling for jobs…');
  await runWorkerLoop({
    claim: () => claimNextJob(),
    finish: (id, ok, error) => finishJob(id, ok, error),
    run: async (appId, environment) => {
      const app = await getAppById(appId);
      if (!app) throw new Error(`app ${appId} not found`);
      await runAppFull(app.name, environment);
    },
  }, { pollMs: opts.pollMs, signal: controller.signal });
}
```

Add the commander wiring inside the `if (process.argv[1] === ...)` block:

```typescript
  program.command('worker')
    .description('process queued check_now jobs (long-running)')
    .option('--poll <ms>', 'poll interval in ms', '5000')
    .action(async (o) => { await cmdWorker({ pollMs: Number(o.poll) }); });
```

If `getAppById` does not exist in `appsRepo.ts`, add it:

```typescript
export async function getAppById(id: string): Promise<AppRecord | null> {
  const { rows } = await getPool().query<AppRow>(`select ${APP_COLS} from apps where id = $1`, [id]);
  return rows[0] ? mapApp(rows[0]) : null;
}
```

(Use the same `APP_COLS`/`mapApp`/`AppRow` the file already uses for `getAppByName`; mirror that function exactly with `where id = $1`.)

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm --filter @vigil/engine test worker && pnpm --filter @vigil/engine typecheck`
Expected: worker tests PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/worker.ts packages/engine/src/cli.ts packages/engine/src/db/appsRepo.ts packages/engine/test/worker.test.ts
git commit -m "feat(engine): vigil worker — claim + run check_now jobs"
```

---

## Task 5: jobs RLS + latestJob (web)

**Files:**
- Modify: `packages/web/supabase/001_web_rls.sql`, `packages/web/src/lib/data.ts`
- Test: `packages/web/test/rls.test.ts` (add a jobs case)

**Interfaces:**
- Produces: jobs SELECT + INSERT RLS policies; `latestJob(appId: string): Promise<{ id: string; status: 'queued'|'running'|'done'|'failed'; environment: 'production'|'preview' } | null>` in `data.ts`.

- [ ] **Step 1: Write the failing test**

Add a case to `packages/web/test/rls.test.ts` inside the existing `describe('RLS isolation', ...)` (it already seeds users A/B and switches role to `authenticated` with a jwt-claims `sub`). Append, mirroring the existing app-isolation test's structure:

```typescript
  it('an authenticated user can insert/select jobs only for their own app', async () => {
    const a = randomUUID(), b = randomUUID();
    const c = await pool!.connect();
    try {
      await c.query("insert into users (id, email, auth_id) values (gen_random_uuid(), $1, $2)", [`a-${a}@t.test`, a]);
      await c.query("insert into users (id, email, auth_id) values (gen_random_uuid(), $1, $2)", [`b-${b}@t.test`, b]);
      const { rows: ua } = await c.query("select id from users where auth_id=$1", [a]);
      const { rows: ub } = await c.query("select id from users where auth_id=$1", [b]);
      await c.query("insert into apps (user_id, name, production_url) values ($1,$2,$3)", [ua[0].id, `appA-${a}`, 'https://a.test']);
      await c.query("insert into apps (user_id, name, production_url) values ($1,$2,$3)", [ub[0].id, `appB-${b}`, 'https://b.test']);
      const { rows: appA } = await c.query("select id from apps where name=$1", [`appA-${a}`]);
      const { rows: appB } = await c.query("select id from apps where name=$1", [`appB-${b}`]);
      // B's job seeded via service role:
      await c.query("insert into jobs (app_id, type) values ($1,'check_now')", [appB[0].id]);

      await c.query('begin');
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: a, role: 'authenticated' })]);
      // A can insert a job for A's app
      await c.query("insert into jobs (app_id, type) values ($1,'check_now')", [appA[0].id]);
      // A cannot insert for B's app
      let blocked = false;
      try { await c.query("insert into jobs (app_id, type) values ($1,'check_now')", [appB[0].id]); }
      catch { blocked = true; }
      // A sees only A's jobs
      const { rows: visible } = await c.query('select j.id, a.name from jobs j join apps a on a.id=j.app_id');
      await c.query('rollback');

      expect(blocked).toBe(true);
      expect(visible.map((r) => r.name)).toContain(`appA-${a}`);
      expect(visible.map((r) => r.name)).not.toContain(`appB-${b}`);
    } finally {
      await c.query("delete from apps where name like 'appA-%' or name like 'appB-%'").catch(() => {});
      await c.query("delete from users where email like '%@t.test'").catch(() => {});
      c.release();
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=<supabase-pooler> DATABASE_SSL=true pnpm --filter @vigil/web test rls`
Expected: FAIL — without a jobs RLS policy, RLS is not enabled on `jobs` so A's insert for B's app is NOT blocked (and/or A sees B's job). (Suite SKIPS if no Supabase `DATABASE_URL`; the controller runs it live.)

- [ ] **Step 3: Append jobs RLS to `packages/web/supabase/001_web_rls.sql`**

Add at the end of the file:

```sql
alter table jobs enable row level security;

drop policy if exists web_jobs_select on jobs;
create policy web_jobs_select on jobs for select to authenticated
  using (app_id in (select a.id from apps a join users u on u.id = a.user_id where u.auth_id = auth.uid()));

drop policy if exists web_jobs_insert on jobs;
create policy web_jobs_insert on jobs for insert to authenticated
  with check (type = 'check_now' and app_id in (select a.id from apps a join users u on u.id = a.user_id where u.auth_id = auth.uid()));
```

- [ ] **Step 4: Add `latestJob` to `packages/web/src/lib/data.ts`**

```typescript
export async function latestJob(appId: string): Promise<{ id: string; status: 'queued'|'running'|'done'|'failed'; environment: 'production'|'preview' } | null> {
  const sb = await createClient();
  const { data } = await sb.from('jobs')
    .select('id,status,environment').eq('app_id', appId)
    .order('requested_at', { ascending: false }).limit(1).maybeSingle();
  return data ? { id: data.id, status: data.status, environment: data.environment } : null;
}
```

- [ ] **Step 5: Apply RLS + run the live test**

Run: `DATABASE_URL=<supabase-pooler> DATABASE_SSL=true pnpm --filter @vigil/web db:rls && DATABASE_URL=<supabase-pooler> DATABASE_SSL=true pnpm --filter @vigil/web test rls`
Expected: PASS — A's insert for B's app is blocked; A sees only A's jobs. (Controller runs this live; offline it SKIPS — note that in the report.)

- [ ] **Step 6: Commit**

```bash
git add packages/web/supabase/001_web_rls.sql packages/web/src/lib/data.ts packages/web/test/rls.test.ts
git commit -m "feat(web): jobs RLS (own-app select/insert) + latestJob reader"
```

---

## Task 6: requestCheck server action

**Files:**
- Create: `packages/web/src/lib/checkRequest.ts`, `packages/web/src/app/(app)/apps/[id]/check-now-actions.ts`
- Test: `packages/web/test/checkRequest.test.ts`

**Interfaces:**
- Produces:
  - `interface CheckRequestDeps { getApp(appId: string): Promise<{ id: string; previewUrl: string | null } | null>; hasActiveJob(appId: string): Promise<boolean>; insertJob(appId: string, environment: 'production'|'preview'): Promise<string> }`
  - `type CheckRequestResult = { ok: true; jobId: string } | { ok: false; reason: 'not_found' | 'no_preview' | 'busy' }`
  - `createCheckJob(deps: CheckRequestDeps, appId: string, environment: 'production'|'preview'): Promise<CheckRequestResult>`
  - `requestCheck(appId: string, environment: 'production'|'preview'): Promise<CheckRequestResult>` (server action wiring `createCheckJob` to the Supabase session client).

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/checkRequest.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { createCheckJob } from '../src/lib/checkRequest.js';

function deps(over: Partial<Parameters<typeof createCheckJob>[0]> = {}) {
  return {
    getApp: vi.fn(async () => ({ id: 'a1', previewUrl: 'https://p.test' })),
    hasActiveJob: vi.fn(async () => false),
    insertJob: vi.fn(async () => 'job-1'),
    ...over,
  };
}

describe('createCheckJob', () => {
  it('inserts a job for an owned app and returns the id', async () => {
    const d = deps();
    const r = await createCheckJob(d, 'a1', 'production');
    expect(r).toEqual({ ok: true, jobId: 'job-1' });
    expect(d.insertJob).toHaveBeenCalledWith('a1', 'production');
  });
  it('rejects an unknown/unowned app', async () => {
    const r = await createCheckJob(deps({ getApp: vi.fn(async () => null) }), 'x', 'production');
    expect(r).toEqual({ ok: false, reason: 'not_found' });
  });
  it('rejects preview when the app has no preview URL', async () => {
    const r = await createCheckJob(deps({ getApp: vi.fn(async () => ({ id: 'a1', previewUrl: null })) }), 'a1', 'preview');
    expect(r).toEqual({ ok: false, reason: 'no_preview' });
  });
  it('dedupes when a job is already active', async () => {
    const d = deps({ hasActiveJob: vi.fn(async () => true) });
    const r = await createCheckJob(d, 'a1', 'production');
    expect(r).toEqual({ ok: false, reason: 'busy' });
    expect(d.insertJob).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test checkRequest`
Expected: FAIL — `../src/lib/checkRequest.js` not found.

- [ ] **Step 3: Implement `checkRequest.ts` (testable core)**

```typescript
export interface CheckRequestDeps {
  getApp(appId: string): Promise<{ id: string; previewUrl: string | null } | null>;
  hasActiveJob(appId: string): Promise<boolean>;
  insertJob(appId: string, environment: 'production' | 'preview'): Promise<string>;
}
export type CheckRequestResult = { ok: true; jobId: string } | { ok: false; reason: 'not_found' | 'no_preview' | 'busy' };

export async function createCheckJob(deps: CheckRequestDeps, appId: string, environment: 'production' | 'preview'): Promise<CheckRequestResult> {
  const app = await deps.getApp(appId);
  if (!app) return { ok: false, reason: 'not_found' };
  if (environment === 'preview' && !app.previewUrl) return { ok: false, reason: 'no_preview' };
  if (await deps.hasActiveJob(appId)) return { ok: false, reason: 'busy' };
  const jobId = await deps.insertJob(appId, environment);
  return { ok: true, jobId };
}
```

- [ ] **Step 4: Implement the server action wiring**

Create `packages/web/src/app/(app)/apps/[id]/check-now-actions.ts`:

```typescript
'use server';
import { createClient } from '../../../../lib/supabase/server.js';
import { createCheckJob, type CheckRequestResult } from '../../../../lib/checkRequest.js';
import { latestJob } from '../../../../lib/data.js';

export async function requestCheck(appId: string, environment: 'production' | 'preview'): Promise<CheckRequestResult> {
  const sb = await createClient();
  return createCheckJob({
    getApp: async (id) => {
      const { data } = await sb.from('apps').select('id,preview_url').eq('id', id).maybeSingle();
      return data ? { id: data.id, previewUrl: data.preview_url } : null;
    },
    hasActiveJob: async (id) => {
      const { count } = await sb.from('jobs').select('id', { count: 'exact', head: true })
        .eq('app_id', id).in('status', ['queued', 'running']);
      return (count ?? 0) > 0;
    },
    insertJob: async (id, env) => {
      const { data, error } = await sb.from('jobs').insert({ app_id: id, type: 'check_now', environment: env }).select('id').single();
      if (error) throw error;
      return data.id;
    },
  }, appId, environment);
}

export async function pollJob(appId: string) {
  return latestJob(appId);
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm --filter @vigil/web test checkRequest && pnpm --filter @vigil/web typecheck`
Expected: checkRequest tests PASS (4); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/checkRequest.ts "packages/web/src/app/(app)/apps/[id]/check-now-actions.ts" packages/web/test/checkRequest.test.ts
git commit -m "feat(web): requestCheck server action (ownership/preview/dedupe) + pollJob"
```

---

## Task 7: Check-now control + wire into the app page

**Files:**
- Modify: `packages/web/src/components/CheckNowButton.tsx`, `packages/web/src/app/(app)/apps/[id]/page.tsx`
- Test: `packages/web/test/checkNowButton.test.tsx`

**Interfaces:**
- Consumes: `requestCheck`/`pollJob` (Task 6), `latestJob` (Task 5).
- Produces: `CheckNowButton({ appId, hasPreview, initialStatus })` — client control with a production/preview choice (preview only when `hasPreview`), enqueues via `requestCheck`, polls while active.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/checkNowButton.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../src/app/(app)/apps/[id]/check-now-actions.js', () => ({
  requestCheck: vi.fn(async () => ({ ok: true, jobId: 'j1' })),
  pollJob: vi.fn(async () => ({ id: 'j1', status: 'done', environment: 'production' })),
}));
import { CheckNowButton } from '../src/components/CheckNowButton.js';

describe('CheckNowButton', () => {
  it('renders an enabled Check now button (no longer "soon")', () => {
    render(<CheckNowButton appId="a1" hasPreview={false} initialStatus={null} />);
    const btn = screen.getByRole('button', { name: /check now/i });
    expect(btn.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(/soon/i)).toBeNull();
  });
  it('offers a preview target only when the app has a preview URL', () => {
    const { rerender } = render(<CheckNowButton appId="a1" hasPreview={false} initialStatus={null} />);
    expect(screen.queryByText(/preview/i)).toBeNull();
    rerender(<CheckNowButton appId="a1" hasPreview initialStatus={null} />);
    expect(screen.getByText(/preview/i)).toBeTruthy();
  });
  it('shows a running state when a job is already active on load', () => {
    render(<CheckNowButton appId="a1" hasPreview={false} initialStatus="running" />);
    expect(screen.getByText(/checking/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test checkNowButton`
Expected: FAIL — current `CheckNowButton` is the disabled stub (no props, shows "soon").

- [ ] **Step 3: Implement the live control**

Replace `packages/web/src/components/CheckNowButton.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestCheck, pollJob } from '../app/(app)/apps/[id]/check-now-actions.js';

type Status = 'queued' | 'running' | 'done' | 'failed' | null;

export function CheckNowButton({ appId, hasPreview, initialStatus }: { appId: string; hasPreview: boolean; initialStatus: Status }) {
  const router = useRouter();
  const [env, setEnv] = useState<'production' | 'preview'>('production');
  const active = initialStatus === 'queued' || initialStatus === 'running';
  const [busy, setBusy] = useState(active);
  const [message, setMessage] = useState<string | null>(null);

  async function start() {
    setBusy(true); setMessage(null);
    const res = await requestCheck(appId, env);
    if (!res.ok) { setBusy(false); setMessage(res.reason === 'busy' ? 'A check is already running.' : 'Could not start the check.'); return; }
    const poll = setInterval(async () => {
      const job = await pollJob(appId);
      if (!job || job.status === 'done' || job.status === 'failed') {
        clearInterval(poll); setBusy(false);
        setMessage(job?.status === 'failed' ? 'The check ran into a problem.' : null);
        router.refresh();
      }
    }, 3000);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {hasPreview && (
          <select value={env} onChange={(e) => setEnv(e.target.value as 'production' | 'preview')} disabled={busy}
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm">
            <option value="production">Production</option>
            <option value="preview">Preview</option>
          </select>
        )}
        <button type="button" onClick={start} disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-hover disabled:opacity-60">
          <i className="ti ti-player-play" aria-hidden="true" />
          {busy ? 'Checking…' : 'Check now'}
        </button>
      </div>
      {message && <span className="text-xs text-ink-faint">{message}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Wire into the app page**

In `packages/web/src/app/(app)/apps/[id]/page.tsx`: fetch the app's preview URL + latest job, and pass them to the control. The page already calls `getAppReport(id)`. Add `latestJob` import and a preview-URL read, then render the control with props. Replace the `<CheckNowButton />` usage with:

```tsx
import { getAppReport, latestJob } from '../../../../lib/data.js';
import { createClient } from '../../../../lib/supabase/server.js';
```

Inside the component, after `const report = await getAppReport(id);` and the `notFound()` guard:

```tsx
  const job = await latestJob(id);
  const sb = await createClient();
  const { data: appRow } = await sb.from('apps').select('preview_url').eq('id', id).maybeSingle();
  const hasPreview = !!appRow?.preview_url;
```

Then change the header's control:

```tsx
        <CheckNowButton appId={report.app.id} hasPreview={hasPreview} initialStatus={job?.status ?? null} />
```

- [ ] **Step 5: Run tests + typecheck + build**

Run: `pnpm --filter @vigil/web test && pnpm --filter @vigil/web typecheck && pnpm --filter @vigil/web build`
Expected: all web tests PASS (RLS skips offline); typecheck clean; `next build` succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/CheckNowButton.tsx "packages/web/src/app/(app)/apps/[id]/page.tsx" packages/web/test/checkNowButton.test.tsx
git commit -m "feat(web): live Check-now control (prod/preview target + polling) on the app page"
```

---

## Self-Review

**Spec coverage:**
- §2 placement (app page only) → Task 7 (control on `/apps/[id]`; Overview untouched). Precondition first-run/re-test + skip-check-when-no-flows → Task 3. Full test (check+sweep) → Task 3. Prod/preview target → Tasks 2 (sweep), 3 (runAppFull), 6 (requestCheck), 7 (UI). Results via existing report → Task 7 (router.refresh).
- §4.1 jobs table (engine migration, no auth) → Task 1. §4.2 RLS (web supabase) → Task 5.
- §5.1 runAppFull → Task 3. §5.2 jobsRepo → Task 1. §5.3 worker → Task 4. §5.4 requestCheck → Task 6. §5.5 latestJob + polling control → Tasks 5 & 7.
- §6 dedupe → Tasks 1 (hasActiveJob) + 6; lifecycle → Task 1; no-flows → Task 3; no-preview → Task 6; worker-crash tolerated (no reaper) → noted non-goal.
- §9 tests: jobsRepo (Task 1), worker (Task 4), runAppFull (Task 3), cmdSweep target (Task 2), web enqueue (Task 6), control states (Task 7), live jobs RLS (Task 5).

**Placeholder scan:** none — every step has concrete code/SQL/commands. The `getAppById`/`APP_COLS` note in Task 4 instructs mirroring an existing function exactly (the file's real names) rather than inventing.

**Type consistency:** `JobEnvironment`/`JobStatus`/`JobRecord` (Task 1) reused by worker (Task 4) and latestJob (Task 5). `runAppFull(appName, environment, deps)` (Task 3) called by `cmdNightly` (Task 3) and `cmdWorker` (Task 4). `WorkerDeps.run(appId, environment)` (Task 4) ← `runAppFull(app.name, environment)`. `CheckRequestResult`/`createCheckJob` (Task 6) consumed by `requestCheck` (Task 6) and `CheckNowButton` (Task 7). `latestJob` return shape (Task 5) → `CheckNowButton initialStatus` (Task 7). `cmdSweep` `environment` option (Task 2) used by `runAppFull`'s default sweep (Task 3).

**Cross-cutting:** jobs RLS appended to the existing `001_web_rls.sql` (the `db:rls` script applies that single file); the live RLS test + db:rls require a Supabase `DATABASE_URL` and self-skip offline — the controller runs them live, as with the prior RLS work.
