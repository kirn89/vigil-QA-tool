# Vigil LLM Mapper (Plan 1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hand-written golden paths with auto-discovery: a Claude (Sonnet 4.6) agent drives Playwright over an accessibility-tree tool surface to explore a registered app and propose `GoldenPath` flows, persisted as `status='proposed'` for the founder to confirm — plus the sweep post-login-seed coverage fix from spec §6.2.

**Architecture:** LLM + tool use with a **manual agentic loop**, Playwright hosted on our own runner. The model is reached through **OpenRouter** (founder's choice) via its OpenAI-compatible endpoint, behind a small provider-neutral `LLMClient` interface — so the loop is tested deterministically with a scripted fake, the browser tools are tested with real Playwright against the existing `@vigil/fixture-app`, and only the final live run needs an API key. Proposed flows are validated by the **existing `goldenPathSchema`** before persistence. Spec: `docs/superpowers/specs/2026-06-11-vigil-app-watcher-design.md` §6.1, §6.2.

> **Provider note:** we call a Claude (Sonnet-class) model, but through **OpenRouter**, not the Anthropic API directly. OpenRouter is OpenAI-compatible, so the real client uses the `openai` SDK pointed at `https://openrouter.ai/api/v1` and adapts OpenAI-style tool calls to/from our neutral `ContentBlock` shape. The `LLMClient` interface, `FakeLLMClient`, and the entire agent loop are unchanged by this choice — only the one concrete client differs. The model is env-configurable (`VIGIL_MAP_MODEL`).

**Tech Stack:** Existing `@vigil/engine` (Node 20, TypeScript ESM, Playwright, pg, Vitest, embedded-postgres), plus the `openai` SDK (used against OpenRouter). Model via `VIGIL_MAP_MODEL` (default `anthropic/claude-sonnet-4.5`). **MVP simplification:** no extended-thinking handling — the manual loop only replays `text`/`tool_use` blocks; OpenAI-style chat completions return plain assistant text + tool calls, which maps cleanly.

**Conventions:** all map code under `packages/engine/src/map/`. Tests under `packages/engine/test/`. Run a single test file with `pnpm --filter @vigil/engine test -- <name>`. Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (omitted below for brevity — always append it). The local DB (`pnpm db:dev`, embedded PG on 54329) must be importable by the test globalSetup, which already boots it.

---

## File structure (end state of this plan)

```
packages/engine/
  src/
    env.ts                       # MODIFY: widen union to include OPENROUTER_API_KEY
    map/
      browserTools.ts            # MapSession: Playwright tool surface + computeSelector + snapshot
      toolSchemas.ts             # Tool definitions (navigate/snapshot/click/fill/select/read_state/propose_flows)
      llmClient.ts               # LLMClient interface, ContentBlock types, OpenRouterClient impl, FakeLLMClient
      mapper.ts                  # mapApp(): the manual agentic loop + proposal validation
    db/flowsRepo.ts              # MODIFY: listProposedFlows, confirmFlow, deleteProposedFlows
    sweep/crawler.ts             # MODIFY: seed crawl from post-login landing URL (§6.2 gap 1)
    cli.ts                       # MODIFY: cmdMap, cmdFlowConfirm; report lists proposed; commander wiring
  test/
    browserTools.test.ts
    mapper.test.ts
    flowsRepoProposed.test.ts
    crawlerLogin.test.ts
    cliMap.test.ts
```

No new DB migration — `flows.status` already includes `'proposed'` (migration 001). The `propose_flows` output reuses the existing `goldenPathSchema` (including the `select`/`upload` primitives already added).

---

### Task 1: OpenAI SDK (for OpenRouter) dependency + env widening

**Files:**
- Modify: `packages/engine/package.json` (add dependency), `packages/engine/src/env.ts`
- Test: `packages/engine/test/env.test.ts`

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter @vigil/engine add openai
```
(We call a Claude model *through OpenRouter*, which is OpenAI-compatible — hence the `openai` SDK, not `@anthropic-ai/sdk`.)

- [ ] **Step 2: Write the failing test**

`packages/engine/test/env.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../src/env.js';

const KEY = 'OPENROUTER_API_KEY';
const original = process.env[KEY];
afterEach(() => { if (original === undefined) delete process.env[KEY]; else process.env[KEY] = original; });

describe('env', () => {
  it('reads OPENROUTER_API_KEY when set', () => {
    process.env[KEY] = 'sk-or-test-123';
    expect(env('OPENROUTER_API_KEY')).toBe('sk-or-test-123');
  });
  it('throws a helpful error when a required var is missing', () => {
    delete process.env[KEY];
    expect(() => env('OPENROUTER_API_KEY')).toThrow(/OPENROUTER_API_KEY/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test -- env`
Expected: FAIL — `env('OPENROUTER_API_KEY')` is a type error / the union doesn't include the key.

- [ ] **Step 4: Widen the env union**

In `packages/engine/src/env.ts`, change the function signature line:
```ts
export function env(name: 'DATABASE_URL' | 'VIGIL_SECRET_KEY'): string {
```
to:
```ts
export function env(name: 'DATABASE_URL' | 'VIGIL_SECRET_KEY' | 'OPENROUTER_API_KEY'): string {
```
(The body is unchanged — it already reads `process.env[name]` and throws if missing.)

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm --filter @vigil/engine test -- env` → PASS (2 tests).
Run: `pnpm --filter @vigil/engine typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/engine
git commit -m "chore: add OpenAI SDK (for OpenRouter) and OPENROUTER_API_KEY env support"
```

---

### Task 2: Browser tool surface (MapSession)

The Playwright wrappers Claude will drive. The key piece is `snapshot()`: it tags each interactive element with a `data-vigil-ref`, computes a **durable CSS selector** for it (so proposed golden-path steps use `#email`, not the ephemeral ref), and omits destructive links (reusing `isUnsafeHref`). Clicks are restricted to refs from the most recent snapshot — the agent structurally cannot reach a filtered-out control.

**Files:**
- Create: `packages/engine/src/map/browserTools.ts`
- Test: `packages/engine/test/browserTools.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/browserTools.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { MapSession } from '../src/map/browserTools.js';

let server: Server;
let url: string;
let session: MapSession;

beforeAll(async () => ({ server, url } = await startFixture()));
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(async () => { await fetch(`${url}/__reset`, { method: 'POST' }); });

describe('MapSession', () => {
  it('navigates and reports state (path + headings)', async () => {
    session = new MapSession(url);
    await session.start();
    try {
      const state = await session.navigate('/login');
      expect(state).toContain('url=/login');
      expect(state).toContain('Sign in');
    } finally { await session.close(); }
  });

  it('snapshots interactive elements with durable selectors', async () => {
    session = new MapSession(url);
    await session.start();
    try {
      await session.navigate('/login');
      const entries = await session.snapshot();
      const email = entries.find((e) => e.selector === '#email');
      const pwd = entries.find((e) => e.selector === '#password');
      const submit = entries.find((e) => e.role === 'button' && /sign in/i.test(e.name));
      expect(email).toBeTruthy();
      expect(pwd).toBeTruthy();
      expect(submit).toBeTruthy();
      expect(email!.ref).toMatch(/^e\d+$/);
    } finally { await session.close(); }
  });

  it('drives a login by ref and reaches the dashboard', async () => {
    session = new MapSession(url);
    await session.start();
    try {
      await session.navigate('/login');
      const entries = await session.snapshot();
      const email = entries.find((e) => e.selector === '#email')!;
      const pwd = entries.find((e) => e.selector === '#password')!;
      const submit = entries.find((e) => e.role === 'button')!;
      await session.fill(email.ref, 'demo@example.com');
      await session.fill(pwd.ref, 'demo-pass');
      await session.click(submit.ref);
      const state = await session.readState();
      expect(state).toContain('url=/dashboard');
    } finally { await session.close(); }
  });

  it('omits destructive links from the snapshot and rejects unknown refs', async () => {
    session = new MapSession(url);
    await session.start();
    try {
      await session.navigate('/');
      await session.snapshot();
      await expect(session.click('e999')).rejects.toThrow(/unknown ref/i);
    } finally { await session.close(); }
  });

  it('selects a native dropdown option by ref', async () => {
    session = new MapSession(url);
    await session.start();
    try {
      await session.navigate('/onboarding');
      const entries = await session.snapshot();
      const country = entries.find((e) => e.selector === 'select[name="country"]')!;
      await session.select(country.ref, 'IN');
      const result = await session.readState();
      // /onboarding reflects the choice into #result via client JS
      expect(await session.textOf('#result')).toContain('India');
      expect(result).toContain('url=/onboarding');
    } finally { await session.close(); }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test -- browserTools`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement MapSession**

`packages/engine/src/map/browserTools.ts`:
```ts
import { chromium, type Browser, type Page } from 'playwright';
import { VIGIL_USER_AGENT } from '../replay/executor.js';
import { isUnsafeHref } from '../sweep/crawler.js';

export interface SnapshotEntry {
  ref: string;
  role: string;
  name: string;
  selector: string;
}

interface RawEntry extends SnapshotEntry { href: string | null; }

/** A live browser the map agent drives. Tools are intentionally narrow: navigate,
 *  snapshot (accessibility-ish view with durable selectors), click/fill/select by ref,
 *  read_state. Destructive links are filtered out of snapshots, and clicks are limited
 *  to refs from the latest snapshot — so the agent cannot fire a control we withheld. */
export class MapSession {
  private browser: Browser | undefined;
  private page!: Page;
  private lastRefs = new Set<string>();

  constructor(private readonly baseUrl: string) {}

  async start(): Promise<void> {
    this.browser = await chromium.launch();
    const context = await this.browser.newContext({ userAgent: VIGIL_USER_AGENT });
    this.page = await context.newPage();
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
  }

  async navigate(path: string): Promise<string> {
    await this.page.goto(new URL(path, this.baseUrl).href, { waitUntil: 'load', timeout: 20_000 });
    return this.readState();
  }

  async readState(): Promise<string> {
    const pathname = new URL(this.page.url()).pathname;
    const headings = await this.page.$$eval('h1,h2', (els) =>
      els.map((e) => (e.textContent ?? '').trim()).filter(Boolean).slice(0, 5));
    return `url=${pathname}\nheadings=${headings.join(' | ')}`;
  }

  async textOf(selector: string): Promise<string> {
    return (await this.page.locator(selector).first().textContent()) ?? '';
  }

  async snapshot(): Promise<SnapshotEntry[]> {
    const raw: RawEntry[] = await this.page.evaluate(() => {
      function durableSelector(el: Element): string {
        const tag = el.tagName.toLowerCase();
        if (el.id) return `#${el.id}`;
        const name = el.getAttribute('name');
        if (name) return `${tag}[name="${name}"]`;
        const type = el.getAttribute('type');
        if (tag === 'input' && type) return `input[type="${type}"]`;
        return tag;
      }
      const els = Array.from(document.querySelectorAll('a[href],button,input,select,textarea'));
      const out: Array<{ ref: string; role: string; name: string; selector: string; href: string | null }> = [];
      let n = 1;
      for (const el of els) {
        const tag = el.tagName.toLowerCase();
        const role = tag === 'a' ? 'link'
          : tag === 'button' ? 'button'
          : tag === 'select' ? 'select'
          : tag === 'textarea' ? 'textbox'
          : (el.getAttribute('type') ?? 'textbox');
        const name = ((el.textContent ?? '') || el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('name') || '').trim().slice(0, 40);
        const ref = `e${n++}`;
        el.setAttribute('data-vigil-ref', ref);
        out.push({ ref, role, name, selector: durableSelector(el), href: el.getAttribute('href') });
      }
      return out;
    });

    // Filter destructive links in Node (isUnsafeHref can't run inside page.evaluate)
    const safe = raw.filter((e) => !(e.role === 'link' && e.href && isUnsafeHref(e.href)));
    this.lastRefs = new Set(safe.map((e) => e.ref));
    return safe.map(({ ref, role, name, selector }) => ({ ref, role, name, selector }));
  }

  private locator(ref: string) {
    if (!this.lastRefs.has(ref)) throw new Error(`unknown ref "${ref}" — call snapshot first and use a returned ref`);
    return this.page.locator(`[data-vigil-ref="${ref}"]`).first();
  }

  async click(ref: string): Promise<string> {
    await this.locator(ref).click({ timeout: 15_000 });
    return this.readState();
  }

  async fill(ref: string, value: string): Promise<string> {
    await this.locator(ref).fill(value, { timeout: 15_000 });
    return this.readState();
  }

  async select(ref: string, value: string): Promise<string> {
    await this.locator(ref).selectOption(value, { timeout: 15_000 });
    return this.readState();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test -- browserTools`
Expected: PASS (5 tests, ~30–60s — real browser).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: MapSession browser tool surface with durable selectors and safe-ref clicking"
```

---

### Task 3: Tool schemas

The tool definitions the agent sees (provider-neutral `ToolDef`; the OpenRouter client maps them to OpenAI `function` tools). `propose_flows` carries the discovered journeys; its schema is intentionally permissive (action is a generic object) because the strict validation happens against `goldenPathSchema` after the call (JSON Schema can't express the discriminated union with all our constraints).

**Files:**
- Create: `packages/engine/src/map/toolSchemas.ts`
- Test: `packages/engine/test/toolSchemas.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/toolSchemas.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { MAP_TOOLS } from '../src/map/toolSchemas.js';

describe('MAP_TOOLS', () => {
  it('exposes the browser tools and propose_flows', () => {
    const names = MAP_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(['click', 'fill', 'navigate', 'propose_flows', 'read_state', 'select', 'snapshot']);
  });
  it('every tool has a description and an object input_schema', () => {
    for (const t of MAP_TOOLS) {
      expect(t.description.length).toBeGreaterThan(10);
      expect((t.input_schema as { type: string }).type).toBe('object');
    }
  });
  it('propose_flows takes a flows array of {name, steps}', () => {
    const propose = MAP_TOOLS.find((t) => t.name === 'propose_flows')!;
    const schema = propose.input_schema as { properties: { flows: { type: string } }; required: string[] };
    expect(schema.properties.flows.type).toBe('array');
    expect(schema.required).toContain('flows');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test -- toolSchemas`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/engine/src/map/toolSchemas.ts`:
```ts
export interface ToolDef {
  name: string;
  description: string;
  input_schema: object;
}

export const MAP_TOOLS: ToolDef[] = [
  {
    name: 'navigate',
    description: 'Go to a path on the target app (e.g. "/login"). Returns the new page state (url + headings).',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Path beginning with /' } }, required: ['path'] },
  },
  {
    name: 'snapshot',
    description: 'List the interactive elements on the current page. Each entry has a ref (for click/fill/select), a role, a visible name, and a durable CSS selector you MUST use when proposing flow steps. Destructive links (logout/delete) are hidden — do not attempt them.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'read_state',
    description: 'Get the current page state (url path + visible headings) without changing anything.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'click',
    description: 'Click an element by its ref from the latest snapshot. Returns the new page state.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] },
  },
  {
    name: 'fill',
    description: 'Type a value into an input/textarea by its ref from the latest snapshot.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' }, value: { type: 'string' } }, required: ['ref', 'value'] },
  },
  {
    name: 'select',
    description: 'Choose an option in a native <select> dropdown by its ref. Value matches the option value or visible label.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' }, value: { type: 'string' } }, required: ['ref', 'value'] },
  },
  {
    name: 'propose_flows',
    description: 'Submit the critical user journeys you discovered, as golden paths. Each step action kind is one of: goto{path}, fill{selector,value,description}, select{selector,value,description}, upload{selector,path,description}, click{selector,description}, expect_text{text}, expect_url{pattern}. Use the durable selectors from snapshots. For credentials use the placeholders {{email}} and {{password}}. End each flow with expect_url and/or expect_text on stable post-action content. Call this once with all flows when you are done exploring.',
    input_schema: {
      type: 'object',
      properties: {
        flows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              steps: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { id: { type: 'string' }, action: { type: 'object' } },
                  required: ['id', 'action'],
                },
              },
            },
            required: ['name', 'steps'],
          },
        },
      },
      required: ['flows'],
    },
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test -- toolSchemas`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: tool schemas for the map agent"
```

---

### Task 4: LLM client boundary

A tiny provider-neutral interface over the one LLM call the loop makes, so the loop is testable with a scripted fake. The real `OpenRouterClient` uses the `openai` SDK against OpenRouter and adapts OpenAI-style chat/tool-calls to/from our neutral `ContentBlock` shape. Only `text`/`tool_use` blocks flow (no extended-thinking handling).

**Files:**
- Create: `packages/engine/src/map/llmClient.ts`
- Test: `packages/engine/test/llmClient.test.ts`

- [ ] **Step 1: Write the failing test** (tests only the pure FakeLLMClient + types — the real OpenRouter call is exercised live in Task 8, never in unit tests)

`packages/engine/test/llmClient.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { FakeLLMClient, type LLMResponse } from '../src/map/llmClient.js';

describe('FakeLLMClient', () => {
  it('returns scripted responses in order and records requests', async () => {
    const script: LLMResponse[] = [
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'navigate', input: { path: '/' } }] },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ];
    const fake = new FakeLLMClient(script);
    const r1 = await fake.createMessage({ system: 's', tools: [], messages: [] });
    const r2 = await fake.createMessage({ system: 's', tools: [], messages: [] });
    expect(r1.stopReason).toBe('tool_use');
    expect(r2.stopReason).toBe('end_turn');
    expect(fake.requests).toHaveLength(2);
  });
  it('throws if the script is exhausted (prevents runaway loops in tests)', async () => {
    const fake = new FakeLLMClient([]);
    await expect(fake.createMessage({ system: '', tools: [], messages: [] })).rejects.toThrow(/script exhausted/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test -- llmClient`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/engine/src/map/llmClient.ts`:
```ts
import OpenAI from 'openai';
import { env } from '../env.js';
import type { ToolDef } from './toolSchemas.js';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface LLMMessage { role: 'user' | 'assistant'; content: ContentBlock[]; }
export interface LLMRequest { system: string; tools: ToolDef[]; messages: LLMMessage[]; }
export interface LLMResponse { stopReason: string; content: ContentBlock[]; }

export interface LLMClient {
  createMessage(req: LLMRequest): Promise<LLMResponse>;
}

/** Deterministic stand-in for tests: returns scripted responses, records requests. */
export class FakeLLMClient implements LLMClient {
  public readonly requests: LLMRequest[] = [];
  private i = 0;
  constructor(private readonly script: LLMResponse[]) {}
  async createMessage(req: LLMRequest): Promise<LLMResponse> {
    this.requests.push(req);
    if (this.i >= this.script.length) throw new Error('FakeLLMClient script exhausted');
    return this.script[this.i++]!;
  }
}

function safeParseArgs(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}

/** Real client: a Claude (Sonnet-class) model reached through OpenRouter's OpenAI-
 *  compatible endpoint. Adapts our neutral ContentBlock shape to/from OpenAI chat +
 *  tool-calls. Model is env-configurable; default is a Sonnet slug on OpenRouter. */
export class OpenRouterClient implements LLMClient {
  private readonly model = process.env.VIGIL_MAP_MODEL ?? 'anthropic/claude-sonnet-4.5';
  private readonly openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: env('OPENROUTER_API_KEY'),
  });

  async createMessage(req: LLMRequest): Promise<LLMResponse> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: req.system }];
    for (const m of req.messages) {
      if (m.role === 'assistant') {
        const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
        const toolCalls = m.content
          .filter((b) => b.type === 'tool_use')
          .map((b) => {
            const tu = b as { id: string; name: string; input: unknown };
            return { id: tu.id, type: 'function' as const, function: { name: tu.name, arguments: JSON.stringify(tu.input ?? {}) } };
          });
        messages.push({ role: 'assistant', content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      } else {
        for (const b of m.content) {
          if (b.type === 'text') messages.push({ role: 'user', content: b.text });
          else if (b.type === 'tool_result') messages.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.content });
        }
      }
    }
    const tools = req.tools.map((t: ToolDef) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.input_schema as Record<string, unknown> },
    }));

    const resp = await this.openai.chat.completions.create({ model: this.model, max_tokens: 8000, messages, tools });
    const msg = resp.choices[0]?.message;
    if (msg?.tool_calls?.length) {
      const content: ContentBlock[] = msg.tool_calls.map((tc) => ({
        type: 'tool_use', id: tc.id, name: tc.function.name, input: safeParseArgs(tc.function.arguments),
      }));
      return { stopReason: 'tool_use', content };
    }
    return { stopReason: 'end_turn', content: [{ type: 'text', text: msg?.content ?? '' }] };
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @vigil/engine test -- llmClient` → PASS (2 tests).
Run: `pnpm --filter @vigil/engine typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: LLMClient boundary with OpenRouter impl and scripted fake"
```

---

### Task 5: The map agent loop

The manual tool-use loop. It feeds browser-tool results back to the model and collects `propose_flows` output, validating each flow with the existing `goldenPathSchema`. Tested end-to-end with the **FakeLLMClient** scripting a real exploration against the fixture — deterministic, no API key.

**Files:**
- Create: `packages/engine/src/map/mapper.ts`
- Test: `packages/engine/test/mapper.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/mapper.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { MapSession } from '../src/map/browserTools.js';
import { FakeLLMClient, type LLMResponse } from '../src/map/llmClient.js';
import { mapApp } from '../src/map/mapper.js';

let server: Server;
let url: string;

beforeAll(async () => ({ server, url } = await startFixture()));
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(async () => { await fetch(`${url}/__reset`, { method: 'POST' }); });

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
const toolUse = (id: string, name: string, input: unknown): LLMResponse => ({ stopReason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });

async function withSession<T>(fn: (s: MapSession) => Promise<T>): Promise<T> {
  const s = new MapSession(url);
  await s.start();
  try { return await fn(s); } finally { await s.close(); }
}

describe('mapApp', () => {
  it('drives real browser tools from scripted model turns and returns a validated proposal', async () => {
    const script: LLMResponse[] = [
      toolUse('t1', 'navigate', { path: '/login' }),
      toolUse('t2', 'snapshot', {}),
      toolUse('t3', 'propose_flows', { flows: [loginFlowJson] }),
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ];
    const proposals = await withSession((s) => mapApp(s, new FakeLLMClient(script), { maxSteps: 10 }));
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.name).toBe('login');
    expect(proposals[0]!.steps).toHaveLength(5);
  });

  it('rejects an invalid proposal, surfaces the error, and accepts the corrected retry', async () => {
    const bad = { name: 'broken', steps: [{ id: 'x', action: { kind: 'teleport' } }] };
    const script: LLMResponse[] = [
      toolUse('t1', 'propose_flows', { flows: [bad] }),       // invalid → error tool_result
      toolUse('t2', 'propose_flows', { flows: [loginFlowJson] }), // corrected
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ];
    const fake = new FakeLLMClient(script);
    const proposals = await withSession((s) => mapApp(s, fake, { maxSteps: 10 }));
    expect(proposals.map((p) => p.name)).toEqual(['login']);
    // The rejection was fed back so the model could fix it
    const secondReq = fake.requests[1]!;
    const toolResult = secondReq.messages.at(-1)!.content[0]!;
    expect(toolResult.type).toBe('tool_result');
    expect((toolResult as { content: string }).content).toMatch(/reject/i);
  });

  it('caps proposals at 8 and stops at maxSteps without ending', async () => {
    const flows = Array.from({ length: 12 }, (_, i) => ({ ...loginFlowJson, name: `flow${i}` }));
    const script: LLMResponse[] = [toolUse('t1', 'propose_flows', { flows }), { stopReason: 'end_turn', content: [] }];
    const proposals = await withSession((s) => mapApp(s, new FakeLLMClient(script), { maxSteps: 10 }));
    expect(proposals).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test -- mapper`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/engine/src/map/mapper.ts`:
```ts
import { goldenPathSchema, type GoldenPath } from '../flows/goldenPath.js';
import { MAP_TOOLS } from './toolSchemas.js';
import type { ContentBlock, LLMClient, LLMMessage } from './llmClient.js';
import type { MapSession, SnapshotEntry } from './browserTools.js';

const MAX_FLOWS = 8;

const SYSTEM = `You are Vigil's app mapper. You explore a web app through a browser and identify its critical user journeys (the flows that, if broken, hurt the business: signup, login, the core action, checkout, contact).

Process:
1. Start logged out. navigate("/"), snapshot, and explore the main entry points.
2. If test credentials are provided, log in (use the placeholders {{email}} and {{password}} as the values you fill) and explore the logged-in app.
3. Identify up to 8 critical journeys. For each, write a golden path: an ordered list of steps using the DURABLE SELECTORS shown in snapshots (e.g. #email), ending with expect_url and/or expect_text on stable content that proves the journey worked.
4. Never attempt destructive actions (logout, delete, sending messages to real people, real payments). Stop a journey at that boundary and assert the page state instead.
5. When done, call propose_flows ONCE with all flows. If a proposal is rejected, read the reason and resubmit a corrected version.

Keep flows short (<= 30 steps). Prefer the few journeys that matter over many trivial ones.`;

function kickoff(credentials?: { email: string; password: string }): string {
  return credentials
    ? 'Explore this app. Test credentials are available — fill {{email}} and {{password}} as the login values (do not invent real values).'
    : 'Explore this app. No login credentials are available — map what you can reach logged out.';
}

function renderSnapshot(entries: SnapshotEntry[]): string {
  if (entries.length === 0) return '(no interactive elements)';
  return entries.map((e) => `[${e.ref}] ${e.role} "${e.name}" -> ${e.selector}`).join('\n');
}

async function dispatchBrowserTool(session: MapSession, name: string, input: unknown): Promise<string> {
  const a = input as Record<string, string>;
  switch (name) {
    case 'navigate': return session.navigate(a.path ?? '/');
    case 'read_state': return session.readState();
    case 'snapshot': return renderSnapshot(await session.snapshot());
    case 'click': return session.click(a.ref ?? '');
    case 'fill': return session.fill(a.ref ?? '', a.value ?? '');
    case 'select': return session.select(a.ref ?? '', a.value ?? '');
    default: return `error: unknown tool "${name}"`;
  }
}

/** Validate proposed flows against the real schema; collect valid ones (capped),
 *  return a human-readable result the model can act on. */
function handleProposals(input: unknown, collected: GoldenPath[]): string {
  const flows = (input as { flows?: unknown[] }).flows ?? [];
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const raw of flows) {
    if (collected.length >= MAX_FLOWS) break;
    const parsed = goldenPathSchema.safeParse(raw);
    if (parsed.success) { collected.push(parsed.data); accepted.push(parsed.data.name); }
    else rejected.push(`${(raw as { name?: string }).name ?? '?'}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  }
  const parts = [`accepted ${accepted.length} flow(s)${accepted.length ? `: ${accepted.join(', ')}` : ''}`];
  if (rejected.length) parts.push(`rejected ${rejected.length}: ${rejected.join('; ')}`);
  return parts.join('. ');
}

export interface MapOptions {
  credentials?: { email: string; password: string };
  maxSteps?: number;
}

export async function mapApp(session: MapSession, client: LLMClient, opts: MapOptions = {}): Promise<GoldenPath[]> {
  const maxSteps = opts.maxSteps ?? 40;
  const proposals: GoldenPath[] = [];
  const messages: LLMMessage[] = [{ role: 'user', content: [{ type: 'text', text: kickoff(opts.credentials) }] }];

  for (let step = 0; step < maxSteps; step++) {
    const resp = await client.createMessage({ system: SYSTEM, tools: MAP_TOOLS, messages });
    messages.push({ role: 'assistant', content: resp.content });
    if (resp.stopReason === 'end_turn') break;

    const toolResults: ContentBlock[] = [];
    for (const block of resp.content) {
      if (block.type !== 'tool_use') continue;
      const content = block.name === 'propose_flows'
        ? handleProposals(block.input, proposals)
        : await dispatchBrowserTool(session, block.name, block.input);
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
    }
    if (toolResults.length === 0) break; // assistant said nothing actionable
    messages.push({ role: 'user', content: toolResults });
  }
  return proposals.slice(0, MAX_FLOWS);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test -- mapper`
Expected: PASS (3 tests, ~20–40s — the first drives a real browser).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: map agent loop with schema-validated flow proposals"
```

---

### Task 6: Persistence + CLI (`map`, `flow:confirm`, report)

Persist proposals as `status='proposed'` (re-mapping replaces prior proposals), let the founder promote them to `confirmed`, and surface proposed flows in `report`.

**Files:**
- Modify: `packages/engine/src/db/flowsRepo.ts`, `packages/engine/src/cli.ts`
- Test: `packages/engine/test/flowsRepoProposed.test.ts`, `packages/engine/test/cliMap.test.ts`

- [ ] **Step 1: Write the failing repo test**

`packages/engine/test/flowsRepoProposed.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, createApp } from '../src/db/appsRepo.js';
import { addFlow, listConfirmedFlows, listProposedFlows, confirmFlow, deleteProposedFlows } from '../src/db/flowsRepo.js';

let appId: string;
beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings cascade');
  const userId = await ensureUser('founder@vigil.test');
  appId = (await createApp({ userId, name: 'demo', productionUrl: 'http://x.test', previewUrl: null, credentials: null })).id;
});

const flow = (name: string) => ({ name, steps: [{ id: 's1', action: { kind: 'goto', path: '/' } }] });

describe('proposed-flow lifecycle', () => {
  it('lists only proposed flows', async () => {
    await addFlow(appId, flow('login'), 'proposed');
    await addFlow(appId, flow('search'), 'confirmed');
    expect((await listProposedFlows(appId)).map((f) => f.goldenPath.name)).toEqual(['login']);
  });
  it('confirms a proposed flow (it then appears as confirmed, not proposed)', async () => {
    await addFlow(appId, flow('login'), 'proposed');
    await confirmFlow(appId, 'login');
    expect(await listProposedFlows(appId)).toEqual([]);
    expect((await listConfirmedFlows(appId)).map((f) => f.goldenPath.name)).toEqual(['login']);
  });
  it('deleteProposedFlows clears only proposed (keeps confirmed) for re-mapping', async () => {
    await addFlow(appId, flow('a'), 'proposed');
    await addFlow(appId, flow('b'), 'confirmed');
    await deleteProposedFlows(appId);
    expect(await listProposedFlows(appId)).toEqual([]);
    expect((await listConfirmedFlows(appId)).map((f) => f.goldenPath.name)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test -- flowsRepoProposed`
Expected: FAIL — `listProposedFlows`/`confirmFlow`/`deleteProposedFlows` not exported.

- [ ] **Step 3: Add the repo functions**

Append to `packages/engine/src/db/flowsRepo.ts`:
```ts
export async function listProposedFlows(appId: string): Promise<FlowRecord[]> {
  const { rows } = await getPool().query<{ id: string; app_id: string; status: string; version: number; golden_path: unknown }>(
    `select id, app_id, status, version, golden_path from flows
     where app_id = $1 and status = 'proposed' order by created_at`, [appId]);
  return rows.map((r) => ({
    id: r.id, appId: r.app_id, status: r.status, version: r.version,
    goldenPath: goldenPathSchema.parse(r.golden_path),
  }));
}

export async function confirmFlow(appId: string, name: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update flows set status = 'confirmed' where app_id = $1 and name = $2 and status = 'proposed'`, [appId, name]);
  return (rowCount ?? 0) > 0;
}

export async function deleteProposedFlows(appId: string): Promise<void> {
  await getPool().query(`delete from flows where app_id = $1 and status = 'proposed'`, [appId]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test -- flowsRepoProposed`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing CLI test**

`packages/engine/test/cliMap.test.ts`:
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

describe('vigil map (CLI)', () => {
  it('maps an app with a scripted model and saves proposed flows; confirm promotes one', async () => {
    await cmdAppAdd({ name: 'demo', url, loginEmail: 'demo@example.com', loginPassword: 'demo-pass' });
    const script: LLMResponse[] = [
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_flows', input: { flows: [loginFlowJson] } }] },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ];
    const { lines } = await cmdMap('demo', { client: new FakeLLMClient(script), maxSteps: 5 });
    expect(lines.join('\n')).toContain('login');

    const userId = await ensureUser(process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local');
    const app = (await getAppByName(userId, 'demo'))!;
    expect((await listProposedFlows(app.id)).map((f) => f.goldenPath.name)).toEqual(['login']);

    await cmdFlowConfirm('demo', 'login');
    expect((await listConfirmedFlows(app.id)).map((f) => f.goldenPath.name)).toEqual(['login']);
    expect(await listProposedFlows(app.id)).toEqual([]);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test -- cliMap`
Expected: FAIL — `cmdMap`/`cmdFlowConfirm` not exported.

- [ ] **Step 7: Implement the CLI commands**

In `packages/engine/src/cli.ts`, add imports near the top (with the other imports):
```ts
import { MapSession } from './map/browserTools.js';
import { mapApp } from './map/mapper.js';
import { OpenRouterClient, type LLMClient } from './map/llmClient.js';
import { addFlow, listConfirmedFlows, listProposedFlows, confirmFlow, deleteProposedFlows } from './db/flowsRepo.js';
```
(Replace the existing `flowsRepo` import line so it includes all of these — do not create a duplicate import.)

Add the command functions (after `cmdSweep`, before `cmdReport`):
```ts
export interface MapCliOptions { client?: LLMClient; maxSteps?: number; }

export async function cmdMap(appName: string, opts: MapCliOptions = {}): Promise<{ lines: string[] }> {
  const app = await requireApp(appName);
  const client = opts.client ?? new OpenRouterClient();
  const session = new MapSession(app.productionUrl);
  await session.start();
  let proposals;
  try {
    proposals = await mapApp(session, client, { credentials: app.credentials ?? undefined, maxSteps: opts.maxSteps });
  } finally {
    await session.close();
  }
  await deleteProposedFlows(app.id);          // re-mapping replaces prior proposals
  const lines: string[] = [`Mapped ${appName}: ${proposals.length} proposed flow(s).`];
  for (const gp of proposals) {
    await addFlow(app.id, gp, 'proposed');
    lines.push(`  • ${gp.name} (${gp.steps.length} steps) — confirm with: vigil flow:confirm ${appName} ${gp.name}`);
  }
  for (const l of lines) console.log(l);
  return { lines };
}

export async function cmdFlowConfirm(appName: string, flowName: string): Promise<void> {
  const app = await requireApp(appName);
  const ok = await confirmFlow(app.id, flowName);
  console.log(ok ? `Confirmed "${flowName}" — it will now be watched.` : `No proposed flow named "${flowName}" on ${appName}.`);
}
```

In `cmdReport`, add a proposed-flows section. Replace the final loop region of `cmdReport` (the part after the confirmed sweep findings loop, before `for (const l of lines) console.log(l)`) by inserting:
```ts
  const proposed = await listProposedFlows(app.id);
  if (proposed.length) {
    lines.push(`# proposed flows (awaiting confirm)`);
    for (const f of proposed) lines.push(`PROPOSED ${f.goldenPath.name} (${f.goldenPath.steps.length} steps)`);
  }
```

Add commander wiring inside the `if (process.argv[1] === fileURLToPath(import.meta.url)) {` block (alongside the other `program.command(...)` calls):
```ts
  program.command('map').argument('<app>')
    .action(async (app) => { await cmdMap(app); });
  program.command('flow:confirm').argument('<app>').argument('<flow>')
    .action(async (app, flow) => { await cmdFlowConfirm(app, flow); });
```

- [ ] **Step 8: Run tests + full suite + typecheck**

Run: `pnpm --filter @vigil/engine test -- cliMap` → PASS (1 test).
Run: `pnpm --filter @vigil/engine test` → all green.
Run: `pnpm --filter @vigil/engine typecheck` → clean.
Run (smoke): from `packages/engine`, `pnpm vigil map --help` → shows the `map` command; `pnpm vigil --help` lists `map` and `flow:confirm`.

- [ ] **Step 9: Commit**

```bash
git add packages/engine
git commit -m "feat: vigil map + flow:confirm — persist and promote LLM-proposed flows"
```

---

### Task 7: Sweep post-login seed (spec §6.2 gap 1)

When the sweep logs in, it currently still starts crawling from the marketing root, so single-page apps never get reached. Seed the crawl queue with the post-login landing URL.

**Files:**
- Modify: `packages/engine/src/sweep/crawler.ts`
- Test: `packages/engine/test/crawlerLogin.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/crawlerLogin.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { goldenPathSchema } from '../src/flows/goldenPath.js';
import { sweepSite } from '../src/sweep/crawler.js';

let server: Server;
let url: string;
beforeAll(async () => ({ server, url } = await startFixture()));
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(async () => { await fetch(`${url}/__reset`, { method: 'POST' }); });

const loginFlow = goldenPathSchema.parse({
  name: 'login',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/login' } },
    { id: 's2', action: { kind: 'fill', selector: 'input[name=email]', value: '{{email}}', description: 'email' } },
    { id: 's3', action: { kind: 'fill', selector: 'input[name=password]', value: '{{password}}', description: 'password' } },
    { id: 's4', action: { kind: 'click', selector: 'button[type=submit]', description: 'Sign in' } },
    { id: 's5', action: { kind: 'expect_url', pattern: '/dashboard$' } },
  ],
});
const creds = { email: 'demo@example.com', password: 'demo-pass' };

describe('sweep seeds from the post-login landing page', () => {
  it('reaches /dashboard and /items (only linked once logged in)', async () => {
    const result = await sweepSite({ baseUrl: url, maxPages: 30, loginFlow, credentials: creds });
    const paths = result.pages.map((p) => new URL(p.url).pathname);
    expect(paths).toContain('/dashboard');
    expect(paths).toContain('/items'); // linked from /dashboard, never from the logged-out root
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test -- crawlerLogin`
Expected: FAIL — `/dashboard` and `/items` are not reached (crawl started only from the root).

- [ ] **Step 3: Implement the seed**

In `packages/engine/src/sweep/crawler.ts`, inside `sweepSite`, find the login warm-up block:
```ts
    if (opts.loginFlow) {
      const replayOpts: ReplayOptions = {
        baseUrl: opts.baseUrl, credentials: opts.credentials,
        artifactsDir: 'artifacts/sweep-login', runId: `sweep-${Date.now()}`,
      };
      await performSteps(page, opts.loginFlow, replayOpts);
    }
```
Replace it with (capturing the landing URL to seed after the queue is built):
```ts
    let postLoginUrl: string | undefined;
    if (opts.loginFlow) {
      const replayOpts: ReplayOptions = {
        baseUrl: opts.baseUrl, credentials: opts.credentials,
        artifactsDir: 'artifacts/sweep-login', runId: `sweep-${Date.now()}`,
      };
      await performSteps(page, opts.loginFlow, replayOpts);
      postLoginUrl = page.url();
    }
```
Then, immediately after the existing `extraSeeds` loop that fills the queue:
```ts
    const queue: string[] = [new URL(opts.baseUrl).href];
    for (const seed of opts.extraSeeds ?? []) {
      const n = normalize(seed, opts.baseUrl);
      if (n) queue.push(n);
    }
```
add:
```ts
    if (postLoginUrl) {
      const n = normalize(postLoginUrl, opts.baseUrl);
      if (n) queue.push(n);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test -- crawlerLogin` → PASS (1 test).
Run: `pnpm --filter @vigil/engine test -- crawler` → existing crawler tests still PASS (regression check).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "fix: sweep seeds crawl from post-login landing page (spec 6.2 gap 1)"
```

---

### Task 8: Live mapping run (gated, manual — like Task 10 dogfooding)

No automated test. Validates the real OpenRouter-backed agent against an actual app. Needs `OPENROUTER_API_KEY` (and optionally `VIGIL_MAP_MODEL`) and the local DB.

- [ ] **Step 1: Prerequisites**

```bash
# terminal A
cd packages/engine && pnpm db:dev
# terminal B
cd packages/engine && pnpm migrate
export OPENROUTER_API_KEY=sk-or-...                 # founder provides
export VIGIL_MAP_MODEL=anthropic/claude-sonnet-4.5  # pick the exact slug from openrouter.ai/models
```

- [ ] **Step 2: Map the in-repo fixture first (cheapest, fully controlled)**

Start the fixture (`pnpm --filter @vigil/fixture-app start` → note the port, e.g. 4999), then:
```bash
cd packages/engine
pnpm vigil app:add --name fixturemap --url http://127.0.0.1:4999 --login-email demo@example.com --login-password demo-pass
pnpm vigil map fixturemap
pnpm vigil report fixturemap   # expect a PROPOSED login flow (and possibly contact/onboarding)
```
Exit criterion: at least the **login** flow is proposed with sane selectors (`#email`, `#password`, `button[type=submit]`) and a `/dashboard` assertion. Confirm it and check it replays:
```bash
pnpm vigil flow:confirm fixturemap login
pnpm vigil check fixturemap   # expect ✅ PASS login
```

- [ ] **Step 3: Map a real app (founder's, from Task 10)**

```bash
pnpm vigil map settlenepal      # uses stored creds; explores logged-in
pnpm vigil report settlenepal   # review PROPOSED flows
```
Review each proposed flow for correctness and safety (no destructive steps — the tool surface withholds them, but verify). Confirm the good ones; discard the rest by re-mapping or leaving them proposed.

- [ ] **Step 4: Record observations**

Note token cost per map run (visible in your OpenRouter dashboard) against the §9 estimate ($0.20–$1.00/app), and any flows the agent missed or mis-mapped — these tune the system prompt. No code commit unless prompt tuning is needed; if it is:
```bash
git add packages/engine/src/map/mapper.ts
git commit -m "tune: map system prompt from live-run observations"
```

---

## Self-review (performed at write time)

1. **Spec coverage:** §6.1 MAP design (surface = Claude API + tool use, manual loop, Sonnet, accessibility-tree tools, propose GoldenPath validated by goldenPathSchema, status='proposed', confirmation gate, destructive controls withheld, cost control via maxSteps/cap) → Tasks 2–6, 8. §6.2 gap 1 (sweep post-login seed) → Task 7. §6.2 gap 2 (more mapped flows carry feature depth) → addressed by the mapper itself (Tasks 2–6). §6.2 gap 3 (metered test accounts) is a product/onboarding requirement, not engine code — explicitly out of scope for this plan; noted for Plan 2. §3.2 scope doctrine (novelty absorbed at map time; deterministic replay after) → realized by the mapper feeding `status='proposed'` flows into the existing replay engine. HEAL/DIAGNOSE/queue/scheduler remain separate future plans (unchanged).
2. **Placeholder scan:** Task 8 contains `sk-ant-...` and a port placeholder — runtime values only the founder/runtime has, not missing design. No TBDs elsewhere.
3. **Type consistency:** `MapSession` (Task 2) methods `navigate/snapshot/click/fill/select/readState/textOf` are consumed by `dispatchBrowserTool` in Task 5 and `cmdMap` in Task 6. `SnapshotEntry{ref,role,name,selector}` from Task 2 is rendered in Task 5. `ContentBlock`/`LLMClient`/`LLMResponse`/`LLMRequest` from Task 4 are used by `mapApp` (Task 5), `FakeLLMClient` (Tasks 4–6), and `OpenRouterClient` (Task 4, used in Task 6 `cmdMap`). `ToolDef`/`MAP_TOOLS` from Task 3 used in Task 4's `LLMRequest.tools` and Task 5's loop. `goldenPathSchema`/`GoldenPath` (pre-existing) validate proposals in Task 5 and persist via `addFlow(_, _, 'proposed')` (pre-existing signature) in Task 6. `listProposedFlows`/`confirmFlow`/`deleteProposedFlows` defined in Task 6 used by `cmdMap`/`cmdFlowConfirm`/`cmdReport` in the same task. Verified consistent.
