# Deep-Journey Curation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the LLM-as-criticality-gatekeeper with a crawler → LLM-classify → user-curated deep-journey flow, where the user picks ≤8 journeys to watch and steps are authored lazily only for picks.

**Architecture:** The existing read-only `sweep` crawler additionally records per-page interaction signals. A new classifier turns the latest sweep into deep/shallow journey candidates (LLM classifies + recommends, never gates). Candidates persist in a new `journey_candidates` table. The user selects candidates by id; selected ones are authored lazily via the existing targeted `mapApp`, verified via the existing `verifyWithCorrection`, and on success become `confirmed` flows through the existing `flows` lifecycle. Authoring failures route to a `needs_info` fallback.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), node-postgres (`pg`), zod, Playwright, Commander, Vitest with embedded Postgres + `@vigil/fixture-app`.

## Global Constraints

- All TypeScript imports use explicit `.js` extensions (ESM). One line per relative import.
- Deep-flow quota is **8 confirmed deep flows per app**, counted as `journey_candidates` rows with `status='authored'`.
- The crawler stays **read-only**: signals are captured via `page.evaluate` during the existing crawl, no extra navigation or clicks.
- Reuse the existing `proposed → confirmed` + `verified` flow lifecycle (`flowsRepo`) and `mapApp({ targetJourney })` + `verifyWithCorrection`. Do not modify the mapper's signature.
- LLM access goes through the `LLMClient` interface; tests use `FakeLLMClient`. Commands accept an injectable `client` option.
- Run tests from `packages/engine` with `pnpm test`. A live Postgres reachable via `DATABASE_URL` is required (migrations run in `beforeAll`).
- Test DB cleanup truncates: `users, apps, flows, runs, sweeps, sweep_pages, sweep_findings, journey_candidates cascade`.

---

## File Structure

- **Create** `packages/engine/migrations/003_journey_candidates.sql` — adds `sweep_pages.signals` + `journey_candidates` table.
- **Modify** `packages/engine/src/sweep/crawler.ts` — `PageSignals` type, optional `SweptPage.signals`, capture during crawl.
- **Modify** `packages/engine/src/db/sweepRepo.ts` — persist signals in `recordSweep`; add `latestSweepPages`.
- **Create** `packages/engine/src/db/candidatesRepo.ts` — candidate CRUD + status transitions + quota count.
- **Create** `packages/engine/src/journeys/classify.ts` — `classifyJourneys` + `CLASSIFY_TOOL`.
- **Modify** `packages/engine/src/cli.ts` — `cmdJourneys`, `cmdJourneysSelect`, `cmdJourneysAuthor`, `authorCandidate` helper, commander wiring.
- **Tests** (`packages/engine/test/`): extend `crawler.test.ts`; new `journeyCandidatesSchema.test.ts`, `latestSweepPages.test.ts`, `candidatesRepo.test.ts`, `classify.test.ts`, `cliJourneys.test.ts`, `cliJourneysSelect.test.ts`.

---

## Task 1: Crawler captures per-page interaction signals

**Files:**
- Modify: `packages/engine/src/sweep/crawler.ts`
- Test: `packages/engine/test/crawler.test.ts`

**Interfaces:**
- Produces: `interface PageSignals { hasForm: boolean; inputCount: number; actionButtonCount: number; hasPasswordField: boolean }` and `SweptPage.signals?: PageSignals` (optional — existing `SweepResult` literals omit it).

- [ ] **Step 1: Write the failing test**

Add to `packages/engine/test/crawler.test.ts` inside `describe('sweepSite', ...)`:

```typescript
  it('captures interaction signals per page (form/inputs/password/buttons)', async () => {
    const result = await sweepSite({ baseUrl: url, maxPages: 20 });
    const login = result.pages.find((p) => p.url.endsWith('/login'))!;
    expect(login.signals?.hasForm).toBe(true);
    expect(login.signals?.inputCount).toBeGreaterThanOrEqual(2);
    expect(login.signals?.hasPasswordField).toBe(true);
    expect(login.signals?.actionButtonCount).toBeGreaterThanOrEqual(1);
    const about = result.pages.find((p) => p.url.endsWith('/about'))!;
    expect(about.signals?.hasForm).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test crawler -- -t "captures interaction signals"`
Expected: FAIL — `signals` is undefined on swept pages.

- [ ] **Step 3: Add the type and capture function**

In `packages/engine/src/sweep/crawler.ts`, change the `SweptPage` interface and add `PageSignals` (near line 9):

```typescript
export interface PageSignals { hasForm: boolean; inputCount: number; actionButtonCount: number; hasPasswordField: boolean; }
export interface SweptPage { url: string; httpStatus: number; loadMs: number; signals?: PageSignals; }
```

Add this helper next to `checkPage` (after the `checkPage` function, ~line 97):

```typescript
const EMPTY_SIGNALS: PageSignals = { hasForm: false, inputCount: 0, actionButtonCount: 0, hasPasswordField: false };

/** Read-only interaction signals used later to classify deep vs shallow journeys. */
async function collectSignals(page: import('playwright').Page): Promise<PageSignals> {
  return page.evaluate(() => ({
    hasForm: document.querySelectorAll('form').length > 0,
    inputCount: document.querySelectorAll('input, textarea, select').length,
    actionButtonCount: document.querySelectorAll('button, [role="button"], input[type="submit"]').length,
    hasPasswordField: document.querySelectorAll('input[type="password"]').length > 0,
  }));
}
```

- [ ] **Step 4: Populate signals during the crawl**

In `sweepSite`, replace the success/error page-push logic. The current block (lines ~216-248) pushes the page immediately after `goto` and again in `catch`. Restructure so signals are captured before pushing. Replace:

```typescript
        const response = await page.goto(current, { waitUntil: 'load', timeout });
        const loadMs = Date.now() - started;
        const status = response?.status() ?? 0;
        pages.push({ url: current, httpStatus: status, loadMs });

        if (status >= 400) {
          findings.push({ pageUrl: current, kind: 'dead_link', evidence: `HTTP ${status}` });
        } else {
          await waitForHydration(page, hydrationMs); // let SPAs render before judging
          for (const e of consoleErrors) findings.push({ pageUrl: current, kind: 'console_error', evidence: e });
          for (const f of failedRequests) findings.push({ pageUrl: current, kind: 'failed_request', evidence: f });
          const { brokenImages, unrendered } = await checkPage(page);
          for (const src of brokenImages) findings.push({ pageUrl: current, kind: 'broken_image', evidence: src });
          if (unrendered) findings.push({ pageUrl: current, kind: 'unrendered', evidence: 'no stylesheet or fewer than 30 chars of visible text' });
```

with:

```typescript
        const response = await page.goto(current, { waitUntil: 'load', timeout });
        const loadMs = Date.now() - started;
        const status = response?.status() ?? 0;
        let signals: PageSignals = EMPTY_SIGNALS;

        if (status >= 400) {
          pages.push({ url: current, httpStatus: status, loadMs, signals });
          findings.push({ pageUrl: current, kind: 'dead_link', evidence: `HTTP ${status}` });
        } else {
          await waitForHydration(page, hydrationMs); // let SPAs render before judging
          for (const e of consoleErrors) findings.push({ pageUrl: current, kind: 'console_error', evidence: e });
          for (const f of failedRequests) findings.push({ pageUrl: current, kind: 'failed_request', evidence: f });
          const { brokenImages, unrendered } = await checkPage(page);
          for (const src of brokenImages) findings.push({ pageUrl: current, kind: 'broken_image', evidence: src });
          if (unrendered) findings.push({ pageUrl: current, kind: 'unrendered', evidence: 'no stylesheet or fewer than 30 chars of visible text' });
          signals = await collectSignals(page);
          pages.push({ url: current, httpStatus: status, loadMs, signals });
```

(The `else` block continues with the existing `hrefs`/`navDiscovery` logic and its closing braces — leave those unchanged.)

In the `catch` block (~line 247), change:

```typescript
        pages.push({ url: current, httpStatus: 0, loadMs: Date.now() - started });
```

to:

```typescript
        pages.push({ url: current, httpStatus: 0, loadMs: Date.now() - started, signals: EMPTY_SIGNALS });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test crawler -- -t "captures interaction signals"`
Expected: PASS. Also run `pnpm --filter @vigil/engine test crawler` — all crawler tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/sweep/crawler.ts packages/engine/test/crawler.test.ts
git commit -m "feat: crawler records per-page interaction signals

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Migration — signals column + journey_candidates table

**Files:**
- Create: `packages/engine/migrations/003_journey_candidates.sql`
- Test: `packages/engine/test/journeyCandidatesSchema.test.ts`

**Interfaces:**
- Produces: `sweep_pages.signals jsonb` (default `'{}'`) and table `journey_candidates(id, app_id, name, entry_url, recommended, feasibility_hint, status, created_at)` with `unique (app_id, name)` and `status in ('open','selected','needs_info','authored','dismissed')`.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/journeyCandidatesSchema.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });

describe('migration 003', () => {
  it('adds sweep_pages.signals and the journey_candidates table', async () => {
    const { rows: cols } = await getPool().query(
      `select column_name from information_schema.columns where table_name = 'sweep_pages' and column_name = 'signals'`);
    expect(cols).toHaveLength(1);
    const { rows: tbl } = await getPool().query(
      `select table_name from information_schema.tables where table_name = 'journey_candidates'`);
    expect(tbl).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test journeyCandidatesSchema`
Expected: FAIL — `journey_candidates` table does not exist (cols empty).

- [ ] **Step 3: Write the migration**

Create `packages/engine/migrations/003_journey_candidates.sql`:

```sql
alter table sweep_pages add column signals jsonb not null default '{}'::jsonb;

create table journey_candidates (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references apps(id) on delete cascade,
  name text not null,
  entry_url text not null,
  recommended boolean not null default false,
  feasibility_hint text,
  status text not null default 'open'
    check (status in ('open', 'selected', 'needs_info', 'authored', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (app_id, name)
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test journeyCandidatesSchema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/migrations/003_journey_candidates.sql packages/engine/test/journeyCandidatesSchema.test.ts
git commit -m "feat: migration for journey_candidates + sweep_pages.signals

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Persist signals + read the latest sweep's pages

**Files:**
- Modify: `packages/engine/src/db/sweepRepo.ts`
- Test: `packages/engine/test/latestSweepPages.test.ts`

**Interfaces:**
- Consumes: `PageSignals`, `SweepResult` from `../sweep/crawler.js` (Task 1).
- Produces: `interface ClassifiablePage { url: string; httpStatus: number; signals: PageSignals }` and `latestSweepPages(appId: string): Promise<ClassifiablePage[]>`.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/latestSweepPages.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, createApp } from '../src/db/appsRepo.js';
import { recordSweep, latestSweepPages } from '../src/db/sweepRepo.js';
import type { SweepResult } from '../src/sweep/crawler.js';

let appId: string;
beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings, journey_candidates cascade');
  const userId = await ensureUser('founder@vigil.test');
  appId = (await createApp({ userId, name: 'demo', productionUrl: 'http://x.test', previewUrl: null, credentials: null })).id;
});

describe('latestSweepPages', () => {
  it('returns the most recent sweep pages with their signals', async () => {
    const result: SweepResult = {
      pages: [{
        url: 'http://x.test/login', httpStatus: 200, loadMs: 12,
        signals: { hasForm: true, inputCount: 2, actionButtonCount: 1, hasPasswordField: true },
      }],
      findings: [],
    };
    await recordSweep(appId, result);
    const pages = await latestSweepPages(appId);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.url).toBe('http://x.test/login');
    expect(pages[0]!.signals.hasForm).toBe(true);
    expect(pages[0]!.signals.inputCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test latestSweepPages`
Expected: FAIL — `latestSweepPages` is not exported.

- [ ] **Step 3: Persist signals and add the reader**

In `packages/engine/src/db/sweepRepo.ts`, update the import on line 3 to include `PageSignals`:

```typescript
import type { FindingKind, PageSignals, SweepFinding, SweepResult } from '../sweep/crawler.js';
```

In `recordSweep`, change the `sweep_pages` insert (currently ~lines 46-48) to store signals:

```typescript
    await pool.query(
      'insert into sweep_pages (sweep_id, url, http_status, load_ms, signals) values ($1, $2, $3, $4, $5) on conflict do nothing',
      [sweepId, p.url, p.httpStatus, p.loadMs, JSON.stringify(p.signals ?? {})]);
```

Append to the end of the file:

```typescript
export interface ClassifiablePage { url: string; httpStatus: number; signals: PageSignals; }

/** Pages from the app's most recent sweep, with interaction signals normalized
 *  to a full PageSignals (older rows stored '{}'). Used by the journey classifier. */
export async function latestSweepPages(appId: string): Promise<ClassifiablePage[]> {
  const { rows } = await getPool().query<{ url: string; http_status: number; signals: Partial<PageSignals> }>(
    `select sp.url, sp.http_status, sp.signals from sweep_pages sp
     join sweeps s on s.id = sp.sweep_id
     where s.app_id = $1 and s.id = (select id from sweeps where app_id = $1 order by started_at desc limit 1)`,
    [appId]);
  return rows.map((r) => ({
    url: r.url,
    httpStatus: r.http_status,
    signals: {
      hasForm: !!r.signals.hasForm,
      inputCount: r.signals.inputCount ?? 0,
      actionButtonCount: r.signals.actionButtonCount ?? 0,
      hasPasswordField: !!r.signals.hasPasswordField,
    },
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test latestSweepPages`
Expected: PASS. Also run `pnpm --filter @vigil/engine test sweepRepo` — existing sweep-repo tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/db/sweepRepo.ts packages/engine/test/latestSweepPages.test.ts
git commit -m "feat: persist sweep page signals and read latest sweep pages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: journey_candidates repository

**Files:**
- Create: `packages/engine/src/db/candidatesRepo.ts`
- Test: `packages/engine/test/candidatesRepo.test.ts`

**Interfaces:**
- Produces:
  - `type CandidateStatus = 'open' | 'selected' | 'needs_info' | 'authored' | 'dismissed'`
  - `interface CandidateInput { name: string; entryUrl: string; recommended: boolean; feasibilityHint?: string }`
  - `interface CandidateRecord { id: string; appId: string; name: string; entryUrl: string; recommended: boolean; feasibilityHint: string | null; status: CandidateStatus }`
  - `upsertCandidates(appId: string, candidates: CandidateInput[]): Promise<void>` (insert; `on conflict (app_id, name) do nothing` — never clobbers an in-progress candidate)
  - `listCandidates(appId: string): Promise<CandidateRecord[]>`
  - `getCandidate(appId: string, id: string): Promise<CandidateRecord | null>`
  - `setCandidateStatus(appId: string, id: string, status: CandidateStatus, hint?: string): Promise<void>`
  - `countAuthoredCandidates(appId: string): Promise<number>`

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/candidatesRepo.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, createApp } from '../src/db/appsRepo.js';
import {
  upsertCandidates, listCandidates, getCandidate, setCandidateStatus, countAuthoredCandidates,
} from '../src/db/candidatesRepo.js';

let appId: string;
beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings, journey_candidates cascade');
  const userId = await ensureUser('founder@vigil.test');
  appId = (await createApp({ userId, name: 'demo', productionUrl: 'http://x.test', previewUrl: null, credentials: null })).id;
});

describe('candidatesRepo', () => {
  it('upserts and lists candidates; re-upsert does not clobber status', async () => {
    await upsertCandidates(appId, [
      { name: 'Login', entryUrl: 'http://x.test/login', recommended: true, feasibilityHint: 'needs a test login' },
      { name: 'Search', entryUrl: 'http://x.test/search', recommended: false },
    ]);
    let all = await listCandidates(appId);
    expect(all.map((c) => c.name).sort()).toEqual(['Login', 'Search']);
    const login = all.find((c) => c.name === 'Login')!;
    expect(login.recommended).toBe(true);
    expect(login.feasibilityHint).toBe('needs a test login');
    expect(login.status).toBe('open');

    await setCandidateStatus(appId, login.id, 'authored');
    await upsertCandidates(appId, [{ name: 'Login', entryUrl: 'http://x.test/login', recommended: true }]);
    all = await listCandidates(appId);
    expect(all.find((c) => c.name === 'Login')!.status).toBe('authored'); // not reset to open
  });

  it('getCandidate returns one or null; setCandidateStatus stores a hint', async () => {
    await upsertCandidates(appId, [{ name: 'Checkout', entryUrl: 'http://x.test/checkout', recommended: true }]);
    const id = (await listCandidates(appId))[0]!.id;
    await setCandidateStatus(appId, id, 'needs_info', 'hits payment');
    const got = await getCandidate(appId, id);
    expect(got!.status).toBe('needs_info');
    expect(got!.feasibilityHint).toBe('hits payment');
    expect(await getCandidate(appId, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('countAuthoredCandidates counts only authored', async () => {
    await upsertCandidates(appId, [
      { name: 'A', entryUrl: 'http://x.test/a', recommended: false },
      { name: 'B', entryUrl: 'http://x.test/b', recommended: false },
    ]);
    const [a] = await listCandidates(appId);
    await setCandidateStatus(appId, a!.id, 'authored');
    expect(await countAuthoredCandidates(appId)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test candidatesRepo`
Expected: FAIL — module `../src/db/candidatesRepo.js` not found.

- [ ] **Step 3: Implement the repo**

Create `packages/engine/src/db/candidatesRepo.ts`:

```typescript
import { getPool } from './pool.js';

export type CandidateStatus = 'open' | 'selected' | 'needs_info' | 'authored' | 'dismissed';

export interface CandidateInput { name: string; entryUrl: string; recommended: boolean; feasibilityHint?: string; }

export interface CandidateRecord {
  id: string; appId: string; name: string; entryUrl: string;
  recommended: boolean; feasibilityHint: string | null; status: CandidateStatus;
}

interface Row {
  id: string; app_id: string; name: string; entry_url: string;
  recommended: boolean; feasibility_hint: string | null; status: CandidateStatus;
}

function mapRow(r: Row): CandidateRecord {
  return {
    id: r.id, appId: r.app_id, name: r.name, entryUrl: r.entry_url,
    recommended: r.recommended, feasibilityHint: r.feasibility_hint, status: r.status,
  };
}

const COLS = 'id, app_id, name, entry_url, recommended, feasibility_hint, status';

/** Insert new candidates; an existing (app, name) is left untouched so an
 *  already selected/authored/needs_info candidate is never reset by a re-run. */
export async function upsertCandidates(appId: string, candidates: CandidateInput[]): Promise<void> {
  for (const c of candidates) {
    await getPool().query(
      `insert into journey_candidates (app_id, name, entry_url, recommended, feasibility_hint)
       values ($1, $2, $3, $4, $5)
       on conflict (app_id, name) do nothing`,
      [appId, c.name, c.entryUrl, c.recommended, c.feasibilityHint ?? null]);
  }
}

export async function listCandidates(appId: string): Promise<CandidateRecord[]> {
  const { rows } = await getPool().query<Row>(
    `select ${COLS} from journey_candidates where app_id = $1 order by created_at`, [appId]);
  return rows.map(mapRow);
}

export async function getCandidate(appId: string, id: string): Promise<CandidateRecord | null> {
  const { rows } = await getPool().query<Row>(
    `select ${COLS} from journey_candidates where app_id = $1 and id = $2`, [appId, id]);
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Set status; when `hint` is provided it overwrites feasibility_hint (used to
 *  record why authoring failed), otherwise the existing hint is kept. */
export async function setCandidateStatus(
  appId: string, id: string, status: CandidateStatus, hint?: string,
): Promise<void> {
  await getPool().query(
    `update journey_candidates set status = $3, feasibility_hint = coalesce($4, feasibility_hint)
     where app_id = $1 and id = $2`,
    [appId, id, status, hint ?? null]);
}

export async function countAuthoredCandidates(appId: string): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(
    `select count(*)::int n from journey_candidates where app_id = $1 and status = 'authored'`, [appId]);
  return rows[0]!.n;
}
```

> **Note:** `getCandidate` with a non-UUID id would raise a Postgres cast error; the test only passes valid UUIDs. The CLI always passes ids copied from `listCandidates`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test candidatesRepo`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/db/candidatesRepo.ts packages/engine/test/candidatesRepo.test.ts
git commit -m "feat: journey_candidates repository

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Journey classifier (LLM classifies deep vs shallow)

**Files:**
- Create: `packages/engine/src/journeys/classify.ts`
- Test: `packages/engine/test/classify.test.ts`

**Interfaces:**
- Consumes: `LLMClient` from `../map/llmClient.js`; `ToolDef` from `../map/toolSchemas.js`; `PageSignals` from `../sweep/crawler.js`.
- Produces:
  - `interface ClassifierPage { url: string; signals: PageSignals }`
  - `interface JourneyCandidate { name: string; entryUrl: string; depth: 'deep' | 'shallow'; recommended: boolean; feasibilityHint?: string }`
  - `const CLASSIFY_TOOL: ToolDef`
  - `classifyJourneys(pages: ClassifierPage[], client: LLMClient): Promise<JourneyCandidate[]>` — returns **only** `depth === 'deep'` candidates; returns `[]` (without calling the client) when `pages` is empty.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/classify.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { classifyJourneys } from '../src/journeys/classify.js';
import { FakeLLMClient, type LLMResponse } from '../src/map/llmClient.js';
import type { PageSignals } from '../src/sweep/crawler.js';

const sig = (over: Partial<PageSignals> = {}): PageSignals =>
  ({ hasForm: false, inputCount: 0, actionButtonCount: 0, hasPasswordField: false, ...over });

describe('classifyJourneys', () => {
  it('returns only deep candidates, preserving recommended + hint', async () => {
    const script: LLMResponse[] = [{
      stopReason: 'tool_use',
      content: [{
        type: 'tool_use', id: 't1', name: 'classify_journeys',
        input: { journeys: [
          { name: 'Login', entryUrl: 'http://x/login', depth: 'deep', recommended: true, feasibilityHint: 'needs a test login' },
          { name: 'About', entryUrl: 'http://x/about', depth: 'shallow', recommended: false },
        ] },
      }],
    }];
    const client = new FakeLLMClient(script);
    const out = await classifyJourneys([
      { url: 'http://x/login', signals: sig({ hasForm: true, inputCount: 2, hasPasswordField: true, actionButtonCount: 1 }) },
      { url: 'http://x/about', signals: sig() },
    ], client);

    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('Login');
    expect(out[0]!.recommended).toBe(true);
    expect(out[0]!.feasibilityHint).toBe('needs a test login');
    expect(client.requests[0]!.messages[0]!.content[0]).toMatchObject({ type: 'text' });
  });

  it('returns [] for no pages without calling the LLM', async () => {
    const client = new FakeLLMClient([]); // would throw if called
    expect(await classifyJourneys([], client)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test classify`
Expected: FAIL — module `../src/journeys/classify.js` not found.

- [ ] **Step 3: Implement the classifier**

Create `packages/engine/src/journeys/classify.ts`:

```typescript
import { z } from 'zod';
import type { LLMClient } from '../map/llmClient.js';
import type { ToolDef } from '../map/toolSchemas.js';
import type { PageSignals } from '../sweep/crawler.js';

export interface ClassifierPage { url: string; signals: PageSignals; }
export interface JourneyCandidate {
  name: string; entryUrl: string; depth: 'deep' | 'shallow'; recommended: boolean; feasibilityHint?: string;
}

const candidateSchema = z.object({
  name: z.string().min(1),
  entryUrl: z.string().min(1),
  depth: z.enum(['deep', 'shallow']),
  recommended: z.boolean().default(false),
  feasibilityHint: z.string().optional(),
});

export const CLASSIFY_TOOL: ToolDef = {
  name: 'classify_journeys',
  description: 'Report the user journeys you identified from the crawled pages. Call exactly once with all journeys.',
  input_schema: {
    type: 'object',
    properties: {
      journeys: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Short plain-English journey name, e.g. "Checkout"' },
            entryUrl: { type: 'string', description: 'One of the page urls from the list where the journey starts' },
            depth: { type: 'string', enum: ['deep', 'shallow'], description: 'deep = interactive multi-step task worth watching; shallow = static/info page' },
            recommended: { type: 'boolean', description: 'Whether you recommend watching this deeply' },
            feasibilityHint: { type: 'string', description: 'Optional note if authoring would need something special, e.g. "needs a test login", "hits payment"' },
          },
          required: ['name', 'entryUrl', 'depth', 'recommended'],
        },
      },
    },
    required: ['journeys'],
  },
};

const SYSTEM = `You are Vigil's journey classifier. You receive a list of pages a read-only crawler found in a web app, each annotated with interaction signals (forms, inputs, password fields, buttons).

Decide which pages represent a DEEP user journey — a meaningful, interactive, business-critical task worth watching closely every night (login, signup, onboarding, the core action like create/search/upload/post, checkout, settings) — versus a SHALLOW page (static/marketing/info with little interaction).

For each distinct journey give: a short plain-English name, the entryUrl (one of the provided page urls), depth ('deep' or 'shallow'), whether you recommend watching it, and an optional feasibilityHint if authoring its steps would need something special (e.g. "needs a test login", "hits payment").

Use the interaction signals as evidence: forms/inputs/password fields/buttons suggest deep; little interaction suggests shallow. Do NOT invent pages that are not in the list. Call classify_journeys exactly once with all journeys.`;

function renderPages(pages: ClassifierPage[]): string {
  return pages
    .map((p) => `${p.url} — form:${p.signals.hasForm} inputs:${p.signals.inputCount} password:${p.signals.hasPasswordField} buttons:${p.signals.actionButtonCount}`)
    .join('\n');
}

/** One LLM pass over the latest sweep. Returns only the deep candidates; the LLM
 *  classifies and recommends but never decides the watched set (the user does). */
export async function classifyJourneys(pages: ClassifierPage[], client: LLMClient): Promise<JourneyCandidate[]> {
  if (pages.length === 0) return [];
  const resp = await client.createMessage({
    system: SYSTEM,
    tools: [CLASSIFY_TOOL],
    messages: [{ role: 'user', content: [{ type: 'text', text: `Pages found:\n${renderPages(pages)}` }] }],
  });

  let input: unknown;
  for (const b of resp.content) {
    if (b.type === 'tool_use' && b.name === 'classify_journeys') input = b.input;
  }
  if (input === undefined) return [];

  const journeys = (input as { journeys?: unknown[] }).journeys ?? [];
  const out: JourneyCandidate[] = [];
  for (const raw of journeys) {
    const parsed = candidateSchema.safeParse(raw);
    if (parsed.success && parsed.data.depth === 'deep') {
      out.push({
        name: parsed.data.name,
        entryUrl: parsed.data.entryUrl,
        depth: 'deep',
        recommended: parsed.data.recommended,
        feasibilityHint: parsed.data.feasibilityHint,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test classify`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/journeys/classify.ts packages/engine/test/classify.test.ts
git commit -m "feat: LLM journey classifier (deep vs shallow, recommend-only)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `journeys` command — classify latest sweep and list candidates

**Files:**
- Modify: `packages/engine/src/cli.ts`
- Test: `packages/engine/test/cliJourneys.test.ts`

**Interfaces:**
- Consumes: `latestSweepPages` (Task 3), `classifyJourneys` (Task 5), `upsertCandidates`/`listCandidates`/`countAuthoredCandidates` (Task 4).
- Produces: `const QUOTA = 8`; `interface JourneysCliOptions { client?: LLMClient }`; `cmdJourneys(appName: string, opts?: JourneysCliOptions): Promise<{ lines: string[] }>`.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/cliJourneys.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, getAppByName } from '../src/db/appsRepo.js';
import { recordSweep } from '../src/db/sweepRepo.js';
import { listCandidates } from '../src/db/candidatesRepo.js';
import { cmdAppAdd, cmdJourneys } from '../src/cli.js';
import { FakeLLMClient, type LLMResponse } from '../src/map/llmClient.js';
import type { SweepResult } from '../src/sweep/crawler.js';

const FOUNDER = process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local';
beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings, journey_candidates cascade');
});

describe('cmdJourneys', () => {
  it('classifies the latest sweep and persists deep candidates', async () => {
    await cmdAppAdd({ name: 'demo', url: 'http://x.test' });
    const app = (await getAppByName(await ensureUser(FOUNDER), 'demo'))!;
    const sweep: SweepResult = {
      pages: [
        { url: 'http://x.test/login', httpStatus: 200, loadMs: 10, signals: { hasForm: true, inputCount: 2, actionButtonCount: 1, hasPasswordField: true } },
        { url: 'http://x.test/about', httpStatus: 200, loadMs: 8, signals: { hasForm: false, inputCount: 0, actionButtonCount: 0, hasPasswordField: false } },
      ],
      findings: [],
    };
    await recordSweep(app.id, sweep);

    const script: LLMResponse[] = [{
      stopReason: 'tool_use',
      content: [{
        type: 'tool_use', id: 't1', name: 'classify_journeys',
        input: { journeys: [
          { name: 'Login', entryUrl: 'http://x.test/login', depth: 'deep', recommended: true },
          { name: 'About', entryUrl: 'http://x.test/about', depth: 'shallow', recommended: false },
        ] },
      }],
    }];

    const { lines } = await cmdJourneys('demo', { client: new FakeLLMClient(script) });
    const all = await listCandidates(app.id);
    expect(all.map((c) => c.name)).toEqual(['Login']); // only deep persisted
    expect(lines.join('\n')).toContain('Login');
    expect(lines.join('\n')).toContain('★'); // recommended marker
  });

  it('throws when there is no sweep to classify', async () => {
    await cmdAppAdd({ name: 'empty', url: 'http://x.test' });
    await expect(cmdJourneys('empty', { client: new FakeLLMClient([]) })).rejects.toThrow(/sweep/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test cliJourneys`
Expected: FAIL — `cmdJourneys` is not exported.

- [ ] **Step 3: Add imports and the command**

In `packages/engine/src/cli.ts`, extend the existing imports. Change the sweepRepo import (line 14) to add `latestSweepPages`:

```typescript
import { recordSweep, confirmedFindings, latestSweepPages } from './db/sweepRepo.js';
```

Add these imports after line 19 (`import { closePool } ...`):

```typescript
import { classifyJourneys } from './journeys/classify.js';
import {
  upsertCandidates, listCandidates, getCandidate, setCandidateStatus, countAuthoredCandidates,
  type CandidateRecord,
} from './db/candidatesRepo.js';
```

Add the quota constant after `UNSAFE_NAV_APPS` (~line 25):

```typescript
const QUOTA = 8; // max confirmed deep flows per app (spec §3.6)
```

Add the command (place it after `cmdSweep`, before `cmdMap`):

```typescript
export interface JourneysCliOptions { client?: LLMClient; }

export async function cmdJourneys(appName: string, opts: JourneysCliOptions = {}): Promise<{ lines: string[] }> {
  const app = await requireApp(appName);
  const client = opts.client ?? new OpenRouterClient();
  const pages = (await latestSweepPages(app.id)).filter((p) => p.httpStatus >= 200 && p.httpStatus < 400);
  if (pages.length === 0) throw new Error(`No swept pages for "${appName}". Run: vigil sweep ${appName}`);

  const candidates = await classifyJourneys(pages.map((p) => ({ url: p.url, signals: p.signals })), client);
  await upsertCandidates(app.id, candidates.map((c) => ({
    name: c.name, entryUrl: c.entryUrl, recommended: c.recommended, feasibilityHint: c.feasibilityHint,
  })));

  const all = await listCandidates(app.id);
  const authored = await countAuthoredCandidates(app.id);
  const lines = [`${appName}: ${all.length} deep journey candidate(s); ${authored}/${QUOTA} watched. ★ = recommended, ⚠ = needs setup.`];
  for (const c of all) {
    const star = c.recommended ? '★' : ' ';
    const warn = c.feasibilityHint ? `  ⚠ ${c.feasibilityHint}` : '';
    lines.push(`${star} [${c.status}] ${c.id}  ${c.name}  → ${c.entryUrl}${warn}`);
  }
  lines.push(`Select up to ${QUOTA}: vigil journeys:select ${appName} <id> [<id> ...]`);
  for (const l of lines) console.log(l);
  return { lines };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test cliJourneys`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/cli.ts packages/engine/test/cliJourneys.test.ts
git commit -m "feat: vigil journeys command — classify sweep into deep candidates

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Lazy authoring — `journeys:select` / `journeys:author` + fallback + quota

**Files:**
- Modify: `packages/engine/src/cli.ts`
- Test: `packages/engine/test/cliJourneysSelect.test.ts`

**Interfaces:**
- Consumes: `MapSession`, `mapApp`, `verifyWithCorrection`, `addFlow`, `getCandidate`/`setCandidateStatus`/`countAuthoredCandidates`/`listCandidates`/`upsertCandidates`, `QUOTA`, `CandidateRecord`, `AppRecord`.
- Produces:
  - `interface SelectCliOptions extends JourneysCliOptions { maxSteps?: number; stepTimeoutMs?: number }`
  - `cmdJourneysSelect(appName: string, ids: string[], opts?: SelectCliOptions): Promise<{ lines: string[] }>`
  - `cmdJourneysAuthor(appName: string, id: string, opts?: SelectCliOptions): Promise<{ lines: string[] }>`

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/cliJourneysSelect.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, getAppByName } from '../src/db/appsRepo.js';
import { listConfirmedFlows } from '../src/db/flowsRepo.js';
import { upsertCandidates, listCandidates, setCandidateStatus } from '../src/db/candidatesRepo.js';
import { cmdAppAdd, cmdJourneysSelect } from '../src/cli.js';
import { FakeLLMClient, type LLMResponse } from '../src/map/llmClient.js';

const FOUNDER = process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local';
let server: Server; let url: string;
beforeAll(async () => { await migrate(); ({ server, url } = await startFixture()); });
afterAll(async () => { await closePool(); await new Promise<void>((r) => server.close(() => r())); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings, journey_candidates cascade');
  await fetch(`${url}/__reset`, { method: 'POST' });
});

const loginFlowJson = {
  name: 'login',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/login' } },
    { id: 's2', action: { kind: 'fill', selector: '#email', value: '{{email}}', description: 'email' } },
    { id: 's3', action: { kind: 'fill', selector: '#password', value: '{{password}}', description: 'password' } },
    { id: 's4', action: { kind: 'click', selector: 'button[type="submit"]', description: 'Sign in' } },
    { id: 's5', action: { kind: 'expect_url', pattern: '/dashboard$' } },
  ],
};

async function appId(): Promise<string> {
  return (await getAppByName(await ensureUser(FOUNDER), 'demo'))!.id;
}

describe('cmdJourneysSelect', () => {
  it('lazily authors a selected candidate into a watched flow', async () => {
    await cmdAppAdd({ name: 'demo', url, loginEmail: 'demo@example.com', loginPassword: 'demo-pass' });
    const id = await appId();
    await upsertCandidates(id, [{ name: 'login', entryUrl: `${url}/login`, recommended: true }]);
    const candidateId = (await listCandidates(id))[0]!.id;

    // mapApp: propose the login flow, then end_turn. verifyWithCorrection passes (no extra call).
    const script: LLMResponse[] = [
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_flows', input: { flows: [loginFlowJson] } }] },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ];
    const { lines } = await cmdJourneysSelect('demo', [candidateId], { client: new FakeLLMClient(script), maxSteps: 5 });

    expect(lines.join('\n')).toContain('✅');
    expect((await listConfirmedFlows(id)).map((f) => f.goldenPath.name)).toEqual(['login']);
    expect((await listCandidates(id))[0]!.status).toBe('authored');
  });

  it('routes an unbuildable candidate to needs_info (fallback)', async () => {
    await cmdAppAdd({ name: 'demo', url });
    const id = await appId();
    await upsertCandidates(id, [{ name: 'mystery', entryUrl: `${url}/about`, recommended: false }]);
    const candidateId = (await listCandidates(id))[0]!.id;

    // mapApp returns no proposals (end_turn immediately) → authoring fails.
    const script: LLMResponse[] = [{ stopReason: 'end_turn', content: [{ type: 'text', text: 'nothing' }] }];
    const { lines } = await cmdJourneysSelect('demo', [candidateId], { client: new FakeLLMClient(script), maxSteps: 2 });

    expect(lines.join('\n')).toContain('needs info');
    expect((await listCandidates(id))[0]!.status).toBe('needs_info');
  });

  it('rejects selections that exceed the quota before authoring', async () => {
    await cmdAppAdd({ name: 'demo', url });
    const id = await appId();
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `j${i}`, entryUrl: `${url}/p${i}`, recommended: false }));
    await upsertCandidates(id, [...many, { name: 'extra', entryUrl: `${url}/extra`, recommended: false }]);
    const all = await listCandidates(id);
    for (const c of all.filter((c) => c.name !== 'extra')) await setCandidateStatus(id, c.id, 'authored');
    const extraId = all.find((c) => c.name === 'extra')!.id;

    // client never used: quota check throws before authoring.
    await expect(cmdJourneysSelect('demo', [extraId], { client: new FakeLLMClient([]) })).rejects.toThrow(/quota/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test cliJourneysSelect`
Expected: FAIL — `cmdJourneysSelect` is not exported.

- [ ] **Step 3: Implement the helper and commands**

In `packages/engine/src/cli.ts`, add after `cmdJourneys`:

```typescript
/** Lazily author one candidate's executable steps via the targeted mapper, verify
 *  it, and on success persist it as a confirmed flow. Returns the outcome; does not
 *  mutate candidate status (the caller does, so select/author share this). */
async function authorCandidate(
  app: AppRecord, candidate: CandidateRecord, client: LLMClient,
  opts: { maxSteps?: number; stepTimeoutMs?: number },
): Promise<{ verified: boolean; note: string | null }> {
  const session = new MapSession(app.productionUrl);
  await session.start();
  let proposals: Awaited<ReturnType<typeof mapApp>>;
  try {
    let path = candidate.entryUrl;
    try { path = new URL(candidate.entryUrl).pathname; } catch { /* keep raw */ }
    proposals = await mapApp(session, client, {
      credentials: app.credentials ?? undefined,
      maxSteps: opts.maxSteps,
      targetJourney: `${candidate.name} (the journey starting at ${path})`,
    });
  } finally {
    await session.close();
  }
  if (proposals.length === 0) return { verified: false, note: 'could not author steps' };

  const { flow, verified, note } = await verifyWithCorrection(proposals[0]!, client, {
    baseUrl: app.productionUrl, credentials: app.credentials ?? undefined, stepTimeoutMs: opts.stepTimeoutMs,
  });
  if (!verified) return { verified: false, note: note ?? 'verification failed' };

  try {
    await addFlow(app.id, flow, 'confirmed', { verified: true, source: 'mapped' });
  } catch (e) {
    if ((e as { code?: string }).code !== '23505') throw e; // duplicate name → already watched, treat as authored
  }
  return { verified: true, note: null };
}

export interface SelectCliOptions extends JourneysCliOptions { maxSteps?: number; stepTimeoutMs?: number; }

export async function cmdJourneysSelect(appName: string, ids: string[], opts: SelectCliOptions = {}): Promise<{ lines: string[] }> {
  const app = await requireApp(appName);
  const client = opts.client ?? new OpenRouterClient();
  const authored = await countAuthoredCandidates(app.id);
  if (authored + ids.length > QUOTA) {
    throw new Error(`Quota is ${QUOTA} deep flows; you have ${authored} and tried to add ${ids.length}. Pick fewer.`);
  }

  const lines: string[] = [];
  for (const id of ids) {
    const candidate = await getCandidate(app.id, id);
    if (!candidate) { lines.push(`✗ ${id} — no such candidate`); continue; }
    await setCandidateStatus(app.id, id, 'selected');
    const res = await authorCandidate(app, candidate, client, opts);
    if (res.verified) {
      await setCandidateStatus(app.id, id, 'authored');
      lines.push(`✅ ${candidate.name} — built & now watched`);
    } else {
      await setCandidateStatus(app.id, id, 'needs_info', res.note ?? undefined);
      lines.push(`⚠ ${candidate.name} — needs info (${res.note}). Add details, then: vigil journeys:author ${appName} ${id}`);
    }
  }
  for (const l of lines) console.log(l);
  return { lines };
}

export async function cmdJourneysAuthor(appName: string, id: string, opts: SelectCliOptions = {}): Promise<{ lines: string[] }> {
  return cmdJourneysSelect(appName, [id], opts);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test cliJourneysSelect`
Expected: PASS (all three cases).

- [ ] **Step 5: Wire the commander commands**

In `packages/engine/src/cli.ts`, inside the `if (process.argv[1] === ...)` block, add after the `map` command (~line 266):

```typescript
  program.command('journeys').argument('<app>')
    .description('classify the latest sweep into selectable deep journeys')
    .action(async (app) => { await cmdJourneys(app); });
  program.command('journeys:select').argument('<app>').argument('<ids...>')
    .description('author + watch the selected deep journeys (up to the quota)')
    .action(async (app, ids) => { await cmdJourneysSelect(app, ids); });
  program.command('journeys:author').argument('<app>').argument('<id>')
    .description('retry authoring a needs-info journey after adding credentials')
    .action(async (app, id) => { await cmdJourneysAuthor(app, id); });
```

- [ ] **Step 6: Run the full engine test suite**

Run: `pnpm --filter @vigil/engine test`
Expected: PASS — all suites green (new + existing).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @vigil/engine typecheck`
Expected: no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/cli.ts packages/engine/test/cliJourneysSelect.test.ts
git commit -m "feat: vigil journeys:select/author — lazy authoring with needs-info fallback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §3.1 crawler enrichment → Task 1 (`PageSignals`, capture). *Refinement:* spec's `authGated` is realized as the observable `hasPasswordField` plus form/input/button counts; same intent (auth/interactivity detection), cleanly capturable read-only.
- §3.2 classifier → Task 5 (`classifyJourneys`, deep-only, recommend + hint, never gates).
- §3.3 `journey_candidates` table + lifecycle → Task 2 (schema) + Task 4 (repo; statuses `open/selected/needs_info/authored/dismissed`).
- §3.4 lazy authoring via `mapApp({ targetJourney })` + verify + `confirmed`/`verified` lifecycle → Task 7 (`authorCandidate`).
- §3.5 needs-info fallback → Task 7 (failure → `needs_info` with hint; `journeys:author` retry).
- §3.6 quota = 8 → Task 6 (`QUOTA`) + Task 7 (enforced before authoring).
- §4 CLI surface (`journeys`, `journeys:select`, `journeys:author`) → Tasks 6 & 7.
- §6 data flow (sweep stores signals → journeys lists → select authors → nightly check watches) → Tasks 1,3,6,7. Nightly `check` already watches confirmed flows (unchanged).
- §7 testing → each task is TDD with the specified fixtures.
- `dismissed` status: defined in schema/type for completeness; no command sets it yet (YAGNI — not in §4). Not a gap.

**Placeholder scan:** none — every step has concrete code/commands and expected output.

**Type consistency:** `PageSignals` (Task 1) consumed by Tasks 3 & 5; `ClassifiablePage` (Task 3) shape `{url,httpStatus,signals}` mapped to `ClassifierPage` `{url,signals}` in Task 6; `CandidateRecord`/`CandidateInput`/`CandidateStatus` (Task 4) used by Tasks 6 & 7; `JourneysCliOptions` (Task 6) extended by `SelectCliOptions` (Task 7); `QUOTA` defined in Task 6, used in Tasks 6 & 7. `mapApp`/`verifyWithCorrection`/`addFlow`/`MapSession` signatures match current `cli.ts` usage.
