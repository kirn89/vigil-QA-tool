# Vigil Flow Verification + Human Journey-Add (Plan 1c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every flow trustworthy: no flow is watched until it has been **replayed from scratch and passed**, regardless of source. Mapped proposals are auto-verified (hallucinated ones flagged `unverified`, never silently dropped); a human can add a missed journey by plain-English description or hand-written steps; all of it passes the same verification gate before it can be confirmed.

**Architecture:** A `verifyFlow` helper replays a single golden path in a fresh browser (reusing the existing `replayFlow`) and returns pass/fail + a failing-step note — zero LLM cost. `flows` gains `verified` / `verification_note` / `source` columns (migration 002). `cmdMap` verifies each proposal; `cmdFlowDescribe` maps one journey from a description; `cmdFlowAdd` verifies hand-written flows before confirming; `confirmFlow` refuses to confirm an `unverified` flow without `--force`. Spec: `docs/superpowers/specs/2026-06-11-vigil-app-watcher-design.md` §6.3. Out of scope (Plan 1c phase 2 / later): the auto-self-correction loop that feeds replay failures back to the LLM.

**Tech Stack:** Existing `@vigil/engine` (Node 20, TS ESM, Playwright, pg, Vitest, embedded-postgres) + the Plan-1b map module (`src/map/*`, OpenRouter via the `openai` SDK). No new deps.

**Conventions:** tests under `packages/engine/test`; run one file with `pnpm --filter @vigil/engine test -- <name>`. Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (omitted below — always append). **The local `pnpm db:dev` must NOT be running while tests run** — its port 54329 collides with the test globalSetup's embedded Postgres. Stop it before testing.

---

## File structure (end state of this plan)

```
packages/engine/
  migrations/002_flow_verification.sql   # NEW: verified, verification_note, source columns
  src/
    map/verify.ts                        # NEW: verifyFlow() — fresh-browser replay → {verified, note?}
    map/mapper.ts                        # MODIFY: MapOptions gains targetJourney?; kickoff uses it
    db/flowsRepo.ts                      # MODIFY: FlowRecord fields; addFlow opts; list returns; confirmFlow guard
    cli.ts                               # MODIFY: cmdMap verifies; cmdFlowAdd verifies; cmdFlowDescribe; report; --force
  test/
    flowVerifyRepo.test.ts               # NEW: verified/source persistence + confirmFlow guard
    verifyFlow.test.ts                   # NEW: verifyFlow against fixture
    flowDescribe.test.ts                 # NEW: cmdFlowDescribe + cmdFlowAdd verification (FakeLLMClient + fixture)
```

`flows.status` stays `proposed/confirmed/paused`; verification is orthogonal (`verified` bool). Migration 002 backfills existing confirmed rows to `verified = true` (they were already trusted).

---

### Task 1: Migration 002 + flowsRepo verification fields & confirm guard

**Files:**
- Create: `packages/engine/migrations/002_flow_verification.sql`
- Modify: `packages/engine/src/db/flowsRepo.ts`
- Test: `packages/engine/test/flowVerifyRepo.test.ts`

- [ ] **Step 1: Write the migration**

`packages/engine/migrations/002_flow_verification.sql`:
```sql
alter table flows add column verified boolean not null default false;
alter table flows add column verification_note text;
alter table flows add column source text not null default 'manual'
  check (source in ('mapped', 'described', 'manual'));

-- Existing confirmed flows were already trusted/watched.
update flows set verified = true where status = 'confirmed';
```

- [ ] **Step 2: Write the failing test**

`packages/engine/test/flowVerifyRepo.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, createApp } from '../src/db/appsRepo.js';
import { addFlow, listProposedFlows, listConfirmedFlows, confirmFlow } from '../src/db/flowsRepo.js';

let appId: string;
beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings cascade');
  const userId = await ensureUser('founder@vigil.test');
  appId = (await createApp({ userId, name: 'demo', productionUrl: 'http://x.test', previewUrl: null, credentials: null })).id;
});

const flow = (name: string) => ({ name, steps: [{ id: 's1', action: { kind: 'goto', path: '/' } }] });

describe('flow verification fields', () => {
  it('persists verified/verificationNote/source and reads them back', async () => {
    await addFlow(appId, flow('a'), 'proposed', { verified: true, source: 'mapped' });
    await addFlow(appId, flow('b'), 'proposed', { verified: false, verificationNote: 'step s2: no match', source: 'described' });
    const proposed = await listProposedFlows(appId);
    const a = proposed.find((f) => f.goldenPath.name === 'a')!;
    const b = proposed.find((f) => f.goldenPath.name === 'b')!;
    expect(a.verified).toBe(true);
    expect(a.source).toBe('mapped');
    expect(b.verified).toBe(false);
    expect(b.verificationNote).toBe('step s2: no match');
    expect(b.source).toBe('described');
  });

  it('defaults verified=false and source=manual when not given', async () => {
    await addFlow(appId, flow('c'), 'proposed');
    const c = (await listProposedFlows(appId)).find((f) => f.goldenPath.name === 'c')!;
    expect(c.verified).toBe(false);
    expect(c.source).toBe('manual');
  });

  it('confirmFlow refuses to confirm an unverified flow without force', async () => {
    await addFlow(appId, flow('d'), 'proposed', { verified: false, source: 'mapped' });
    const res = await confirmFlow(appId, 'd');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/unverified/i);
    expect(await listConfirmedFlows(appId)).toEqual([]);
  });

  it('confirmFlow confirms a verified flow, or an unverified one with force', async () => {
    await addFlow(appId, flow('e'), 'proposed', { verified: true, source: 'mapped' });
    expect((await confirmFlow(appId, 'e')).ok).toBe(true);
    await addFlow(appId, flow('f'), 'proposed', { verified: false, source: 'mapped' });
    expect((await confirmFlow(appId, 'f', { force: true })).ok).toBe(true);
    expect((await listConfirmedFlows(appId)).map((x) => x.goldenPath.name).sort()).toEqual(['e', 'f']);
  });
});
```

- [ ] **Step 3: Run → FAIL** — stop `pnpm db:dev` first if running, then `pnpm --filter @vigil/engine test -- flowVerifyRepo` (migration column missing / addFlow signature / confirmFlow shape).

- [ ] **Step 4: Update `packages/engine/src/db/flowsRepo.ts`.** Read it first. Make these changes:

Extend `FlowRecord`:
```ts
export interface FlowRecord {
  id: string; appId: string; status: string; version: number; goldenPath: GoldenPath;
  verified: boolean; verificationNote: string | null; source: string;
}
```

Replace `addFlow` with an overload accepting verification options:
```ts
export interface AddFlowOptions { verified?: boolean; verificationNote?: string | null; source?: 'mapped' | 'described' | 'manual'; }

export async function addFlow(
  appId: string, goldenPath: unknown, status: 'proposed' | 'confirmed' = 'confirmed', opts: AddFlowOptions = {},
): Promise<FlowRecord> {
  const parsed = goldenPathSchema.parse(goldenPath);
  const verified = opts.verified ?? false;
  const note = opts.verificationNote ?? null;
  const source = opts.source ?? 'manual';
  const { rows } = await getPool().query<{ id: string; version: number }>(
    `insert into flows (app_id, name, status, golden_path, verified, verification_note, source)
     values ($1, $2, $3, $4, $5, $6, $7) returning id, version`,
    [appId, parsed.name, status, JSON.stringify(parsed), verified, note, source]);
  return { id: rows[0]!.id, appId, status, version: rows[0]!.version, goldenPath: parsed, verified, verificationNote: note, source };
}
```

Update BOTH `listConfirmedFlows` and `listProposedFlows` to select and return the new columns. For each, change the query column list to include `verified, verification_note, source` and the row mapper to:
```ts
  return rows.map((r) => ({
    id: r.id, appId: r.app_id, status: r.status, version: r.version,
    goldenPath: goldenPathSchema.parse(r.golden_path),
    verified: r.verified, verificationNote: r.verification_note, source: r.source,
  }));
```
(Widen each query's row generic to include `verified: boolean; verification_note: string | null; source: string`.)

Replace `confirmFlow` with the guarded version (return type changes from `boolean` to a result object):
```ts
export interface ConfirmResult { ok: boolean; reason?: string; }

export async function confirmFlow(appId: string, name: string, opts: { force?: boolean } = {}): Promise<ConfirmResult> {
  const { rows } = await getPool().query<{ verified: boolean }>(
    `select verified from flows where app_id = $1 and name = $2 and status = 'proposed'`, [appId, name]);
  if (rows.length === 0) return { ok: false, reason: 'no such proposed flow' };
  if (!rows[0]!.verified && !opts.force) return { ok: false, reason: 'unverified — re-map/fix it or confirm with --force' };
  await getPool().query(`update flows set status = 'confirmed' where app_id = $1 and name = $2 and status = 'proposed'`, [appId, name]);
  return { ok: true };
}
```

- [ ] **Step 5: Run → PASS** — `pnpm --filter @vigil/engine test -- flowVerifyRepo` (4 tests).

- [ ] **Step 6: Fix the now-broken callers/tests.** `confirmFlow`'s return type changed and the unverified-confirm guard is new. Two existing spots break:
  - `packages/engine/test/flowsRepoProposed.test.ts` (Plan 1b): its "confirms a proposed flow" test adds an unverified proposed flow then calls `confirmFlow` expecting success. Update that test to add the flow as verified: change its `addFlow(appId, flow('login'), 'proposed')` to `addFlow(appId, flow('login'), 'proposed', { verified: true, source: 'mapped' })`, and where it asserts the boolean result, assert `.ok`. Run `pnpm --filter @vigil/engine test -- flowsRepoProposed` → PASS.
  - `packages/engine/src/cli.ts` `cmdFlowConfirm` calls `confirmFlow(app.id, flowName)` and treats the result as a boolean (`ok ? ... : ...`). It will be fixed in Task 3 — for now, make it compile by reading the new shape: change `const ok = await confirmFlow(...)` to `const res = await confirmFlow(app.id, flowName);` and `console.log(res.ok ? 'Confirmed ...' : 'Could not confirm: ' + res.reason)`. (Task 3 adds `--force`.) Also `packages/engine/test/cliMap.test.ts` calls `cmdFlowConfirm('demo', 'login')` after a map — that map proposal will be `verified=false` until Task 3 wires verification, so this test may now fail at confirm. Task 3 updates cliMap; if it fails here, leave it red and note it — Task 3 makes it green. (Do NOT weaken it.) Run `pnpm --filter @vigil/engine typecheck` → clean.

- [ ] **Step 7: Commit**
```bash
git add packages/engine
git commit -m "feat: flow verification columns + confirm-guard (migration 002, flowsRepo)"
```

---

### Task 2: verifyFlow helper

**Files:**
- Create: `packages/engine/src/map/verify.ts`
- Test: `packages/engine/test/verifyFlow.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/verifyFlow.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { goldenPathSchema } from '../src/flows/goldenPath.js';
import { verifyFlow } from '../src/map/verify.js';

let server: Server;
let url: string;
let artifactsDir: string;

beforeAll(async () => {
  ({ server, url } = await startFixture());
  artifactsDir = await mkdtemp(join(tmpdir(), 'vigil-verify-'));
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(async () => { await fetch(`${url}/__reset`, { method: 'POST' }); });

const creds = { email: 'demo@example.com', password: 'demo-pass' };
const goodLogin = goldenPathSchema.parse({
  name: 'login',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/login' } },
    { id: 's2', action: { kind: 'fill', selector: '#email', value: '{{email}}', description: 'email' } },
    { id: 's3', action: { kind: 'fill', selector: '#password', value: '{{password}}', description: 'password' } },
    { id: 's4', action: { kind: 'click', selector: 'button[type="submit"]', description: 'submit' } },
    { id: 's5', action: { kind: 'expect_url', pattern: '/dashboard$' } },
  ],
});
const hallucinated = goldenPathSchema.parse({
  name: 'contact',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/contact' } },
    { id: 's2', action: { kind: 'fill', selector: '#name', value: 'x', description: 'name (does not exist)' } },
  ],
});

describe('verifyFlow', () => {
  it('verifies a grounded flow (fresh-browser replay passes)', async () => {
    const r = await verifyFlow(goodLogin, { baseUrl: url, credentials: creds, artifactsDir, stepTimeoutMs: 6000 });
    expect(r.verified).toBe(true);
    expect(r.note).toBeUndefined();
  });

  it('flags a hallucinated flow with the failing step in the note', async () => {
    const r = await verifyFlow(hallucinated, { baseUrl: url, artifactsDir, stepTimeoutMs: 4000 });
    expect(r.verified).toBe(false);
    expect(r.note).toMatch(/s2/);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm --filter @vigil/engine test -- verifyFlow` (module not found).

- [ ] **Step 3: Implement** `packages/engine/src/map/verify.ts`:
```ts
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
```

- [ ] **Step 4: Run → PASS** — `pnpm --filter @vigil/engine test -- verifyFlow` (2 tests, real browser). `pnpm --filter @vigil/engine typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add packages/engine
git commit -m "feat: verifyFlow — fresh-browser replay verification of a golden path"
```

---

### Task 3: cmdMap verifies proposals; report + confirm --force surface it

**Files:**
- Modify: `packages/engine/src/cli.ts`
- Test: update `packages/engine/test/cliMap.test.ts`

- [ ] **Step 1: Update the cliMap test** to assert verification. Replace `packages/engine/test/cliMap.test.ts` with:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, getAppByName } from '../src/db/appsRepo.js';
import { listProposedFlows, listConfirmedFlows } from '../src/db/flowsRepo.js';
import { cmdAppAdd, cmdMap, cmdFlowConfirm } from '../src/cli.js';
import { FakeLLMClient, type LLMResponse } from '../src/map/llmClient.js';

let server: Server;
let url: string;
beforeAll(async () => { await migrate(); ({ server, url } = await startFixture()); });
afterAll(async () => { await closePool(); await new Promise<void>((r) => server.close(() => r())); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings cascade');
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
const hallucinatedJson = {
  name: 'broken-contact',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/contact' } },
    { id: 's2', action: { kind: 'fill', selector: '#nope', value: 'x', description: 'missing field' } },
  ],
};

describe('vigil map verifies proposals', () => {
  it('marks a grounded flow verified and a hallucinated one unverified; confirm respects the gate', async () => {
    await cmdAppAdd({ name: 'demo', url, loginEmail: 'demo@example.com', loginPassword: 'demo-pass' });
    const script: LLMResponse[] = [
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_flows', input: { flows: [loginFlowJson, hallucinatedJson] } }] },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ];
    await cmdMap('demo', { client: new FakeLLMClient(script), maxSteps: 5 });

    const userId = await ensureUser(process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local');
    const app = (await getAppByName(userId, 'demo'))!;
    const proposed = await listProposedFlows(app.id);
    const login = proposed.find((f) => f.goldenPath.name === 'login')!;
    const broken = proposed.find((f) => f.goldenPath.name === 'broken-contact')!;
    expect(login.verified).toBe(true);
    expect(login.source).toBe('mapped');
    expect(broken.verified).toBe(false);
    expect(broken.verificationNote).toMatch(/s2/);

    // The verified flow confirms; the unverified one is blocked (then allowed with force).
    await cmdFlowConfirm('demo', 'login');
    expect((await listConfirmedFlows(app.id)).map((f) => f.goldenPath.name)).toEqual(['login']);
    await cmdFlowConfirm('demo', 'broken-contact');
    expect((await listConfirmedFlows(app.id)).map((f) => f.goldenPath.name)).toEqual(['login']); // still blocked
    await cmdFlowConfirm('demo', 'broken-contact', { force: true });
    expect((await listConfirmedFlows(app.id)).map((f) => f.goldenPath.name).sort()).toEqual(['broken-contact', 'login']);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm --filter @vigil/engine test -- cliMap` (cmdMap doesn't verify yet; cmdFlowConfirm has no force param).

- [ ] **Step 3: Update `cmdMap` in `packages/engine/src/cli.ts`.** Add the verify import at the top with the other map imports: `import { verifyFlow } from './map/verify.js';`. In `cmdMap`, replace the persist loop so each proposal is verified first:
```ts
  await deleteProposedFlows(app.id);
  const lines: string[] = [`Mapped ${appName}: ${proposals.length} proposed flow(s).`];
  for (const gp of proposals) {
    const { verified, note } = await verifyFlow(gp, {
      baseUrl: app.productionUrl, credentials: app.credentials ?? undefined, stepTimeoutMs: opts.stepTimeoutMs,
    });
    try {
      await addFlow(app.id, gp, 'proposed', { verified, verificationNote: note ?? null, source: 'mapped' });
      const mark = verified ? '✅ verified' : `⚠️ unverified (${note})`;
      lines.push(`  • ${gp.name} (${gp.steps.length} steps) — ${mark}`);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') lines.push(`  • ${gp.name} — skipped (already exists on ${appName})`);
      else throw e;
    }
  }
  lines.push(`Confirm a verified flow with: vigil flow:confirm ${appName} "<name>"`);
  for (const l of lines) console.log(l);
  return { lines };
```
(Add `stepTimeoutMs` to `MapCliOptions` if not present: `export interface MapCliOptions { client?: LLMClient; maxSteps?: number; stepTimeoutMs?: number; }`.)

- [ ] **Step 4: Update `cmdFlowConfirm`** to accept a force flag and surface the gate:
```ts
export async function cmdFlowConfirm(appName: string, flowName: string, opts: { force?: boolean } = {}): Promise<void> {
  const app = await requireApp(appName);
  const res = await confirmFlow(app.id, flowName, opts);
  console.log(res.ok ? `Confirmed "${flowName}" — it will now be watched.` : `Did not confirm "${flowName}": ${res.reason}`);
}
```

- [ ] **Step 5: Surface verification in `cmdReport`.** In the proposed-flows section of `cmdReport`, change the per-flow line to show status:
```ts
  const proposed = await listProposedFlows(app.id);
  if (proposed.length) {
    lines.push(`# proposed flows (awaiting confirm)`);
    for (const f of proposed) {
      const mark = f.verified ? 'VERIFIED' : `UNVERIFIED (${f.verificationNote ?? 'replay failed'})`;
      lines.push(`PROPOSED ${f.goldenPath.name} — ${mark}`);
    }
  }
```

- [ ] **Step 6: Add `--force` to the commander `flow:confirm` wiring** inside the entry-guard block:
```ts
  program.command('flow:confirm').argument('<app>').argument('<flow>').option('--force')
    .action(async (app, flow, o) => { await cmdFlowConfirm(app, flow, { force: o.force }); });
```
(Replace the existing `flow:confirm` command registration — do not duplicate it.)

- [ ] **Step 7: Run → PASS** — `pnpm --filter @vigil/engine test -- cliMap` (1 test). Full suite `pnpm --filter @vigil/engine test` green. `pnpm --filter @vigil/engine typecheck` clean. Smoke `pnpm vigil flow:confirm --help` shows `--force`.

- [ ] **Step 8: Commit**
```bash
git add packages/engine
git commit -m "feat: cmdMap verifies each proposal; report shows verified/unverified; confirm --force"
```

---

### Task 4: Human journey-add — flow:describe + verified flow:add

**Files:**
- Modify: `packages/engine/src/map/mapper.ts`, `packages/engine/src/cli.ts`
- Test: `packages/engine/test/flowDescribe.test.ts`

- [ ] **Step 1: Add `targetJourney` to the mapper.** In `packages/engine/src/map/mapper.ts`, extend `MapOptions` and `kickoff`:
```ts
export interface MapOptions {
  credentials?: { email: string; password: string };
  maxSteps?: number;
  targetJourney?: string;
}
```
Replace `kickoff` so a target journey focuses the run:
```ts
function kickoff(credentials?: { email: string; password: string }, targetJourney?: string): string {
  const cred = credentials
    ? 'Test credentials are available — fill {{email}} and {{password}} as the login values (do not invent real values).'
    : 'No login credentials are available — map what you can reach logged out.';
  if (targetJourney) {
    return `Map ONE specific journey the user asked for: "${targetJourney}". Explore only as much as needed to perform and capture that one journey (log in first if it requires auth). ${cred} Propose exactly that one flow.`;
  }
  return `Explore this app and map all critical journeys. ${cred}`;
}
```
And in `mapApp`, pass it through: change the initial message to `text: kickoff(opts.credentials, opts.targetJourney)`.

- [ ] **Step 2: Write the failing test** — `packages/engine/test/flowDescribe.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, getAppByName } from '../src/db/appsRepo.js';
import { listProposedFlows, listConfirmedFlows } from '../src/db/flowsRepo.js';
import { cmdAppAdd, cmdFlowDescribe, cmdFlowAdd } from '../src/cli.js';
import { FakeLLMClient, type LLMResponse } from '../src/map/llmClient.js';

let server: Server;
let url: string;
let dir: string;
beforeAll(async () => { await migrate(); ({ server, url } = await startFixture()); dir = await mkdtemp(join(tmpdir(), 'vigil-desc-')); });
afterAll(async () => { await closePool(); await new Promise<void>((r) => server.close(() => r())); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings cascade');
  await fetch(`${url}/__reset`, { method: 'POST' });
});

const aboutFlow = {
  name: 'View About',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/about' } },
    { id: 's2', action: { kind: 'expect_text', text: 'About' } },
  ],
};

describe('human journey-add', () => {
  it('flow:describe maps the requested journey and verifies it (source=described)', async () => {
    await cmdAppAdd({ name: 'demo', url });
    const script: LLMResponse[] = [
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_flows', input: { flows: [aboutFlow] } }] },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ];
    await cmdFlowDescribe('demo', 'view the about page', { client: new FakeLLMClient(script), maxSteps: 5 });
    const userId = await ensureUser(process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local');
    const app = (await getAppByName(userId, 'demo'))!;
    const proposed = await listProposedFlows(app.id);
    expect(proposed).toHaveLength(1);
    expect(proposed[0]!.source).toBe('described');
    expect(proposed[0]!.verified).toBe(true);
  });

  it('flow:add verifies a hand-written flow: a good one is confirmed, a broken one is left unverified-proposed', async () => {
    await cmdAppAdd({ name: 'demo', url });
    const userId = await ensureUser(process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local');
    const app = (await getAppByName(userId, 'demo'))!;

    const goodFile = join(dir, 'about.json');
    await writeFile(goodFile, JSON.stringify(aboutFlow));
    await cmdFlowAdd('demo', goodFile);
    expect((await listConfirmedFlows(app.id)).map((f) => f.goldenPath.name)).toEqual(['View About']);

    const badFile = join(dir, 'bad.json');
    await writeFile(badFile, JSON.stringify({ name: 'Bad', steps: [{ id: 's1', action: { kind: 'goto', path: '/about' } }, { id: 's2', action: { kind: 'expect_text', text: 'This text is not on the page' } }] }));
    await cmdFlowAdd('demo', badFile);
    const bad = (await listProposedFlows(app.id)).find((f) => f.goldenPath.name === 'Bad')!;
    expect(bad.verified).toBe(false);
    expect((await listConfirmedFlows(app.id)).map((f) => f.goldenPath.name)).toEqual(['View About']); // 'Bad' NOT confirmed
  });
});
```

- [ ] **Step 3: Run → FAIL** — `pnpm --filter @vigil/engine test -- flowDescribe` (cmdFlowDescribe missing; cmdFlowAdd doesn't verify).

- [ ] **Step 4: Implement `cmdFlowDescribe` and rework `cmdFlowAdd` in `packages/engine/src/cli.ts`.**

Add `cmdFlowDescribe` (next to `cmdMap`):
```ts
export async function cmdFlowDescribe(appName: string, description: string, opts: MapCliOptions = {}): Promise<{ lines: string[] }> {
  const app = await requireApp(appName);
  const client = opts.client ?? new OpenRouterClient();
  const session = new MapSession(app.productionUrl);
  await session.start();
  let proposals;
  try {
    proposals = await mapApp(session, client, { credentials: app.credentials ?? undefined, maxSteps: opts.maxSteps, targetJourney: description });
  } finally {
    await session.close();
  }
  const lines: string[] = [`Described "${description}" → ${proposals.length} flow(s):`];
  for (const gp of proposals) {
    const { verified, note } = await verifyFlow(gp, { baseUrl: app.productionUrl, credentials: app.credentials ?? undefined, stepTimeoutMs: opts.stepTimeoutMs });
    try {
      await addFlow(app.id, gp, 'proposed', { verified, verificationNote: note ?? null, source: 'described' });
      lines.push(`  • ${gp.name} — ${verified ? '✅ verified' : `⚠️ unverified (${note})`}`);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') lines.push(`  • ${gp.name} — skipped (already exists)`);
      else throw e;
    }
  }
  for (const l of lines) console.log(l);
  return { lines };
}
```

Replace `cmdFlowAdd` so a hand-written flow is verified before it is confirmed:
```ts
export async function cmdFlowAdd(appName: string, file: string): Promise<void> {
  const app = await requireApp(appName);
  const json = JSON.parse(await readFile(file, 'utf8'));
  const parsed = goldenPathSchema.parse(json);
  const { verified, note } = await verifyFlow(parsed, { baseUrl: app.productionUrl, credentials: app.credentials ?? undefined });
  if (verified) {
    await addFlow(app.id, parsed, 'confirmed', { verified: true, source: 'manual' });
    console.log(`Added & verified "${parsed.name}" (${parsed.steps.length} steps) — now watched.`);
  } else {
    await addFlow(app.id, parsed, 'proposed', { verified: false, verificationNote: note ?? null, source: 'manual' });
    console.log(`Added "${parsed.name}" as UNVERIFIED (${note}). Fix it, or confirm with --force if you're sure.`);
  }
}
```
This requires `goldenPathSchema` imported in cli.ts — add `import { goldenPathSchema } from './flows/goldenPath.js';` if not already present (check first). The previous `cmdFlowAdd` used `addFlow(app.id, json, 'confirmed')` directly; replace it fully.

Add the commander wiring for `flow:describe` inside the entry-guard block:
```ts
  program.command('flow:describe').argument('<app>').argument('<description>')
    .action(async (app, description) => { await cmdFlowDescribe(app, description); });
```

- [ ] **Step 5: Run → PASS** — `pnpm --filter @vigil/engine test -- flowDescribe` (2 tests). Full suite `pnpm --filter @vigil/engine test` green. `pnpm --filter @vigil/engine typecheck` clean. Smoke: `pnpm vigil --help` lists `flow:describe`.

- [ ] **Step 6: Commit**
```bash
git add packages/engine
git commit -m "feat: flow:describe (map one journey) + flow:add verifies before confirming"
```

---

### Task 5: Live validation (gated, manual)

No automated test. Needs `OPENROUTER_API_KEY` + the local DB. Confirms the gate works on real proposals.

- [ ] **Step 1: Prereqs** — `pnpm db:dev` (terminal A) + `pnpm migrate` (applies 002) + `export OPENROUTER_API_KEY=... VIGIL_MAP_MODEL=...`. Start the fixture on 4999 (`pnpm --filter @vigil/fixture-app start`) and re-register if needed: `pnpm vigil app:add --name fixturemap --url http://127.0.0.1:4999 --login-email demo@example.com --login-password demo-pass` (skip if it already exists).

- [ ] **Step 2: Re-map the fixture and read the report**
```bash
pnpm vigil map fixturemap
pnpm vigil report fixturemap
```
Exit criterion: grounded flows show `VERIFIED`; any hallucinated flow (like the earlier `#name` contact form) shows `UNVERIFIED` with its failing step — and is NOT confirmable without `--force`. Confirm a verified one and check it replays PASS.

- [ ] **Step 3: Exercise the human-add path**
```bash
pnpm vigil flow:describe fixturemap "complete the onboarding form and submit"   # the orphan route a crawl can't reach
pnpm vigil report fixturemap
```
Exit criterion: the described onboarding journey is mapped and verified (or honestly flagged unverified). This is the proof that a human can add what exploration missed, and the tool validates it.

- [ ] **Step 4: Tag**
```bash
git tag plan-1c-complete
```

---

## Self-review (performed at write time)

1. **Spec coverage (§6.3):** verify-after-map → Task 3; failures surfaced not dropped (unverified + note) → Tasks 1–3; confirm warns/blocks on unverified → Task 1 (guard) + Task 3 (`--force`); human add by description → Task 4 (`flow:describe`); hand-written add verified before watched → Task 4 (`cmdFlowAdd`); same gate every source → verifyFlow used by cmdMap/cmdFlowDescribe/cmdFlowAdd. Auto-self-correction is explicitly OUT (phase 2). Data-model fields (`verified`/`verification_note`/`source`) → Task 1.
2. **Placeholder scan:** Task 5 has runtime placeholders (`OPENROUTER_API_KEY=...`) — intentional. No TBDs.
3. **Type consistency:** `confirmFlow` returns `ConfirmResult {ok, reason?}` (Task 1), consumed by `cmdFlowConfirm` (Task 3) and the flowVerifyRepo/cliMap tests. `addFlow(_, _, status, AddFlowOptions)` (Task 1) called by cmdMap/cmdFlowDescribe/cmdFlowAdd (Tasks 3–4) and the repo test (Task 1). `FlowRecord` gains `verified/verificationNote/source` (Task 1), read in cliMap/flowDescribe tests + cmdReport (Task 3). `verifyFlow(GoldenPath, VerifyOptions) → {verified, note?}` (Task 2) used by cmdMap (Task 3), cmdFlowDescribe + cmdFlowAdd (Task 4). `MapOptions.targetJourney` (Task 4) used by cmdFlowDescribe (Task 4). `replayFlow` signature (pre-existing) reused by verifyFlow. Verified consistent.
