# Vigil — Web UI Design (Direction A: Calm & Trustworthy)

**Date:** 2026-06-28
**Status:** Approved for planning
**Scope:** The full product UI vision for the Vigil web app (`packages/web`), **excluding billing** (piloting before launch). This is a design north-star covering every screen; it is **built incrementally** as the sub-project 2.2 (onboarding + jobs queue + worker + Check-now) and 2.4 (Resend notifications) backends land. The first implementation plan covers only the **buildable-now** slice (design system + read-only pages over existing data) — see §9 Phasing.

## 1. Goal

Replace the bare functional dashboard (Phase 2.1) with a cohesive, calm, trustworthy UI for non-technical founders, and define how every Phase-1 engine capability surfaces. The emotional product is *permission to iterate without fear* — the UI must reassure, use plain English, and never alarm (false alarms are the top product risk).

## 2. Design language (Direction A)

### 2.1 Color tokens (light mode; dark mode is a later concern)
Defined as CSS variables in a single tokens file consumed by Tailwind.

- **Surfaces:** page `#FAFAF8` (warm off-white), card/surface `#FFFFFF`, secondary surface `#F3F2EE`.
- **Borders:** default `rgba(20,20,16,0.08)` (0.5–1px), hover/emphasis `rgba(20,20,16,0.14)`.
- **Text:** primary `#1A1A18`, secondary `#6B6B66`, tertiary `#9A9A93`.
- **Brand accent (calm slate-indigo):** `#3F4D6B` — used sparingly: primary buttons, active nav, links/focus rings. Hover `#33405C`.
- **Status (muted, reused verbatim from the approved mockup):**
  - All clear (pass): text `#0F6E56`, fill `#E1F5EE`
  - Needs a look (unsure): text `#854F0B`, fill `#FAEEDA`
  - Broken: text `#A32D2D`, fill `#FCEBEB`

Status colors are calm fills with same-family dark text — never saturated/loud. "Broken" is clear but not aggressive.

### 2.2 Typography
- Font: **Inter** via `next/font` (self-hosted, no external request). Monospace: the system mono stack.
- **Two weights only:** 400 regular, 500 medium. Never 600/700.
- **Sentence case everywhere.** Never Title Case, never ALL CAPS.
- Scale: page title 26 / section heading 18 / body 15–16 (line-height 1.6) / meta 13.
- **Monospace is reserved** for genuinely technical content: URLs, CSS selectors, console-error text, step ids. Never for prose, flow names, or headings.

### 2.3 Shape, spacing, motion
- Cards: white, 0.5–1px border, `border-radius: 12px`, padding `16–20px`. Flat — no drop shadows except functional focus rings.
- Status badges: pills (`border-radius: 999px`), 12–13px, dot or small icon + label.
- Generous whitespace; vertical rhythm in rem (1/1.5/2).
- Motion: minimal and calm — short fades/height transitions (~150ms); no bouncy/attention-grabbing animation. Check-now progress is a calm indeterminate state, not a flashing spinner.

### 2.4 Voice
Plain English, founder-facing. Verdicts read as outcomes ("Customers can log in", "Checkout is broken"), not jargon. UNSURE always soft ("Needs a look — might be us, not you") and visually amber, never red. Empty/error states are reassuring and actionable.

## 3. Component kit

All in `packages/web/src/components`, hand-rolled with Tailwind; Radix primitives only where interaction needs it (`@radix-ui/react-dialog`, `react-dropdown-menu`). Each component is presentational and independently testable.

- **`Sidebar`** — persistent left nav: Overview, each app (with status dot), Settings. Collapses on narrow widths. Active item uses brand accent.
- **`AppBreadcrumbTabs`** — within an app: Report / Flows / Settings tabs.
- **`VerdictBadge`** — calm status pill. Props: `verdict: 'pass'|'broken'|'unsure'|null`. Maps to All clear / Broken / Needs a look / Not checked yet, using §2.1 status tokens; null = neutral grey. (Evolves the existing `VerdictBadge`.)
- **`AppCard`** — overview tile: app name, worst-status badge, last-checked relative time, inline Check-now.
- **`FlowRow`** — one watched flow: name, `VerdictBadge`, a compact run-history strip (last ~10 runs as small status ticks). Expandable: BROKEN reveals failed-step + `ScreenshotStrip` + a reserved fix-prompt slot.
- **`RunTimeline`** — a flow's runs over time (date, verdict, duration); links to per-run screenshots.
- **`ScreenshotStrip`** — horizontal thumbnails of per-step screenshots (signed URLs); click to enlarge in a Radix dialog. Local-path locators render a placeholder.
- **`FindingItem`** — one sweep finding: kind, page URL (mono), evidence (mono if technical), first-seen. Grouped under "Rest of your app".
- **`CheckNowButton`** — states: idle → running (calm progress + step text) → result toast. (UI now; wired to the 2.2 jobs queue later.)
- **`EmptyState`** — icon, one-line reassurance, primary CTA (e.g. "Connect your first app").
- **`Toast`** — transient confirmations/errors (Radix or a tiny custom).

## 4. Navigation / information architecture

Persistent left **`Sidebar`** (Overview · apps · Settings). Within an app, **tabs** (Report / Flows / Settings). Rationale: scales as apps and per-app sections grow; keeps the report (the hub) one click from anywhere. Top-right shows account menu.

## 5. Pages

Each: purpose · layout · components · key states. "Buildable now" = renders from existing read-only data; "Awaits 2.2/2.4" = UI specced now, wired when that backend exists.

1. **Login** *(buildable now)* — centered card on page bg; email input → "check your inbox" confirmation. Components: bare form, `Toast`. States: idle / sending / sent / error.
2. **Connect** *(awaits 2.2)* — single calm form: production URL, optional preview URL, optional test creds (with "use a throwaway test account" helper text), and "What's the one thing a user must always be able to do?" Submit kicks off mapping.
3. **Discovering** *(awaits 2.2)* — calm progress screen while the engine maps + sweeps the new app; reassuring copy, no spinner anxiety. Resolves into Review journeys.
4. **Review journeys** *(awaits 2.2)* — list of deep candidates from the classifier; ★ recommended pre-checked, ⚠ needs-info flagged with the hint; select up to 8; confirm → they become watched. Components: candidate rows w/ checkboxes, quota counter, primary confirm.
5. **Overview** *(buildable now)* — `Sidebar` + grid of `AppCard`s (worst-status, last-checked, Check-now). Empty state → "Connect your first app". 
6. **App report (the hub)** *(buildable now; Check-now awaits 2.2; fix-prompt slot awaits DIAGNOSE)* — header: app name · last-checked · `CheckNowButton`. Section *Watched flows*: `FlowRow`s with verdict + mini history; BROKEN expands to failed step + `ScreenshotStrip` + reserved fix-prompt slot. Section *Rest of your app*: `FindingItem`s (confirmed sweep findings). States: no flows / no runs yet / all clear / has-broken.
7. **Flow detail** *(buildable now)* — `RunTimeline` of this flow's runs + per-step `ScreenshotStrip` + the current golden-path steps (read-only, mono for selectors).
8. **Flows & journeys** *(awaits 2.2)* — watched flows list (pause/remove later), "add a flow in plain English" textarea (→ engine `flow:describe`), and a "re-check for new journeys" action (→ re-sweep + classify).
9. **App settings** *(awaits 2.2/2.4)* — production/preview URLs, test creds (write-masked), watch schedule, per-app notification prefs.
10. **Account settings** *(awaits 2.4)* — profile/email, global notification prefs (state-change pings, weekly all-quiet digest — both optional per spec §4.4).

## 6. Cross-cutting states
- **Empty:** no apps (big Connect CTA), no runs ("Not checked yet" — neutral, not alarming), no findings ("We found nothing else amiss").
- **Loading:** Check-now inline progress; page-level skeletons that match final layout (no spinner-only screens).
- **Error:** calm, plain-English, with a next action ("We couldn't reach your app — check the URL"). Never a stack trace.

## 7. Phase-1 integration map
- Verdicts + run history + step screenshots → pages 5, 6, 7 (read; available now).
- Site-sweep findings (confirmed ≥2 sweeps) → page 6 "Rest of your app".
- Deep-journey classify → select ≤8 → pages 3, 4.
- Custom flow via plain English + re-map/re-curate → page 8.
- Self-heal — invisible by design; no dedicated UI (a healed flow simply stays green).
- Check-now (on-demand run) → pages 5, 6 (UI now; backend in 2.2).
- Fix-prompts (DIAGNOSE, unbuilt) → reserved slot in the BROKEN expansion on page 6.

## 8. Build approach
- **Tailwind** (already in `packages/web`) with a tokens layer (`src/styles/tokens.css` or Tailwind theme extension) holding §2.1 colors + scale; components consume tokens, never hard-coded hex.
- **Hand-rolled components** + **Radix primitives** only for dialog/dropdown/tooltip. No heavyweight UI kit.
- **Server-components-first** (matches 2.1): data-fetching server components; client components only for interactive bits (Check-now, dialogs, the login form).
- Reuse/evolve existing 2.1 components (`VerdictBadge`, `FlowReport`, `FindingsList`) rather than replacing wholesale.
- `next/font` for Inter; **light mode only** for the pilot (dark mode deferred).

## 9. Implementation phasing
- **Phase A — buildable now (the first implementation plan):** tokens + Tailwind theme; component kit (`Sidebar`, `VerdictBadge`, `AppCard`, `FlowRow`, `RunTimeline`, `ScreenshotStrip`, `FindingItem`, `EmptyState`, `Toast`, `CheckNowButton` visual-only); redesigned **Login (1)**, **Overview (5)**, **App report (6)**, **Flow detail (7)**; all cross-cutting states (§6). Renders entirely from existing read-only data. `CheckNowButton` is present but disabled/"coming soon" until 2.2.
- **Phase B — with sub-project 2.2:** Connect (2), Discovering (3), Review journeys (4), Flows & journeys (8), App settings (9), and wiring Check-now to the jobs queue.
- **Phase C — with sub-project 2.4:** Account settings (10) + notification wiring.

Each phase is its own spec→plan→build cycle; this document is the shared design source.

## 10. Testing
- Component tests (Vitest + @testing-library/react): `VerdictBadge` maps verdicts to calm labels + non-red UNSURE; `FlowRow` expands only for BROKEN and shows screenshots; `ScreenshotStrip` renders signed URLs and a placeholder for local paths; `EmptyState` renders CTA; `AppCard` shows worst-status.
- Page render tests with seeded view models (Overview, App report, Flow detail) asserting structure, status, and empty states.
- Visual/manual: a one-time review of the four Phase-A pages against this spec's tokens and voice.
- Accessibility: focus rings on interactive elements, `aria-label` on icon-only buttons, sufficient contrast for status text on fills.

## 11. Non-goals
- Billing/Stripe UI (pilot first).
- Marketing landing page.
- Dark mode (deferred).
- Real-time multiplayer/collab.
- Any change to the engine's runtime behavior (UI reads existing data; write actions arrive with their 2.2 backends).
