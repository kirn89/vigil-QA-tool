# Vigil — Web Foundation + Read-Only Dashboard (Design)

**Date:** 2026-06-26
**Status:** Approved for planning
**Scope:** Phase 2, sub-project 1 of 4 (web foundation + read-only dashboard). Sub-projects 2 (onboarding + jobs queue + worker + Check-now), 3 (Stripe billing), and 4 (Resend notifications) are separate specs.

## 1. Goal

Stand up the customer-facing web surface and a **read-only dashboard** that renders what the engine already writes to Supabase: each user's apps, watched-flow verdicts (PASS/BROKEN/UNSURE) with history, per-step screenshots for failures, and confirmed sweep findings. This is the spec's "dashboard-first" surface (§4.4) and requires **zero engine code changes** beyond one additive migration — it only reads the existing data.

## 2. What this slice is NOT (deferred)

- No actions: no add-app, no Check-now, no flow-confirm/curation (→ sub-project 2).
- No fix-prompts — the DIAGNOSE LLM mode is unbuilt; there is no `fix_prompt` in the data. BROKEN evidence is the failed step + screenshots. (Fix-prompts arrive with DIAGNOSE, its own feature.)
- No billing (→ 3), no email/notifications (→ 4).
- No preview-URL toggle, no settings page, no marketing landing page (just a login entry).

## 3. Decisions (settled in brainstorming)

- **Stack:** Next.js (App Router) + TypeScript + Tailwind, deployed on **Vercel**. New workspace package `packages/web`.
- **Supabase is the whole backplane:** Auth (magic-link) + Postgres + Storage. The web app uses `@supabase/ssr`.
- **Access model — align identity + RLS.** RLS on from day one; the dashboard reads under the user's Supabase session, RLS enforcing per-user isolation.
- **Read-only Lean dashboard:** app list → per-app report (flow verdicts + history + step screenshots for BROKEN + confirmed sweep findings).
- **Fix-prompts deferred** (see §2).

## 4. Architecture

```
[Next.js web app on Vercel] --user session (RLS)--> [Supabase Postgres]
            |                                              ^
            |--service role (signed URLs)--> [Supabase Storage: Vigil_screenshots]
                                                           |
                          (unchanged) [engine / runner] --service role writes-->
```

- The web app **reads** the same Supabase DB the engine populates. The engine continues to **write** with the service role, which **bypasses RLS**, so engine behavior is unchanged.
- The web package imports **types only** from `@vigil/engine` (`Verdict`, `FlowAttempt`, `StepResult`, `FindingKind`) for type-safe rendering — no runtime coupling, no `pg` repo reuse.

## 5. Identity & RLS

### 5.1 Linking Supabase Auth to existing users
The engine creates `public.users` rows via `ensureUser(email)` with random UUIDs and `apps.user_id` references them. Supabase Auth issues a separate `auth.uid()`. We link them rather than re-key existing data:

- **Migration 004 adds** `users.auth_id uuid unique references auth.users(id)`.
- **Claim-by-email on first login:** in the auth callback, a server step (service role) runs
  `update public.users set auth_id = <auth.uid()> where lower(email) = lower(<login email>) and auth_id is null`.
  If no row matches (future self-serve signup), insert a new `public.users` row with that email and `auth_id`.
- This attaches concierge-created apps to the customer's identity without disturbing the engine's id scheme. `ensureUser(email)` is unchanged.

### 5.2 RLS policies (SELECT-only)
Enable RLS on `apps, flows, runs, sweeps, sweep_pages, sweep_findings, journey_candidates`. Each gets a SELECT policy for role `authenticated` scoped through the app→user→auth_id chain, e.g.:

- `apps`: `using (user_id in (select id from public.users where auth_id = auth.uid()))`
- `flows`, `sweeps`, `sweep_findings`, `journey_candidates` (have `app_id`): `using (app_id in (select a.id from apps a join public.users u on u.id = a.user_id where u.auth_id = auth.uid()))`
- `runs` (has `flow_id`): scope via `flow_id in (select f.id from flows f join apps a on a.id = f.app_id join public.users u on u.id = a.user_id where u.auth_id = auth.uid())`
- `sweep_pages` (has `sweep_id`): scope via its `sweep_id` → `sweeps` → app chain.
- `public.users`: SELECT policy `using (auth_id = auth.uid())`.

No INSERT/UPDATE/DELETE policies (dashboard is read-only). The **service role bypasses RLS**, so the engine and the claim-by-email step are unaffected.

### 5.3 Dogfooding note
The engine's `FOUNDER_EMAIL`/`VIGIL_USER_EMAIL` defaults to `founder@vigil.local` (not a real mailbox). To see the founder's existing scholarai/settlenepal apps in the dashboard, set `VIGIL_USER_EMAIL` to the real login email so claim-by-email can link them (or update the existing `users.email`).

## 6. Pages (App Router, server components)

- `/login` — magic-link request form (email → Supabase `signInWithOtp`).
- `/auth/callback` — exchanges the code for a session, runs claim-by-email, redirects to `/`.
- `/` — **app list**: the user's apps, each with a latest-status badge (worst current verdict across its flows, or "all clear"/"no runs yet").
- `/apps/[id]` — **per-app report**:
  - **Watched flows:** each confirmed flow with its latest verdict (✅ PASS / ❌ BROKEN / ⚠️ UNSURE) and recent run history (from `runs`).
  - **BROKEN detail:** failed step id + the per-step **screenshots** for that run (signed URLs parsed from `runs.attempts`).
  - **Rest of your app:** confirmed sweep findings (kind, page URL, evidence) — i.e. findings with `consecutive_count >= 2`.
  - Tone: calm and evidence-forward; UNSURE never uses alarm language and is visually distinct from BROKEN.
- **Middleware:** refreshes the Supabase session and redirects unauthenticated users to `/login`.

## 7. Data flow

A server component creates a Supabase SSR client bound to the user's session and queries `apps` / `flows` / `runs` / `sweep_findings` (RLS-scoped). "Latest verdict per flow" mirrors the engine's `latestVerdicts` query (`distinct on (flow) … order by created_at desc`). Screenshot locators (`Vigil_screenshots/<key>`) are extracted from the typed `runs.attempts` (`FlowAttempt[] → StepResult.screenshot`); a **service-role** client mints short-TTL **signed URLs** server-side. Locators that are local filesystem paths (dev runs) render a placeholder instead of a broken image.

## 8. Configuration

`packages/web/.env` (and Vercel env): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable, browser-safe), `SUPABASE_SERVICE_KEY` (server-only — signed URLs + claim-by-email), `SUPABASE_SCREENSHOT_BUCKET`. The service key is never exposed to the client.

## 9. Testing

- **RLS isolation (headline, security-critical):** seed two users A and B with apps/runs/findings; assert A's session reads only A's rows and never B's, across apps/flows/runs/sweep_findings. Run against Supabase (or a local Postgres with the same policies + a stubbed `auth.uid()`).
- **Claim-by-email:** first login links the pre-existing concierge `users` row by email; a second login is idempotent; an unknown email creates a fresh linked row.
- **Signed URLs:** locator → bucket key → signed URL (with a fake storage client); local-path locators yield a placeholder.
- **Report rendering:** given seeded verdicts/attempts/findings, the report page shows the right badges, the BROKEN failed-step + screenshots, and the sweep-findings section; UNSURE renders non-alarmist.
- Tooling: Vitest + React Testing Library for units/components; Playwright (already a repo dep) for an auth+report e2e if cheap.

## 10. Non-goals / boundaries (restated)

Read-only over existing data; one additive migration (004); no engine runtime changes; no write paths from the web; everything in §2 deferred to later sub-projects.
