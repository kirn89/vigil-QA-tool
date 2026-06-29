# Vigil — Jobs Queue + Worker + Check-now (Design)

**Date:** 2026-06-29
**Status:** Approved for planning
**Scope:** Phase 2, sub-project 2.2a (the async web→engine bridge, proven on Check-now). Sub-project 2.2b (self-serve onboarding + invite gating) is a separate spec.

## 1. Goal

Give the dashboard a working **Check now** button: an on-demand, full re-test (deep flows + breadth sweep) of an app, run by a **worker** that the web app dispatches to via a **jobs queue** in Supabase Postgres. The web (Vercel serverless) can't run headless Chromium, so it enqueues a job; the worker claims and runs it through the existing engine. This builds the shared async bridge that onboarding (2.2b) will also use.

## 2. Key decisions (settled in brainstorming)

- **Every run is a full test:** Check-now runs **confirmed flows (check) + breadth sweep**, identical to the nightly per-app run. A single shared `runAppFull(appName)` backs both.
- **Production only** for this slice (preview-URL toggle deferred).
- **Nightly stays a direct cron** (`vigil nightly`), not routed through the queue — it just shares `runAppFull`. The queue is for on-demand runs only, for now.
- **Progress via polling**, not Supabase Realtime — simpler and robust at pilot scale.
- **Worker runs locally** during the gated pilot (`pnpm vigil worker`); it moves to the VPS later (reusing the existing `deploy/` Docker setup). No VPS required to build/test this slice.
- One worker, one job at a time (pilot-scale concurrency).

## 3. Architecture

```
[web: CheckNowButton] --server action: enqueue--> [jobs table (Supabase)] <--claim-- [worker: vigil worker]
        |                                              ^  FOR UPDATE SKIP LOCKED          |
        └------------ poll job status -----------------┘                       runAppFull = check + sweep
                                                                    writes runs + sweep_findings, marks job done/failed
```

## 4. Data model

### 4.1 `jobs` table — engine migration `004_jobs.sql`
A plain table with no auth references (so it applies in the engine's embedded-Postgres tests AND Supabase, exactly like `journey_candidates`). Created by `vigil migrate`.

| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| app_id | uuid not null references apps(id) on delete cascade | |
| type | text not null check (type in ('check_now')) | extensible later (e.g. 'onboard_map') |
| status | text not null default 'queued' check (status in ('queued','running','done','failed')) | |
| error | text | failure message when status='failed' |
| requested_by | uuid | the auth user id who requested it (audit; nullable) |
| requested_at | timestamptz not null default now() | |
| started_at | timestamptz | set when claimed |
| finished_at | timestamptz | set when done/failed |

Index: `create index jobs_claim_idx on jobs (status, requested_at)` for the poll/claim query.

### 4.2 RLS for `jobs` — `packages/web/supabase` (Supabase-only)
Enable RLS; policies for role `authenticated`:
- **SELECT:** `using (app_id in (select a.id from apps a join users u on u.id = a.user_id where u.auth_id = auth.uid()))` — a user sees jobs for their own apps.
- **INSERT:** `with check ( type = 'check_now' and app_id in (<same owned-apps subquery>) )` — a user can only enqueue check_now jobs for their own apps.
- No UPDATE/DELETE policies. The worker uses the **service role** (bypasses RLS) to claim/update jobs.

## 5. Components

### 5.1 Shared run — `runAppFull(appName)` (engine, `src/cli.ts` or a small module)
Extract the per-app body of `cmdNightly` (check + sweep for one app) into `runAppFull(appName: string): Promise<void>`. `cmdNightly` calls it per app (behavior unchanged); the worker calls it per job. This guarantees nightly and Check-now run the identical full test.

### 5.2 Jobs repo — `src/db/jobsRepo.ts` (engine)
- `enqueueJob(appId, type, requestedBy?)` — used in tests/CLI (the web enqueues via its own client; see 5.4).
- `claimNextJob(): Promise<JobRecord | null>` — `update jobs set status='running', started_at=now() where id = (select id from jobs where status='queued' order by requested_at for update skip locked limit 1) returning *`. Atomic claim.
- `finishJob(id, ok, error?)` — sets status done/failed + finished_at.
- `hasActiveJob(appId): Promise<boolean>` — true if a queued/running job exists for the app (dedupe).

### 5.3 Worker — `vigil worker` (engine)
Loop: `claimNextJob()`; if none, sleep (poll interval, default 5s) and repeat; if claimed, run `runAppFull(app.name)` for the job's app, then `finishJob(done)`; on throw, `finishJob(failed, message)`. Graceful shutdown on SIGINT/SIGTERM (finish the current job's status, then exit). Injectable run fn + clock for testing.

### 5.4 Web enqueue — server action `requestCheck(appId)`
In `packages/web`: a server action that (1) confirms the app belongs to the signed-in user via an RLS-scoped read, (2) checks no active job exists for it (dedupe), (3) inserts a `check_now` job under the user's session (INSERT RLS policy enforces ownership). Returns `{ jobId }` or a dedupe/error result.

### 5.5 Web progress — polling + `CheckNowButton`
- `latestJob(appId)` in `src/lib/data.ts` — the app's most recent job (status + timestamps), RLS-scoped.
- `CheckNowButton` becomes a client component: idle → on click calls `requestCheck`, then **polls** `latestJob` (via a server action or route handler) every ~3s while `queued`/`running`, showing a calm progress state; on `done` → `router.refresh()` (new verdicts/findings appear) + a success toast; on `failed` → calm error. If a job is already active on load, it renders the running state.
- The App report header renders the current state from `latestJob` on the server, so a refresh mid-run shows "checking…".

## 6. Behavior & edge cases
- **Dedupe:** clicking Check-now while a job is queued/running does not enqueue another; the button reflects the active job.
- **Status lifecycle:** queued → running → done | failed. `started_at`/`finished_at` set at transitions.
- **Worker crash mid-job:** a job stuck in `running` is acceptable for pilot (manual reset); a stale-running reaper is deferred (noted non-goal).
- **No apps / no confirmed flows:** `runAppFull` handles an app with no confirmed flows by running the sweep only (the engine's `cmdCheck` throws on zero flows today — `runAppFull` must catch/skip the check when there are no confirmed flows so the sweep still runs and the job succeeds).

## 7. Integration with existing code
- Reuses `cmdCheck` + `cmdSweep` (via `runAppFull`); writes to the existing `runs` + `sweep_findings`; results surface through the **existing 2.1 report** with no new result UI.
- Lights up the **disabled `CheckNowButton`** shipped in the UI redesign.
- No change to engine verdict/sweep logic.

## 8. Build approach
- Engine: `004_jobs.sql`, `jobsRepo.ts`, `runAppFull`, `vigil worker` command — all TDD against embedded Postgres (the jobs table needs no auth, so tests run offline; the engine-test global setup already pins the embedded DB).
- Web: `requestCheck` server action, `latestJob`, client `CheckNowButton` with polling; jobs RLS in `packages/web/supabase` applied via `pnpm --filter @vigil/web db:rls`.
- Worker run: `pnpm vigil worker` locally during the pilot.

## 9. Testing
- **jobsRepo:** `claimNextJob` claims exactly one and skips it for a concurrent claimer (FOR UPDATE SKIP LOCKED); `hasActiveJob` dedupe; `finishJob` transitions. Embedded-PG.
- **worker:** with a fake `runAppFull`, a queued job → `done`; a throwing run → `failed` with the message; empty queue → no-op sleep. Injected run fn + single-iteration mode.
- **runAppFull:** extracted correctly — `cmdNightly` still checks+sweeps every app (existing nightly test stays green); `runAppFull` skips check (not error) when an app has no confirmed flows but still sweeps.
- **web enqueue:** `requestCheck` rejects a non-owned app, dedupes an active job, inserts otherwise (unit with a fake/seam).
- **CheckNowButton:** idle/running/done/failed render states; polling stops on terminal status.
- **RLS (live, Supabase):** a user can SELECT/INSERT jobs only for their own apps, never another user's (mirrors the existing RLS isolation test).

## 10. Non-goals / deferred
- Preview-URL target toggle; routing nightly through the queue; multi-worker/concurrent jobs; Supabase Realtime; a stale-`running` reaper; onboarding + invite gating (2.2b); other job types; per-app scheduling. VPS deployment of the worker (runs locally for the pilot; productionized later via `deploy/`).
