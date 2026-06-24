# Read-Only In-App Navigation Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the sweep crawler reach SPA pages that are behind client-side button/route navigation (not `<a href>`), by *clicking navigation-like controls only to reveal a URL* and then sweeping that URL via a normal read-only `goto` — without ever firing a destructive or form-submitting action.

**Architecture:** The crawler keeps its existing `<a href>` BFS. Behind an explicit opt-in flag (`navDiscovery`, default OFF), each page additionally has its **navigation-like clickable controls** discovered. For each candidate, in an *isolated* page, we re-`goto` the parent URL, click the control once, and read the resulting URL. If clicking produced a new same-origin, non-unsafe URL, we enqueue that URL — the actual page checks still happen later via a plain `goto`. Clicking is used *only to reveal a route*, never as the unit of inspection. Safety is enforced three ways: (1) the feature is off by default and is force-disabled for apps marked unsafe; (2) controls inside a `<form>` and `type=submit` controls are never clicked; (3) controls whose accessible label matches a destructive-verb list are never clicked.

**Tech Stack:** TypeScript ESM (NodeNext), Playwright (chromium), Vitest, the existing `@vigil/engine` + `@vigil/fixture-app` packages.

## Global Constraints

- **Read-only doctrine (spec §4.3.1):** the sweep must never cause a side effect. Clicking is permitted *only* to reveal a navigation target; never submit a form, never click a `type=submit` control, never click a control inside a `<form>`, never click a destructive-labelled control.
- **Safety red line — settlenepal:** the matrimony app's core action ("send proposal") is a button. `navDiscovery` defaults to OFF and MUST be force-disabled for any app whose name is on an unsafe list (initially `settlenepal`). Never run nav-discovery against settlenepal in this plan; live-validate on the fixture only.
- **Reuse, don't duplicate:** reuse `normalize()` and `isUnsafeHref()` from `src/sweep/crawler.ts`. The new label filter lives beside them.
- **`pnpm db:dev` must NOT run during tests** (its port 54329 collides with the test globalSetup's embedded Postgres). Kill `lsof -ti tcp:54329` before running the suite. (Nav-discovery tests don't need Postgres, but the full suite does.)
- **Gitignore:** never `git add -A`; stage explicit paths.
- **Commit trailer:** `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **YAGNI scope boundary:** this plan delivers nav-discovery for the *sweep* only. It does NOT build the `SurfaceInventory` artifact or rewire mapping — that is a follow-on plan (mapping-consistency). Do not start it here.

---

## File Structure

- `packages/engine/src/sweep/navSafety.ts` — **new.** Pure text-label safety filter `isUnsafeLabel(label)`. One responsibility: decide whether a control's accessible label looks destructive/outward-facing.
- `packages/engine/src/sweep/crawler.ts` — **modify.** Add `navDiscovery?` to `SweepOptions`; add `discoverNavTargets()`; enqueue revealed URLs when enabled.
- `packages/engine/src/cli.ts` — **modify.** Add `--deep` to the `sweep` command; pass `navDiscovery`, force-disabled for unsafe-named apps.
- `packages/fixture-app/src/server.ts` — **modify.** Add SPA-style nav routes + a submit canary so the safety behaviour is testable deterministically.
- `packages/engine/test/navSafety.test.ts` — **new.** Unit tests for `isUnsafeLabel`.
- `packages/engine/test/crawler.test.ts` — **modify.** Integration tests for nav-discovery (capability + safety canaries).
- `packages/engine/test/cli.test.ts` — **modify.** Test the `--deep` flag + unsafe-app guard.

---

## Task 1: Destructive-label safety filter

**Files:**
- Create: `packages/engine/src/sweep/navSafety.ts`
- Test: `packages/engine/test/navSafety.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function isUnsafeLabel(label: string): boolean` — true when a clickable control's accessible label looks destructive or outward-facing (delete, send, pay, submit, logout, buy, confirm, remove, …), matched as whole words, case-insensitively.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/engine/test/navSafety.test.ts
import { describe, expect, it } from 'vitest';
import { isUnsafeLabel } from '../src/sweep/navSafety.js';

describe('isUnsafeLabel', () => {
  it('flags destructive / outward-facing control labels', () => {
    for (const l of [
      'Delete account', 'Send message', 'Send proposal', 'Pay now', 'Submit',
      'Log out', 'Sign out', 'Buy', 'Confirm order', 'Remove', 'Cancel subscription',
      'Unsubscribe', 'Withdraw', 'Archive',
    ]) {
      expect(isUnsafeLabel(l), l).toBe(true);
    }
  });

  it('allows navigation-like labels', () => {
    for (const l of [
      'Open inbox', 'View matches', 'Dashboard', 'Next', 'Settings', 'Profile',
      'Browse', 'Search', 'My documents', 'Back to home', 'Sender details',
    ]) {
      expect(isUnsafeLabel(l), l).toBe(false);
    }
  });

  it('matches whole words, not substrings, and ignores case', () => {
    expect(isUnsafeLabel('PAY')).toBe(true);
    expect(isUnsafeLabel('Paywall info')).toBe(false); // "pay" is not a whole word here
    expect(isUnsafeLabel('Senders')).toBe(false);      // "send" is not a whole word here
    expect(isUnsafeLabel('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test -- navSafety`
Expected: FAIL — `Cannot find module '../src/sweep/navSafety.js'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/engine/src/sweep/navSafety.ts

/** Verbs whose presence in a control's label means clicking it could cause a
 *  side effect or an outward-facing action. The sweep reveals routes by clicking
 *  navigation controls only — anything that looks like an action is never clicked.
 *  "Sender" / "Senders" must NOT match "send", so we match on whole words. */
const UNSAFE_LABEL_WORDS = [
  'delete', 'remove', 'destroy', 'archive', 'cancel', 'unsubscribe', 'withdraw',
  'send', 'submit', 'post', 'publish', 'pay', 'buy', 'purchase', 'checkout',
  'order', 'confirm', 'logout', 'signout',
];

/** True when a clickable control's accessible label looks destructive or
 *  outward-facing and therefore must not be clicked during route discovery. */
export function isUnsafeLabel(label: string): boolean {
  const words = label.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.some((w) => UNSAFE_LABEL_WORDS.includes(w));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test -- navSafety`
Expected: PASS (3 tests). Note: "Log out" / "Sign out" pass because they tokenize to `log`+`out` / `sign`+`out` — wait, that yields `out`, not `logout`. Fix by also tokenizing on the joined form: see Step 5 if the multi-word cases fail.

- [ ] **Step 5: Adjust for multi-word forms, re-run**

If `'Log out'` / `'Sign out'` fail (they tokenize to `log`,`out` / `sign`,`out`), add their split forms to the list so both `logout` and the `log`+`out` spelling are covered:

```typescript
const UNSAFE_LABEL_WORDS = [
  'delete', 'remove', 'destroy', 'archive', 'cancel', 'unsubscribe', 'withdraw',
  'send', 'submit', 'post', 'publish', 'pay', 'buy', 'purchase', 'checkout',
  'order', 'confirm', 'logout', 'signout', 'logoff',
];
const UNSAFE_LABEL_PHRASES = ['log out', 'sign out', 'log off'];

export function isUnsafeLabel(label: string): boolean {
  const lower = label.toLowerCase();
  if (UNSAFE_LABEL_PHRASES.some((p) => lower.includes(p))) return true;
  const words = lower.match(/[a-z]+/g) ?? [];
  return words.some((w) => UNSAFE_LABEL_WORDS.includes(w));
}
```

Run: `pnpm --filter @vigil/engine test -- navSafety`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/sweep/navSafety.ts packages/engine/test/navSafety.test.ts
git commit -m "feat: destructive-label filter for safe nav discovery

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: Nav-discovery in the crawler (behind `navDiscovery`, default off)

**Files:**
- Modify: `packages/fixture-app/src/server.ts` (add SPA nav routes + submit canary)
- Modify: `packages/engine/src/sweep/crawler.ts` (add option + discovery)
- Test: `packages/engine/test/crawler.test.ts`

**Interfaces:**
- Consumes: `isUnsafeLabel` (Task 1); `normalize`, `isUnsafeHref` (existing in crawler.ts).
- Produces: `SweepOptions.navDiscovery?: boolean` and `SweepOptions.maxNavCandidatesPerPage?: number`. When `navDiscovery` is true, `sweepSite` enqueues URLs revealed by clicking navigation-like controls. Default behaviour (flag absent/false) is unchanged.

- [ ] **Step 1: Add fixture routes that are only reachable by clicking**

In `packages/fixture-app/src/server.ts`:

(a) Add a submit canary counter at the top of `createFixtureApp()`, right after `const broken = new Set<Breakable>();`:

```typescript
  let submitHits = 0; // canary: must stay 0 — nav discovery must never submit forms
```

(b) Reset it in `/__reset` — change that handler to:

```typescript
  app.post('/__reset', (_req, res) => { broken.clear(); submitHits = 0; res.sendStatus(204); });
```

(c) Add a link to `/app` in the home nav so the crawl reaches it. Change the home route's nav line to include the App link:

```typescript
      <nav><a href="/login">Login</a> <a href="${navHref}">About</a> <a href="/contact">Contact</a> <a href="/app">App</a></nav>${script}`));
```

(d) Add the new routes after the `/blank` and `/hydrate` routes:

```typescript
  // SPA-style page: /app/inside is reachable ONLY by clicking the nav button
  // (no <a href> points at it), so an href-only crawl misses it. The destructive
  // button and the form submit are canaries: nav discovery must never trigger them.
  app.get('/app', (_req, res) =>
    res.send(page('App', `<h1>App</h1>
      <button id="go" onclick="location.assign('/app/inside')">Open inbox</button>
      <button id="danger" onclick="location.assign('/app/deleted')">Delete account</button>
      <form action="/app/submit" method="post"><input name="x"><button type="submit">Send message</button></form>`)));
  app.get('/app/inside', (_req, res) =>
    res.send(page('Inbox', `<h1>Inbox</h1><p>Your messages live here. Everything looks fine.</p>`)));
  app.get('/app/deleted', (_req, res) =>
    res.send(page('Deleted', `<h1>account deleted</h1><p>this should never be reached by a sweep</p>`)));
  app.post('/app/submit', (_req, res) => { submitHits++; res.send(page('Sent', `<h1>sent</h1>`)); });
  app.get('/__submit-hits', (_req, res) => res.json({ hits: submitHits }));
```

- [ ] **Step 2: Write the failing test**

In `packages/engine/test/crawler.test.ts`, add inside `describe('sweepSite', …)`:

```typescript
  it('without navDiscovery, misses a page reachable only by clicking a nav button', async () => {
    const result = await sweepSite({ baseUrl: url, maxPages: 30 });
    expect(result.pages.some((p) => p.url.endsWith('/app'))).toBe(true);          // reached via <a href>
    expect(result.pages.some((p) => p.url.endsWith('/app/inside'))).toBe(false);  // button-only, missed
  });

  it('with navDiscovery, reaches the button-only page but never clicks destructive or submit controls', async () => {
    const result = await sweepSite({ baseUrl: url, maxPages: 30, navDiscovery: true });
    // capability: the inbox page, reachable only by clicking "Open inbox", is now swept
    expect(result.pages.some((p) => p.url.endsWith('/app/inside'))).toBe(true);
    // safety: the "Delete account" button (destructive label) was never clicked
    expect(result.pages.some((p) => p.url.endsWith('/app/deleted'))).toBe(false);
    // safety: the form submit ("Send message") was never triggered
    const { hits } = await (await fetch(`${url}/__submit-hits`)).json();
    expect(hits).toBe(0);
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test -- crawler`
Expected: the first new test PASSES (href-only already misses `/app/inside`); the second FAILS — `navDiscovery` is not a known option, so `/app/inside` is never reached (`expected false to be true`).

- [ ] **Step 4: Add the option fields**

In `packages/engine/src/sweep/crawler.ts`, extend `SweepOptions` (after `hydrationMs?`):

```typescript
  /** opt-in: also reach pages behind client-side button/route nav by clicking
   *  navigation-like controls to reveal their URL (default false — read-only/href-only) */
  navDiscovery?: boolean;
  /** cap on nav-click candidates probed per page when navDiscovery is on (default 12) */
  maxNavCandidatesPerPage?: number;
```

- [ ] **Step 5: Implement `discoverNavTargets` and the candidate collector**

In `packages/engine/src/sweep/crawler.ts`, add the import at the top:

```typescript
import { isUnsafeLabel } from './navSafety.js';
```

Add these helpers above `sweepSite`:

```typescript
interface NavCandidate { selector: string; label: string; }

/** Collect clickable controls that look like navigation (not actions). Excludes
 *  anything inside a <form>, any type=submit control, and any destructive label.
 *  Returns a durable selector (#id preferred) the isolated probe can re-locate. */
async function collectNavCandidates(page: import('playwright').Page, cap: number): Promise<NavCandidate[]> {
  const raw = await page.$$eval('button, [role="button"]', (els) =>
    els.map((el) => {
      const inForm = !!el.closest('form');
      const isSubmit = (el.getAttribute('type') ?? '').toLowerCase() === 'submit';
      const id = el.getAttribute('id');
      const name = el.getAttribute('name');
      const label = ((el.textContent ?? '') || el.getAttribute('aria-label') || '').trim().slice(0, 60);
      let selector: string | null = null;
      if (id) selector = `#${CSS.escape(id)}`;
      else if (name) selector = `[name="${name}"]`;
      else if (label) selector = `text=${label}`; // Playwright text engine, exact-ish
      return { selector, label, inForm, isSubmit };
    }),
  );
  const out: NavCandidate[] = [];
  for (const c of raw) {
    if (!c.selector || c.inForm || c.isSubmit || !c.label) continue;
    if (isUnsafeLabel(c.label)) continue;
    out.push({ selector: c.selector, label: c.label });
    if (out.length >= cap) break;
  }
  return out;
}

/** Click each candidate once in an ISOLATED page (re-navigating to the parent
 *  first), and collect any new same-origin, non-unsafe URL the click revealed.
 *  Clicking is used only to reveal a route — the page itself is swept later via goto. */
async function discoverNavTargets(
  context: import('playwright').BrowserContext,
  parentUrl: string,
  candidates: NavCandidate[],
  timeout: number,
): Promise<string[]> {
  const found: string[] = [];
  for (const c of candidates) {
    const probe = await context.newPage();
    try {
      await probe.goto(parentUrl, { waitUntil: 'load', timeout });
      const before = probe.url();
      await probe.click(c.selector, { timeout: 3_000 }).catch(() => undefined);
      await probe.waitForURL((u) => u.toString() !== before, { timeout: 2_000 }).catch(() => undefined);
      const after = probe.url();
      if (after !== before) {
        const n = normalize(after, parentUrl);
        if (n && !isUnsafeHref(n)) found.push(n);
      }
    } finally {
      await probe.close().catch(() => undefined);
    }
  }
  return found;
}
```

- [ ] **Step 6: Wire discovery into the crawl loop**

In `sweepSite`, read the new options near the other defaults:

```typescript
  const navDiscovery = opts.navDiscovery ?? false;
  const maxNavCandidates = opts.maxNavCandidatesPerPage ?? 12;
```

Then, in the `else` branch right after the existing `<a href>` enqueue block (after the `for (const href of hrefs)` loop, still inside the `else`), add:

```typescript
          if (navDiscovery) {
            const candidates = await collectNavCandidates(page, maxNavCandidates);
            const revealed = await discoverNavTargets(context, current, candidates, timeout);
            for (const n of revealed) {
              if (!visited.has(n) && !isUnsafeHref(n)) queue.push(n);
            }
          }
```

(`context` is already in scope — it's created near the top of `sweepSite`.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @vigil/engine test -- crawler`
Expected: PASS — both new tests green (`/app/inside` reached with navDiscovery; `/app/deleted` never reached; submit hits 0), and all pre-existing crawler tests still green.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @vigil/engine typecheck && pnpm --filter @vigil/fixture-app typecheck`
Expected: no errors. (Note: `CSS.escape` is available in the browser context of `$$eval`, not Node — it runs inside the page, so this is fine.)

- [ ] **Step 9: Commit**

```bash
git add packages/engine/src/sweep/crawler.ts packages/fixture-app/src/server.ts packages/engine/test/crawler.test.ts
git commit -m "feat: read-only in-app nav discovery for the sweep (opt-in)

Reveals SPA pages behind client-side button/route nav by clicking
navigation-like controls in an isolated page to read the resulting URL,
then sweeping that URL via a normal read-only goto. Never clicks form,
submit, or destructive-labelled controls. Off by default.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: CLI `--deep` flag with an unsafe-app guard

**Files:**
- Modify: `packages/engine/src/cli.ts` (cmdSweep + commander wiring)
- Test: `packages/engine/test/cli.test.ts`

**Interfaces:**
- Consumes: `sweepSite` with `navDiscovery` (Task 2).
- Produces: `cmdSweep(appName: string, opts?: { deep?: boolean }): Promise<void>`. `--deep` enables nav-discovery, EXCEPT for apps on `UNSAFE_NAV_APPS` (initially `['settlenepal']`), where it is force-disabled with a printed warning.

- [ ] **Step 1: Write the failing test**

In `packages/engine/test/cli.test.ts`, add a test that the guard refuses deep mode for an unsafe-named app. (Match the file's existing harness for building an app + capturing console output; the assertion is the new behaviour.)

```typescript
  it('refuses deep nav-discovery for an unsafe-listed app (settlenepal)', async () => {
    // app named "settlenepal" must never have nav-discovery enabled, even with --deep
    await cmdAppAdd({ name: 'settlenepal', url: 'http://127.0.0.1:4999', loginEmail: 'x@y.z', loginPassword: 'p' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await cmdSweep('settlenepal', { deep: true });
    expect(warn.mock.calls.flat().join(' ')).toMatch(/deep nav-discovery disabled/i);
    warn.mockRestore();
  });
```

(If the test file doesn't already import `cmdSweep`/`cmdAppAdd`/`vi`, add them to the existing imports.)

- [ ] **Step 2: Run test to verify it fails**

Run (kill the DB port first — cli tests use Postgres): `lsof -ti tcp:54329 | xargs kill -9 2>/dev/null; pnpm --filter @vigil/engine test -- cli`
Expected: FAIL — `cmdSweep` does not accept an options arg / prints no warning.

- [ ] **Step 3: Implement the guard in `cmdSweep`**

In `packages/engine/src/cli.ts`, add near the top (after imports):

```typescript
// Apps where clicking controls is unsafe (e.g. a "send proposal" button on a
// matrimony app). Deep nav-discovery is force-disabled for these regardless of --deep.
const UNSAFE_NAV_APPS = new Set(['settlenepal']);
```

Change `cmdSweep` to accept options and apply the guard:

```typescript
export async function cmdSweep(appName: string, opts: { deep?: boolean } = {}): Promise<void> {
  const app = await requireApp(appName);
  const flows = await listConfirmedFlows(app.id);
  const loginFlow = flows.find((f) => f.goldenPath.name.toLowerCase() === 'login')?.goldenPath;
  let navDiscovery = opts.deep ?? false;
  if (navDiscovery && UNSAFE_NAV_APPS.has(app.name)) {
    console.warn(`deep nav-discovery disabled for "${app.name}" (clicking controls is unsafe here)`);
    navDiscovery = false;
  }
  const result = await sweepSite({
    baseUrl: app.productionUrl, maxPages: 200,
    loginFlow, credentials: app.credentials ?? undefined, navDiscovery,
  });
  await recordSweep(app.id, result);
  console.log(`Swept ${result.pages.length} pages, ${result.findings.length} raw findings (confirmation needs 2 consecutive sweeps)`);
}
```

- [ ] **Step 4: Wire the `--deep` flag in commander**

Find the `sweep` command registration (around `program.command('sweep')…`) and change it to:

```typescript
  program.command('sweep').argument('<app>')
    .option('--deep', 'also reach pages behind client-side button/route navigation (off for unsafe apps)')
    .action(async (app, o) => { await cmdSweep(app, { deep: !!o.deep }); });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `lsof -ti tcp:54329 | xargs kill -9 2>/dev/null; pnpm --filter @vigil/engine test -- cli`
Expected: PASS — the guard test green, all existing cli tests green.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter @vigil/engine typecheck
git add packages/engine/src/cli.ts packages/engine/test/cli.test.ts
git commit -m "feat: vigil sweep --deep flag, force-disabled for unsafe apps

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: Full-suite verification, live fixture validation, final review & merge

**Files:** none (verification + merge).

- [ ] **Step 1: Run the full engine suite**

Run: `lsof -ti tcp:54329 | xargs kill -9 2>/dev/null; pnpm --filter @vigil/engine test`
Expected: all tests pass (prior 84 + navSafety 3 + crawler 2 + cli 1 = 90), output pristine.

- [ ] **Step 2: Live-validate on the FIXTURE only (never settlenepal)**

Start the fixture and run a deep sweep against it via the CLI to confirm end-to-end:

```bash
# from packages/engine, with the fixture running on :4999 and DB up + migrated
pnpm vigil app:add --name fixturenav --url http://127.0.0.1:4999
pnpm vigil sweep fixturenav --deep
```

Expected: the swept-pages count is higher than a non-`--deep` run of the same app, and the run completes with no error. Confirm `/app/inside` appears and `/app/deleted` does not (query `sweep_pages` as in prior live checks). Do NOT run `--deep` against settlenepal.

- [ ] **Step 3: Final whole-branch review**

Dispatch a code review (superpowers:requesting-code-review) over the whole branch diff vs `main`, with model `opus` (subagents can't use fable). Focus the reviewer on: the read-only guarantee (no form/submit/destructive click path), the unsafe-app guard, and selector robustness in `collectNavCandidates`.

- [ ] **Step 4: Address review feedback**

Apply any required fixes (use superpowers:receiving-code-review to triage). Re-run the full suite after changes.

- [ ] **Step 5: Merge to main**

```bash
git checkout main
git merge --no-ff feat/nav-discovery -m "Merge feat/nav-discovery: read-only in-app navigation discovery for the sweep"
git branch -d feat/nav-discovery
```

- [ ] **Step 6: Update project memory**

Update `vigil-project-context.md`: mark SPA-breadth gap as *partially closed* (button/route nav now reachable via opt-in `--deep`, default off, force-disabled for settlenepal); note the residual (form-gated / data-gated deeper states still need interact-to-reveal); record that the `SurfaceInventory`/mapping-consistency rebuild is the next plan and can reuse `collectNavCandidates` + the crawl as its deterministic Phase-1 enumeration.

---

## Self-Review

**Spec coverage:** (1) SPA breadth via safe clicking → Tasks 2–3. (2) Read-only/no-side-effect guarantee → form/submit/destructive exclusions (Task 2) + label filter (Task 1), proven by the submit-canary + `/app/deleted` assertions. (3) settlenepal safety red line → default-off + `UNSAFE_NAV_APPS` guard (Task 3), live-validation restricted to the fixture (Task 4). (4) Reuse of `normalize`/`isUnsafeHref` → Task 2. All covered.

**Placeholder scan:** no TBD/TODO; every code step shows full code; commands have expected output. Clear.

**Type consistency:** `isUnsafeLabel(label: string): boolean` (Task 1) used identically in Task 2. `navDiscovery`/`maxNavCandidatesPerPage` defined on `SweepOptions` (Task 2) and set by `cmdSweep` (Task 3). `cmdSweep(appName, { deep })` signature matches the commander `.action` call and the test. `NavCandidate { selector, label }` consistent across `collectNavCandidates`/`discoverNavTargets`. Consistent.
