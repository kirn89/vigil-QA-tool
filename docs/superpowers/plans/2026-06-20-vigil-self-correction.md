# Vigil Map Self-Correction (Plan 1d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an LLM-sourced flow fails verification, automatically try once to fix it — re-show the agent the failing step plus a fresh snapshot of the real page, take its corrected flow, and re-verify. A flow that can be auto-fixed becomes verified; one that can't stays flagged `unverified` (no worse than before). Bounded to **one correction round per flow** to cap cost. This is the deferred phase-2 of the §6.3 verification gate.

**Architecture:** `correctFlow` does one LLM round: it opens a fresh `MapSession`, navigates to the page the flow most recently targeted, snapshots the real interactive elements, and asks the model for a corrected version of that one flow (via the existing `propose_flows` tool). `verifyWithCorrection` orchestrates verify → (on fail) correct → re-verify, returning the better result. `cmdMap` and `cmdFlowDescribe` (the LLM-sourced paths) use it instead of bare `verifyFlow`. **`cmdFlowAdd` is deliberately NOT auto-corrected** — a human's hand-written flow is theirs; we flag it, we don't rewrite their intent. Spec: `docs/superpowers/specs/2026-06-11-vigil-app-watcher-design.md` §6.3.

**Known limitation (documented, acceptable):** correction navigates to the flow's last `goto` path to gather context. For a failure on a post-login page, that path viewed in a fresh browser may show the logged-out page — so auth-gated corrections get weaker context (the model still has the flow + error to reason from). It is strictly an improvement (fixes the common selector/assertion-on-a-public-page hallucinations; never makes a flow worse). A richer "replay-to-failure-point" context is a future enhancement.

**Tech Stack:** Existing `@vigil/engine` + the Plan-1b/1c map module (`src/map/*`). No new deps. **`pnpm db:dev` must NOT be running during tests** (port 54329 collides with the test DB).

---

## File structure (end state)

```
packages/engine/
  src/map/
    mapper.ts       # MODIFY: export renderSnapshot (reused by correct.ts)
    correct.ts      # NEW: correctFlow() + verifyWithCorrection()
  src/cli.ts        # MODIFY: cmdMap + cmdFlowDescribe use verifyWithCorrection
  test/
    correctFlow.test.ts   # NEW: correctFlow + verifyWithCorrection (FakeLLMClient + fixture)
    cliMap.test.ts        # MODIFY: a hallucinated flow gets auto-corrected → verified
```

---

### Task 1: correctFlow + verifyWithCorrection

**Files:**
- Modify: `packages/engine/src/map/mapper.ts` (export `renderSnapshot`)
- Create: `packages/engine/src/map/correct.ts`
- Test: `packages/engine/test/correctFlow.test.ts`

- [ ] **Step 1: Export `renderSnapshot` from mapper.ts.** In `packages/engine/src/map/mapper.ts`, change `function renderSnapshot(` to `export function renderSnapshot(`. No other change.

- [ ] **Step 2: Write the failing test** — `packages/engine/test/correctFlow.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { goldenPathSchema } from '../src/flows/goldenPath.js';
import { FakeLLMClient, type LLMResponse } from '../src/map/llmClient.js';
import { correctFlow, verifyWithCorrection } from '../src/map/correct.js';

let server: Server;
let url: string;
beforeAll(async () => ({ server, url } = await startFixture()));
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(async () => { await fetch(`${url}/__reset`, { method: 'POST' }); });

// A hallucinated contact flow: #name does not exist on the fixture's /contact.
const broken = goldenPathSchema.parse({
  name: 'contact',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/contact' } },
    { id: 's2', action: { kind: 'fill', selector: '#name', value: 'x', description: 'nonexistent' } },
  ],
});
// The real /contact has input[name=email] + textarea[name=message]; POST shows "Thanks".
const correctedJson = {
  name: 'contact',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/contact' } },
    { id: 's2', action: { kind: 'fill', selector: 'input[name="email"]', value: 'a@b.c', description: 'email' } },
    { id: 's3', action: { kind: 'fill', selector: 'textarea[name="message"]', value: 'hi', description: 'message' } },
    { id: 's4', action: { kind: 'click', selector: 'button[type="submit"]', description: 'send' } },
    { id: 's5', action: { kind: 'expect_text', text: 'Thanks' } },
  ],
};

describe('correctFlow', () => {
  it('navigates to the failing page, shows the model the real elements, returns the corrected flow', async () => {
    const fake = new FakeLLMClient([
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'propose_flows', input: { flows: [correctedJson] } }] },
    ]);
    const out = await correctFlow(broken, 'step s2: locator.fill timeout', fake, { baseUrl: url });
    expect(out?.name).toBe('contact');
    expect(out?.steps).toHaveLength(5);
    // The correction request must include the failure note and a snapshot of the real /contact page.
    const req = fake.requests[0]!;
    const userText = (req.messages[0]!.content[0] as { text: string }).text;
    expect(userText).toMatch(/s2/);
    expect(userText).toMatch(/name="email"|name="message"/); // real selectors were shown
  });
});

describe('verifyWithCorrection', () => {
  it('returns verified when a first-fail flow is auto-corrected to a passing one', async () => {
    const fake = new FakeLLMClient([
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'propose_flows', input: { flows: [correctedJson] } }] },
    ]);
    const res = await verifyWithCorrection(broken, fake, { baseUrl: url, stepTimeoutMs: 6000 });
    expect(res.verified).toBe(true);
    expect(res.flow.steps).toHaveLength(5); // the corrected flow, not the broken original
    expect(res.note).toBeUndefined();
  });

  it('keeps it unverified (no LLM call) when the flow already passes', async () => {
    const good = goldenPathSchema.parse({
      name: 'about', steps: [
        { id: 's1', action: { kind: 'goto', path: '/about' } },
        { id: 's2', action: { kind: 'expect_text', text: 'About' } },
      ],
    });
    const fake = new FakeLLMClient([]); // must NOT be called — already verifies
    const res = await verifyWithCorrection(good, fake, { baseUrl: url, stepTimeoutMs: 6000 });
    expect(res.verified).toBe(true);
    expect(fake.requests).toHaveLength(0);
  });

  it('stays unverified when correction also fails', async () => {
    const stillBroken = { ...correctedJson, steps: [ { id: 's1', action: { kind: 'goto', path: '/contact' } }, { id: 's2', action: { kind: 'expect_text', text: 'NOT ON PAGE' } } ] };
    const fake = new FakeLLMClient([
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'propose_flows', input: { flows: [stillBroken] } }] },
    ]);
    const res = await verifyWithCorrection(broken, fake, { baseUrl: url, stepTimeoutMs: 4000 });
    expect(res.verified).toBe(false);
    expect(res.note).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run → FAIL** — `pnpm --filter @vigil/engine test -- correctFlow` (module not found).

- [ ] **Step 4: Implement** — `packages/engine/src/map/correct.ts`:
```ts
import { goldenPathSchema, type GoldenPath } from '../flows/goldenPath.js';
import { MapSession } from './browserTools.js';
import { renderSnapshot } from './mapper.js';
import { MAP_TOOLS } from './toolSchemas.js';
import { verifyFlow } from './verify.js';
import type { LLMClient } from './llmClient.js';

const PROPOSE_ONLY = MAP_TOOLS.filter((t) => t.name === 'propose_flows');

const CORRECT_SYSTEM = `You fix ONE broken Vigil golden-path flow. You are given the flow, the exact step that failed when it was replayed in a fresh browser, and the REAL interactive elements on the page where it operates. Produce a corrected version of the SAME journey (same name and intent) using ONLY the durable selectors shown. Ground every assertion in text/urls that actually appear. Use {{email}} / {{password}} for login values. Call propose_flows once with exactly one corrected flow.`;

export interface CorrectOptions {
  baseUrl: string;
  credentials?: { email: string; password: string };
}

/** One LLM round to repair a flow that failed verification. Returns the corrected
 *  GoldenPath, or undefined if the model didn't produce a valid one. */
export async function correctFlow(flow: GoldenPath, failureNote: string, client: LLMClient, opts: CorrectOptions): Promise<GoldenPath | undefined> {
  const gotoPaths = flow.steps.flatMap((s) => (s.action.kind === 'goto' ? [s.action.path] : []));
  const ctxPath = gotoPaths.at(-1) ?? '/';

  const session = new MapSession(opts.baseUrl);
  await session.start();
  let snapshot: string;
  try {
    await session.navigate(ctxPath);
    snapshot = renderSnapshot(await session.snapshot());
  } catch (e) {
    snapshot = `(could not snapshot ${ctxPath}: ${e instanceof Error ? e.message : String(e)})`;
  } finally {
    await session.close();
  }

  const prompt = `This flow failed verification:\n${JSON.stringify(flow, null, 2)}\n\nFailure: ${failureNote}\n\nThe page at "${ctxPath}" actually has these interactive elements:\n${snapshot}\n\nReturn a corrected version of this same journey (keep the name "${flow.name}") using only these real selectors, with assertions grounded in this page.`;

  const resp = await client.createMessage({
    system: CORRECT_SYSTEM,
    tools: PROPOSE_ONLY,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
  });
  for (const block of resp.content) {
    if (block.type === 'tool_use' && block.name === 'propose_flows') {
      const flows = (block.input as { flows?: unknown[] }).flows ?? [];
      const parsed = goldenPathSchema.safeParse(flows[0]);
      if (parsed.success) return parsed.data;
    }
  }
  return undefined;
}

export interface VerifyWithCorrectionResult { flow: GoldenPath; verified: boolean; note?: string; }

export interface VerifyWithCorrectionOptions {
  baseUrl: string;
  credentials?: { email: string; password: string };
  stepTimeoutMs?: number;
}

/** Verify a flow; if it fails, attempt ONE LLM correction and re-verify. Returns the
 *  better of the two (corrected if it now passes, else the corrected-but-still-failing
 *  with its note, else the original failure if correction produced nothing). */
export async function verifyWithCorrection(flow: GoldenPath, client: LLMClient, opts: VerifyWithCorrectionOptions): Promise<VerifyWithCorrectionResult> {
  const first = await verifyFlow(flow, opts);
  if (first.verified) return { flow, verified: true };

  const corrected = await correctFlow(flow, first.note ?? 'did not complete', client, { baseUrl: opts.baseUrl, credentials: opts.credentials });
  if (!corrected) return { flow, verified: false, note: first.note };

  const second = await verifyFlow(corrected, opts);
  return second.verified
    ? { flow: corrected, verified: true }
    : { flow: corrected, verified: false, note: second.note };
}
```

- [ ] **Step 5: Run → PASS** — `pnpm --filter @vigil/engine test -- correctFlow` (4 tests, real browser). `pnpm --filter @vigil/engine typecheck` → clean.

- [ ] **Step 6: Commit**
```bash
git add packages/engine
git commit -m "feat: correctFlow + verifyWithCorrection — one-round LLM repair of failed flows"
```

---

### Task 2: Wire self-correction into cmdMap + cmdFlowDescribe

**Files:**
- Modify: `packages/engine/src/cli.ts`
- Test: update `packages/engine/test/cliMap.test.ts`

- [ ] **Step 1: Update the cliMap test** so the hallucinated flow is auto-corrected to verified. Replace `packages/engine/test/cliMap.test.ts` with:
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
const hallucinatedContact = {
  name: 'contact',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/contact' } },
    { id: 's2', action: { kind: 'fill', selector: '#name', value: 'x', description: 'missing field' } },
  ],
};
const correctedContact = {
  name: 'contact',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/contact' } },
    { id: 's2', action: { kind: 'fill', selector: 'input[name="email"]', value: 'a@b.c', description: 'email' } },
    { id: 's3', action: { kind: 'fill', selector: 'textarea[name="message"]', value: 'hi', description: 'message' } },
    { id: 's4', action: { kind: 'click', selector: 'button[type="submit"]', description: 'send' } },
    { id: 's5', action: { kind: 'expect_text', text: 'Thanks' } },
  ],
};

describe('vigil map self-corrects a failed proposal', () => {
  it('auto-fixes a hallucinated flow so it ends up verified', async () => {
    await cmdAppAdd({ name: 'demo', url, loginEmail: 'demo@example.com', loginPassword: 'demo-pass' });
    // 1-2: mapApp proposes [login, hallucinatedContact] then ends.
    // 3: login verifies first try (no LLM). contact fails → correctFlow consumes this correction response.
    const script: LLMResponse[] = [
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_flows', input: { flows: [loginFlowJson, hallucinatedContact] } }] },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'propose_flows', input: { flows: [correctedContact] } }] },
    ];
    await cmdMap('demo', { client: new FakeLLMClient(script), maxSteps: 5 });

    const userId = await ensureUser(process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local');
    const app = (await getAppByName(userId, 'demo'))!;
    const proposed = await listProposedFlows(app.id);
    const login = proposed.find((f) => f.goldenPath.name === 'login')!;
    const contact = proposed.find((f) => f.goldenPath.name === 'contact')!;
    expect(login.verified).toBe(true);
    expect(contact.verified).toBe(true);              // was hallucinated, auto-corrected
    expect(contact.goldenPath.steps).toHaveLength(5); // the corrected version was persisted

    // Both confirm without --force (both verified now).
    await cmdFlowConfirm('demo', 'contact');
    expect((await listConfirmedFlows(app.id)).map((f) => f.goldenPath.name)).toEqual(['contact']);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm --filter @vigil/engine test -- cliMap` (cmdMap doesn't correct yet; contact stays unverified).

- [ ] **Step 3: Edit `packages/engine/src/cli.ts`.** Replace the `verifyFlow` import usage in the LLM-sourced commands with `verifyWithCorrection`:

(a) Add the import: `import { verifyWithCorrection } from './map/correct.js';` (keep the existing `verifyFlow` import — it's still used by `cmdFlowAdd`).

(b) In `cmdMap`, change the per-proposal verify+persist to use correction:
```ts
  for (const gp of proposals) {
    const { flow: finalFlow, verified, note } = await verifyWithCorrection(gp, client, {
      baseUrl: app.productionUrl, credentials: app.credentials ?? undefined, stepTimeoutMs: opts.stepTimeoutMs,
    });
    try {
      await addFlow(app.id, finalFlow, 'proposed', { verified, verificationNote: note ?? null, source: 'mapped' });
      const mark = verified ? '✅ verified' : `⚠️ unverified (${note})`;
      lines.push(`  • ${finalFlow.name} (${finalFlow.steps.length} steps) — ${mark}`);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') lines.push(`  • ${finalFlow.name} — skipped (already exists on ${appName})`);
      else throw e;
    }
  }
```
(Keep the surrounding `await deleteProposedFlows(app.id);`, the `lines` header, and the trailing confirm hint unchanged.)

(c) In `cmdFlowDescribe`, make the same swap — replace its `verifyFlow(gp, ...)` call with:
```ts
    const { flow: finalFlow, verified, note } = await verifyWithCorrection(gp, client, {
      baseUrl: app.productionUrl, credentials: app.credentials ?? undefined, stepTimeoutMs: opts.stepTimeoutMs,
    });
    try {
      await addFlow(app.id, finalFlow, 'proposed', { verified, verificationNote: note ?? null, source: 'described' });
      lines.push(`  • ${finalFlow.name} — ${verified ? '✅ verified' : `⚠️ unverified (${note})`}`);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') lines.push(`  • ${finalFlow.name} — skipped (already exists)`);
      else throw e;
    }
```
(Leave `cmdFlowAdd` using bare `verifyFlow` — hand-written flows are not auto-rewritten.)

- [ ] **Step 4: Run → PASS** — `pnpm --filter @vigil/engine test -- cliMap` (1 test). Full suite `pnpm --filter @vigil/engine test` → ALL green. `pnpm --filter @vigil/engine typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add packages/engine
git commit -m "feat: cmdMap + cmdFlowDescribe auto-correct failed flows before persisting"
```

---

### Task 3: Live validation (gated, manual)

- [ ] **Step 1: Prereqs** — `pnpm db:dev` + `pnpm migrate` + `export OPENROUTER_API_KEY=... VIGIL_MAP_MODEL=...`; fixture on 4999; register a fresh app (e.g. `selfcorrect` → http://127.0.0.1:4999, demo creds).

- [ ] **Step 2: Map and observe correction**
```bash
pnpm vigil map selfcorrect
pnpm vigil report selfcorrect
```
Exit criterion: any flow the model initially gets wrong (e.g. a Contact form with a fabricated field) is shown as `✅ verified` in the final output because correction repaired it — or honestly `⚠️ unverified` if correction couldn't (no worse than before). Because the LLM is non-deterministic this can't be forced; the deterministic proof is the automated cliMap test. Note the per-flow token cost of corrections.

- [ ] **Step 3: Tag** — `git tag plan-1d-complete`.

---

## Self-review (performed at write time)

1. **Spec coverage (§6.3 phase-2):** auto-revisit on failure (feed failure + fresh snapshot back, one bounded round) → Task 1 (`correctFlow`); applied to LLM-sourced flows (mapped + described), NOT hand-written → Task 2 (cmdMap + cmdFlowDescribe use it; cmdFlowAdd unchanged); a flow that can't be fixed stays `unverified` → `verifyWithCorrection` returns the failing result; bounded cost (exactly one correction LLM call per failed flow, none for flows that pass first try) → tested ("no LLM call when already passes").
2. **Placeholder scan:** Task 3 has runtime placeholders (`OPENROUTER_API_KEY=...`) — intentional. No TBDs.
3. **Type consistency:** `correctFlow(GoldenPath, string, LLMClient, CorrectOptions) → GoldenPath | undefined` and `verifyWithCorrection(GoldenPath, LLMClient, VerifyWithCorrectionOptions) → {flow, verified, note?}` (Task 1) consumed by cmdMap + cmdFlowDescribe (Task 2). Reuses `verifyFlow` (Plan 1c), `renderSnapshot` (exported from mapper, Task 1), `MapSession` (1b), `MAP_TOOLS` propose_flows (1b), `goldenPathSchema`/`GoldenPath`, `addFlow` AddFlowOptions (1c). `FakeLLMClient` request-recording (1b) used by the correctFlow test to assert the snapshot+note reached the model. Verified consistent.
