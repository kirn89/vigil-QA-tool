# Vigil — Design Doc (MVP)

**Date:** 2026-06-11
**Status:** Draft for founder review
**Working codename:** Vigil (final branding is explicitly out of scope for MVP; the codename unblocks development)

## 1. One-liner

Connect your app's URL. Every night — and any time you hit "Check now" after a change — an AI walks through your app like a real user and tells you in plain English what broke, with a ready-to-paste fix prompt for your builder (Lovable, Bolt, Cursor, Replit).

## 2. Who it's for and why they pay

**Buyer:** non-technical and semi-technical founders running live apps built with AI app builders. They edit production directly, have no staging environment, no CI, no tests, and cannot read stack traces. Their #1 documented pain is the "fix-and-break" cycle: every change risks silently breaking something else, and they find out from users.

**The job we're hired for:** replace the QA function entirely — not a tool they operate, a service that operates itself. The emotional product is permission to iterate without fear.

**Positioning:** "We replace QA" (the kid who mows your lawn), not "a QA tool" (a lawnmower). Existing QA products (testRigor, Reflect, Sofy, BugBug) assume a QA-literate operator, CI, test authoring/maintenance, and enterprise budgets. We assume none of those.

**Pricing:** one plan. $49/mo list, $29/mo founding-member price locked forever for the first 10 customers. 14-day free trial, card required. ~2,000 customers at this price ≈ $1M ARR; MVP goal is 10.

## 3. Goals and non-goals

**MVP goals:**

1. Reliably map and watch the founder's two live apps (customer zero).
2. Catch a real, unplanted regression in one of those apps.
3. Get 10 paying outside customers via community DMs/cold outreach.
4. Keep COGS under ~$3/customer/month.

**Explicit non-goals (v2 candidates, not v1):** GitHub/CI integration, pixel-level visual regression, mobile/cross-browser matrices, team seats, security scanning, API access, testing through real payment charges (we verify checkout up to the payment page only), SOC2/enterprise anything, native integrations with builders beyond fix-prompt text.

**Permanent non-goals (not v2 either, by design):**

- **Localhost / IDE dev servers.** The runner only tests URLs reachable over the internet. Builder previews (Lovable/V0/Bolt previews, Vercel/Netlify deploy previews) are hosted URLs and ARE supported — the pre-production workflow is "Check now against your preview, then publish." Tunneling into laptops or shipping a local CLI agent would break the zero-config promise and serve a different (more technical) buyer.
- **Subjective UX critique** (confusing copy, design quality, layout taste). Unfalsifiable judgments generate false-alarm noise, and trust is the product. A separate one-off "UX review" report is a possible future product; it never enters the watch loop.
- **Deep business-logic auditing** we can't observe in the UI. We verify stated expectations ("the total should read $108") but never claim to validate internal calculations.

### 3.1 Coverage model: depth × breadth

Vigil's claim to "comprehensive" QA is two lanes, mirroring real QA practice (deep on what matters, shallow sweep over everything else):

| Lane | Coverage | Mechanism | Cost profile |
|---|---|---|---|
| **Flow watching** (deep, narrow) | Up to ~8 critical journeys per app: auto-discovered + user-described in plain English | Golden-path replay, LLM on deviation | LLM only on deviation |
| **Site sweep** (shallow, broad) | Every reachable page, logged out and logged in | Crawler: dead links/404s, JS console errors, failed API calls, broken images, blank/error/unstyled pages, large load-time regressions | No LLM, near-free |

The sweep is what covers "the rest of the app" outside mapped flows: it catches everything *objectively* broken anywhere, without judging anything subjective.

### 3.2 Scope doctrine: primitives, not apps

There are millions of distinct apps; Vigil never scopes against apps. It scopes against the **action vocabulary** of golden paths (navigate, click, fill, select, upload, assert-text, assert-url). Every web app is a sentence written in this small alphabet, and the browser normalizes everything to DOM. Consequences:

- **Coverage grows by primitives, not integrations.** Each new action kind unlocks a class of apps, not one app. The decision rule for any unsupported need: *is it a primitive (reusable across thousands of apps) or app-specific semantics?* Primitives are queued by demand frequency; app semantics get a polite no.
- **Novelty is absorbed at map time, not product time.** The MAP agent reads whatever app is in front of it; replay is app-agnostic. Unknown apps are a per-app one-time cost, never a per-product scoping problem.
- **Three rings:** (1) supported now — anything expressible in the vocabulary against a reachable URL with a password-login test account; (2) supported on repeated demand — new primitives, test-inbox for magic-link/OTP auth, iframe handling; (3) permanently out — apps that actively resist automation (captcha/bot-walls: a values conflict, not an engineering gap), output-quality judgment, live multi-user simulation (standing fixture state covers the need — e.g. a pre-connected pair of sealed test accounts for two-sided features).
- **Refuse at onboarding, before money.** When an app needs ring-3 (or not-yet-built ring-2) capabilities, detection happens at connect/map time and Vigil says "can't watch this yet." Losing one exotic customer is cheap; a false promise costs trust, which is the product. The market's homogeneity (a handful of builders generating the same UI patterns on the same stacks) means the boring majority is far more than the ~2,000 customers $1M ARR requires.

**Multi-user and stateful apps (dogfooding-derived patterns):** two-sided features are tested with **sealed test pairs** — two standing test accounts that interact only with each other (ideally flagged `is_test` and hidden from real users); cross-user state (an accepted connection) is set up once as fixture state, then single-session flows exercise it nightly. Repeatable funnels (signup/onboarding) use `{{unique}}` synthetic accounts with an app-side purge. AI-output apps are asserted **structurally** (the draft container rendered, the download button appeared), never on content quality.

## 4. Product walkthrough

### 4.1 Connect (~2 minutes, zero code)

User signs up, pastes their app's **production URL**, optionally adds a **preview URL** (Lovable/V0/Bolt preview, Vercel/Netlify deploy preview), optionally provides a **test account** (email + password for a dummy login), and answers one question: "What's the one thing a user must always be able to do in your app?" We instruct users to provide throwaway test credentials, never real user accounts.

Environments: production is watched nightly; the preview URL is an on-demand target for pre-publish checks. Golden paths are recorded once and replay against either environment (same app, same flows).

### 4.2 Map

A browser agent explores the app (logged out and, if credentials were given, logged in) and proposes a flow map of up to 6 critical journeys, e.g. signup, login, create-a-thing, search, contact form. The user confirms via checkboxes and can edit flow names. The confirmation step converts discovery mistakes from embarrassing to harmless.

For each confirmed flow, the mapper records a **golden path**: the ordered steps (navigate, click, fill, assert) with selectors, sample inputs, and expected outcomes, plus a screenshot per step.

**Custom flows:** the user can also describe additional flows in plain English ("check that a user can export their report as a PDF — the download should contain the report title"). The mapper attempts to record a golden path from the description; if it can't complete the journey, it asks the user to clarify rather than guessing. Stated expectations become assertions. Cap: ~8 flows per app total in MVP.

### 4.3 Watch

- **Nightly:** every confirmed flow runs once per night against production (staggered, per-app), plus the site sweep.
- **"I just changed something" button:** runs all flows on demand against production **or the preview URL** (user picks; preview is the pre-publish workflow), verdict in ~5 minutes. This button is the heart of the product.

### 4.3.1 Site sweep

A crawler (no LLM) visits every reachable page — logged out and, with test credentials, logged in — and flags objective breakage outside mapped flows: dead links/404s, JavaScript console errors, failed API/network calls, broken images, blank or unstyled or error pages, and pages whose load time regressed dramatically (>3x their trailing median). Sweep findings appear in the same plain-English report, in a separate "rest of your app" section, and follow the same anti-noise rules (state-change alerts only). The sweep respects the same run-hygiene rules as flows (§6) and never clicks destructive-looking controls.

### 4.4 Verdict

Three states per flow — never binary:

- ✅ **PASS** — flow completed, expected outcome verified.
- ❌ **BROKEN** — flow failed the same way across retries with clear evidence.
- ⚠️ **UNSURE** — agent couldn't complete the flow but can't blame the app ("might be me, not you"). UNSURE never uses alarm language and never counts as a breakage in stats.

Report language is plain English with evidence: "Login broke: after entering credentials, users land on a blank page instead of the dashboard. This started after your check today at 4:12pm." Each verdict links to step-by-step screenshots.

**Surface hierarchy: dashboard-first.** All reports, verdict history, screenshots, fix prompts, and live Check-now progress live in the web app — the dashboard is the product surface. Email is not a report; it is a short push ping for the unattended lane only: state-change alerts ("login broke — see dashboard") and the weekly all-quiet digest. Both are optional and configurable in settings; the dashboard is always complete on its own.

### 4.5 Fix prompt

Every BROKEN verdict ships with a paste-ready prompt targeted at the user's declared builder, e.g.:

> "The login redirect is sending users to a blank page instead of /dashboard. Restore the post-login redirect without changing the auth logic."

Fix prompts describe observed behavior and desired outcome; they never guess at code internals we haven't seen.

## 5. Architecture

Four components, deliberately boring:

```
[Next.js web app] ──> [Postgres (Supabase)] <──poll── [Runner (VPS worker)]
      │                      │                              │
   Stripe                 jobs table                  Playwright + LLM
      │                      │                              │
      └──────────────> [Resend email] <─────────────────────┘
```

1. **Web app** — Next.js on Vercel (free tier): landing page, auth, onboarding, dashboard, reports, Check-now button, Stripe billing portal.
2. **Database** — Supabase Postgres (free tier to start). Also serves as the job queue (`SELECT ... FOR UPDATE SKIP LOCKED`) — no Redis/queue infra in v1. Row Level Security on from day one (we of all products don't get to skip RLS).
3. **Runner** — a single small VPS (Hetzner CAX11, ~€4/mo) running a Node worker: polls the jobs table, executes runs with Playwright (Chromium), calls the LLM when needed, writes results back. Stateless besides the DB; can be rebuilt from a setup script.
4. **Notifications** — Resend (free tier) for transactional email. Email only in v1; no Slack/SMS.

**Auth:** Supabase magic-link auth (no passwords to manage).
**Payments:** Stripe Checkout + customer portal, single price, webhook updates a `subscriptions` row.

## 6. The run engine (the actual product)

The core cost/reliability insight: **deterministic replay first, LLM only on deviation.**

- **MAP mode (expensive, rare):** LLM-driven exploration to discover flows and record golden paths. Runs at onboarding and on explicit "re-map" only. Design in §6.1.
- **REPLAY mode (cheap, default):** nightly/on-demand runs execute the recorded golden path with plain Playwright — no LLM tokens at all when the app hasn't changed and steps pass.
- **HEAL mode (LLM on deviation):** when a replay step fails, a cheaper model (Haiku-class) looks at the page and decides: (a) the UI changed but the flow still works — update the golden path (self-healing, silent); (b) the flow is genuinely broken — produce evidence; or (c) can't tell — UNSURE.
- **DIAGNOSE mode:** on confirmed breakage, one Sonnet-class call writes the plain-English verdict and the fix prompt from the step trace + screenshots.
- **SWEEP mode (no LLM):** the nightly crawler (§4.3.1). Pure Playwright + heuristics (HTTP status, console listeners, image natural-size checks, a "page looks rendered" heuristic: stylesheet loaded + non-trivial visible text). Sweep findings that persist across two consecutive sweeps get a DIAGNOSE-style plain-English line; one-off blips are suppressed.

**Anti-false-alarm policy (trust is the product):**

- Every failure is retried twice with backoff before any user-facing verdict.
- Two consecutive UNSUREs on the same flow escalate to the founder (us) for manual review during MVP — the concierge backstop. We eat ambiguity; the customer never gets noise.
- Verdict emails are sent on state *changes* (something broke / something recovered) plus a weekly "all quiet, N runs passed" digest. No daily spam.

**Run hygiene:** every run tags requests with a `Vigil-Check` user agent; test inputs use clearly-marked synthetic data (e.g. `vigil-test+<id>@...`); destructive-looking actions (delete buttons, payments past the checkout page) are never executed in v1 — flows that require them stop at the boundary and assert the page state instead.

### 6.1 MAP design — the LLM mapper (Plan 1b)

This is what makes "scope all the critical flows" real, replacing hand-written golden paths. **It is the answer to the dogfooding finding that 3 hand-picked flows is not a product.**

- **Surface:** Claude API + tool use (`@anthropic-ai/sdk`), manual agentic loop, with Playwright running on our own runner (NOT Managed Agents — we host the browser compute). The loop runs until the model emits its proposals (`end_turn`).
- **Model:** `claude-sonnet-4-6` ($3/$15 per 1M) for exploration — strong enough to read an accessibility tree and reason about journeys, ⅓ the cost of Opus. (HEAL stays on `claude-haiku-4-5`; DIAGNOSE may use Sonnet.)
- **Tool surface given to Claude:** thin wrappers over Playwright — `navigate(path)`, `snapshot()` (returns the accessibility tree + key element refs, *not* raw HTML — far fewer tokens), `click(ref)`, `fill(ref,value)`, `select(ref,value)`, `read_state()` (url + visible headings). The agent explores logged-out and, with the test account, logged-in. Destructive-looking controls (§6 run hygiene, `isUnsafeHref` patterns) are withheld from the tool surface so the agent *cannot* fire them.
- **Output:** the agent proposes up to ~8 critical journeys as **`GoldenPath` objects validated by the existing `goldenPathSchema`** (structured output / strict tool). They are persisted with `status='proposed'`; the user confirms/edits before any become watched (§4.2 confirmation gate makes discovery mistakes harmless).
- **Cost control:** a step cap and a token `task_budget` per map run; selectors recorded as stable CSS so REPLAY needs zero further LLM calls. Estimated $0.20–$1.00 per app mapped (one-time at onboarding) — see §9.
- **The bet:** novelty is absorbed *once*, at map time, by the model reading whatever app is in front of it; deterministic REPLAY (app-agnostic) carries every nightly run after. Unknown apps become a per-app one-time cost, never a per-product scoping problem (§3.2).

### 6.2 Coverage gaps surfaced by dogfooding (2026-06-13) — Plan 1b/1c work

The first real run (settlenepal, scholarai) exposed three concrete breadth gaps, distinct from the "every flow is impossible" reframing (§3.2):

1. **Sweep starts from the marketing root even when logged in.** On single-page-app tools (e.g. scholarai `/app`), the marketing homepage links only to `/auth/*` + legal pages, so the crawl never reaches the product. **Fix:** when credentials exist, seed the crawl from the post-login landing URL captured during the login flow, not just the root. (Small, near-term.)
2. **Sweep is blind to in-page feature states.** A link-crawler covers linked *pages*; single-URL tools expose features as click-driven states (modals, wizards, the upload/question panel). These are covered by *flows* (depth), not the sweep (breadth) — so the answer is more **mapped flows from MAP**, plus optional LLM-assisted reachable-view enumeration later.
3. **Metered test accounts can't sustain nightly watching.** ScholarAI's free tier caps at 3 docs / 2 questions, so resource-consuming flows are "run-once to prove," not nightly. **Product requirement:** an "unmetered/elevated test account" story for usage-limited apps, surfaced at onboarding.

## 7. Data model (Postgres)

- `users` — auth identity, builder preference (Lovable/Bolt/Cursor/Replit/other).
- `apps` — production url, optional preview url, name, encrypted test credentials, status.
- `flows` — app_id, name, status (proposed/confirmed/paused), golden path JSON, version.
- `jobs` — type (map/run), app_id, state (queued/running/done/failed), priority (check-now > nightly).
- `runs` — job_id, flow_id, environment (production/preview), verdict (pass/broken/unsure), step trace JSON, screenshot refs, duration, tokens spent.
- `sweep_findings` — app_id, page url, kind (dead_link/console_error/failed_request/broken_image/unrendered/slow), first_seen, last_seen, status (open/resolved), evidence.
- `verdict_events` — state transitions that triggered notifications (audit of what we told the user and when).
- `subscriptions` — Stripe state mirror.

Screenshots go to Supabase Storage with 30-day retention.

## 8. Security and privacy

- Test credentials encrypted at rest (libsodium sealed box; key lives only on the runner and in the founder's password manager — never in the web app's environment).
- Onboarding copy explicitly instructs: dummy/test accounts only, never admin or real-user credentials.
- RLS on every table; the web app uses the anon key + RLS, the runner uses a scoped service role.
- We are a product that exists because vibe-coded apps leak secrets; getting this wrong is existential. A pre-launch pass with one of the existing vibe-security scanners on our own app is a required launch step (and a marketing anecdote).

## 9. Unit economics

Per-customer monthly COGS at 2 apps × 5 flows × 30 nightly runs + ~20 check-nows:

- MAP (auto-mapping, §6.1): one-time at onboarding (+ rare re-maps). Sonnet at $3/$15 per 1M; an exploration of ~8 flows over an accessibility-tree tool surface is estimated $0.20–$1.00 per app. Amortized to ~zero per month.
- Replay runs and site sweeps: $0 LLM (deterministic/heuristic), VPS amortized. Sweep adds crawl time, not tokens; cap at 200 pages/app per sweep.
- HEAL/DIAGNOSE calls: estimated $0.50–$2.00/month at Haiku/Sonnet pricing assuming ~10% of nightly runs deviate. **Actively building customers deviate far more often** (every intentional UI edit triggers HEAL on affected flows, ~$0.05–0.30 per post-change Check-now): budget $3–8/month for heavy users. Self-healing means a deviation is paid for once, not nightly.
- Infra: VPS €4/mo total (handles ~50 customers at nightly cadence before a second machine), Vercel/Supabase/Resend free tiers.

COGS ≈ $1–3 vs $29–49 price → 90%+ gross margin. Verify real token costs against the claude-api reference during implementation, not from memory.

## 10. Risks and mitigations

1. **Agent flakiness / false alarms** (top product risk) → replay-first architecture, retries, three-state verdicts, concierge escalation. Reliability is the core competence we're selling; we own it, customers never debug it.
2. **Platform absorption** (Lovable builds this natively) → cross-platform by design (any URL, any builder); speed to 10 customers; the fix-prompt layer works even better as builders multiply.
3. **Copycats** (the insight isn't secret) → speed, founder-market-fit distribution (the founder is the customer), and accumulated golden-path/self-healing know-how as the moat. Accept this is a thin moat in month one.
4. **Apps that resist agents** (captchas, 2FA, SSO-only logins) → out of scope politely at onboarding: we detect and say "can't watch this yet" before taking money.
5. **One VPS is a SPOF** → acceptable at MVP scale; a dead runner delays nightly checks, it doesn't corrupt them. Health-check cron + rebuild script.
6. **Demand risk** → validation sprint runs in parallel with the build (Week 2–3); 10 paying customers or we stop and re-read the market.

## 11. Build sequence and success criteria

- **Week 1–2:** runner engine (map/replay/heal/diagnose) proven against the founder's two live apps. Exit criteria: golden paths recorded for both apps; a deliberately-introduced break is caught and correctly described; an intentional UI change self-heals silently.
- **Week 2–3:** web app, onboarding, Stripe, email. Landing page + DM scripts for validation outreach (founder pitches ~30 vibe coders).
- **Week 3+:** first 10 founding-member customers with concierge backstop.

**MVP success:** (a) catches one real unplanted regression on customer-zero apps; (b) 10 strangers paying. **Kill/pivot signal:** <10 paying after ~100 genuine pitches.

## 12. Testing strategy (for building Vigil itself)

- TDD throughout (superpowers workflow): engine logic, verdict state machine, job queue, billing webhooks all unit-tested; golden-path replay tested against fixture sites we control (a tiny deliberately-breakable demo app lives in the repo for this).
- The founder's two apps are the integration test bed — every engine change runs against them before deploy.
- We dogfood: Vigil watches Vigil's own dashboard with a synthetic account.
