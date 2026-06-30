# Vigil — Jobs Queue + Worker + Check-now (Design)

**Date:** 2026-06-29
**Status:** Approved for planning
**Scope:** Phase 2, sub-project 2.2a — the async web→engine bridge, delivered as the complete **Check-now** feature. Self-serve onboarding + invite-gated account creation is the next build increment (2.2b), a separate spec.

**Note on "pilot":** the pilot means our *first customers under invite-only access* — they receive the **complete tool**, not a reduced one. Everything below ships as the full feature. Where this spec says a piece comes in a "later increment," that is **build order only** — the capability is part of the product, just implemented in a following chunk; nothing is cut from what a customer gets.

## 1. Goal

Make **Check-now** a working, complete feature: from an app's own page, the customer triggers an on-demand **full test** — deep flows (check) + breadth sweep — against **production or their preview URL**, run by a **worker** the web app dispatches to via a **jobs queue** in Supabase. The web (Vercel serverless) can't run headless Chromium, so it enqueues a job; the worker claims and runs it through the existing engine. This is the shared async bridge that onboarding (2.2b) will also use.

## 2. Behavior (the complete feature)

- **Placement:** Check-now lives **only on the individual app page** (`/apps/[id]`), alongside the report. The Overview (`/`) stays a pure overview — no Check-now there.
- **Precondition:** Check-now operates on an **already-mapped app** (one that has confirmed flows / has been set up). It covers both the **first-ever run** of a freshly-mapped app and a **re-test** of an app checked before. (Mapping a brand-new app is onboarding — 2.2b.)
- **What it runs:** the **full test** — confirmed flows (check) **and** breadth sweep — identical to the nightly per-app run. One shared `runAppFull(appName, environment)` backs both Check-now and nightly so they never diverge.
- **Target:** the customer picks **production** or **preview** for the run. Production is always available; **preview is offered only when the app has a preview URL set**. Both the check and the sweep run against the chosen target.
- **Result:** verdicts + sweep findings are written to the existing tables and surface through the **existing report UI** (no new result surface). The run's `environment` is recorded on each run.

## 3. Architecture

```
[app page: Check-now] --server action: enqueue (target)--> [jobs table (Supabase)] <--claim-- [worker: vigil worker]
        |                                                       ^  FOR UPDATE SKIP LOCKED          |
        └------------------ poll job status --------------------┘                  runAppFull(app, environment)
                                                                          = check + sweep, writes runs + findings,
                                                                          marks job done/failed
```

The worker runs **locally during the invite-only pilot** and moves to the VPS later (reusing `deploy/`). This is purely where the engine process lives — it does not change the customer-facing feature. (The VPS was deliberately sequenced last.)

## 4. Data model

### 4.1 `jobs` table — engine migration `004_jobs.sql`
A plain table, no auth references (so it applies in the engine's embedded-Postgres tests AND Supabase, like `journey_candidates`). Created by `vigil migrate`.

| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| app_id | uuid not null references apps(id) on delete cascade | |
| type | text not null check (type in ('check_now')) | extensible (e.g. 'onboard_map' in 2.2b) |
| environment | text not null default 'production' check (environment in ('production','preview')) | the run target |
| status | text not null default 'queued' check (status in ('queued','running','done','failed')) | |
| error | text | message when failed |
| requested_by | uuid | auth user id who requested (audit; nullable) |
| requested_at | timestamptz not null default now() | |
| started_at | timestamptz | set when claimed |
| finished_at | timestamptz | set when done/failed |

Index: `create index jobs_claim_idx on jobs (status, requested_at)`.

### 4.2 RLS for `jobs` — `packages/web/supabase` (Supabase-only)
Enable RLS; policies for role `authenticated`:
- **SELECT:** `using (app_id in (select a.id from apps a join users u on u.id = a.user_id where u.auth_id = auth.uid()))`.
- **INSERT:** `with check ( type = 'check_now' and app_id in (<same owned-apps subquery>) )`.
- No UPDATE/DELETE policies — the worker uses the **service role** (bypasses RLS) to claim/update.

## 5. Components

### 5.1 Shared run — `runAppFull(appName, environment)` (engine)
Extract the per-app body of `cmdNightly` (check + sweep for one app) into `runAppFull(appName: string, environment: 'production' | 'preview' = 'production'): Promise<void>`:
- Runs `cmdCheck(appName, { preview: environment === 'preview' })` — but **skips the check (does not throw) when the app has no confirmed flows yet**, so a freshly-mapped-but-never-checked app still completes (today `cmdCheck` throws on zero flows; `runAppFull` guards this).
- Runs the sweep against the chosen target: `cmdSweep` gains an `environment`/target so it crawls the preview URL when `environment === 'preview'` (today it always uses `productionUrl`).
- `cmdNightly` calls `runAppFull(app.name, 'production')` per app (behavior unchanged); the worker calls it with the job's environment.

### 5.2 Jobs repo — `src/db/jobsRepo.ts` (engine)
- `claimNextJob(): Promise<JobRecord | null>` — `update jobs set status='running', started_at=now() where id = (select id from jobs where status='queued' order by requested_at for update skip locked limit 1) returning *` (atomic claim).
- `finishJob(id, ok, error?)` — sets done/failed + finished_at.
- `hasActiveJob(appId)` — a queued/running job exists for the app (dedupe).
- `enqueueJob(appId, type, environment, requestedBy?)` — for tests/CLI (the web enqueues via its own Supabase client; see 5.4).

### 5.3 Worker — `vigil worker` (engine)
Loop: `claimNextJob()`; none → sleep (poll interval, default 5s) → repeat; claimed → `runAppFull(app.name, job.environment)` → `finishJob(done)`; on throw → `finishJob(failed, message)`. One job at a time. Graceful SIGINT/SIGTERM. Injectable run fn + single-iteration mode for tests.

### 5.4 Web enqueue — server action `requestCheck(appId, environment)`
In `packages/web`: (1) confirm the app belongs to the signed-in user (RLS-scoped read); (2) if `environment === 'preview'`, confirm the app has a preview URL; (3) dedupe (no active job for the app); (4) insert a `check_now` job with the chosen environment under the user's session (INSERT RLS enforces ownership). Returns `{ jobId }` or a dedupe/validation result.

### 5.5 Web control + progress — on the app page
- `latestJob(appId)` in `src/lib/data.ts` — the app's most recent job (status/environment/timestamps), RLS-scoped.
- The Check-now control (client component on `/apps/[id]`): a target choice (production / preview — preview shown only when the app has a preview URL) + the run button. On click → `requestCheck`, then **poll** `latestJob` every ~3s while `queued`/`running` showing a calm progress state; on `done` → `router.refresh()` (fresh verdicts/findings appear) + success toast; on `failed` → calm error. If a job is already active on load, render the running state.

## 6. Behavior & edge cases
- **Dedupe:** clicking while a job is queued/running does not enqueue another (best-effort check-then-insert; a rapid double-click race is acceptable at current scale — no unique-index enforcement).
- **Status lifecycle:** queued → running → done | failed, with timestamps at transitions.
- **No confirmed flows yet:** `runAppFull` runs the sweep and skips (does not fail) the check, so the job succeeds.
- **No preview URL:** preview target is not offered in the UI and `requestCheck` rejects a preview request.
- **Worker crash mid-job:** a job stuck in `running` is tolerable for now (manual reset); an automatic stale-`running` reaper is a later increment.

## 7. Integration with existing code
- Reuses `cmdCheck` + `cmdSweep` via `runAppFull`; writes to existing `runs` + `sweep_findings`; results surface through the existing 2.1 report — no new result UI.
- Lights up the `CheckNowButton` already placed on the app page (replacing its disabled "soon" state with the live control).
- No change to engine verdict/sweep logic beyond `cmdSweep` accepting a target environment.

## 8. Build approach
- Engine (TDD against embedded Postgres — jobs table needs no auth; the engine-test global setup pins the embedded DB): `004_jobs.sql`, `jobsRepo.ts`, `cmdSweep` target option, `runAppFull`, `vigil worker`.
- Web: `requestCheck` server action, `latestJob`, the client Check-now control with target choice + polling; jobs RLS in `packages/web/supabase` applied via `pnpm --filter @vigil/web db:rls`.
- Worker run: `pnpm vigil worker` (locally for now).

## 9. Testing
- **jobsRepo:** `claimNextJob` claims exactly one and skips it for a concurrent claimer (FOR UPDATE SKIP LOCKED); `hasActiveJob` dedupe; `finishJob` transitions; environment persisted.
- **worker:** fake `runAppFull` → queued job becomes `done`; throwing run → `failed` with message; empty queue → sleep no-op; job's environment passed through.
- **runAppFull:** nightly still checks+sweeps every app (existing nightly test green); skips (not errors) the check when no confirmed flows but still sweeps; sweeps the preview URL when environment='preview'.
- **cmdSweep target:** sweeps the preview URL when asked, production otherwise.
- **web enqueue:** `requestCheck` rejects non-owned apps, rejects preview without a preview URL, dedupes an active job, inserts otherwise.
- **Check-now control:** target choice (preview hidden without a preview URL); idle/running/done/failed states; polling stops on terminal status.
- **RLS (live, Supabase):** a user can SELECT/INSERT jobs only for their own apps (mirrors the existing RLS isolation test).

## 10. Build order (later increments — NOT product cuts)
These are sequenced for safe delivery; each is part of the complete product and lands in a following chunk:
- Self-serve onboarding (Connect → map → review journeys) + invite-gated account creation — **2.2b**.
- Productionizing the worker on the VPS (it runs locally until then) — infra, sequenced last by choice.
- Billing — **2.3** (commercial layer; the tool itself is complete without it during the free invite pilot).
- Notifications (Resend pings/digest) — **2.4**.

Genuinely out of scope (engineering choices, not features): routing nightly through the queue (it stays a direct cron sharing `runAppFull`); multi-worker concurrency; Supabase Realtime (polling is the chosen, complete implementation); an automatic stale-`running` reaper.
