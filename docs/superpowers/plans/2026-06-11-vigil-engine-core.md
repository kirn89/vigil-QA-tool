# Vigil Engine Core (Plan 1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The deterministic heart of Vigil: replay hand-authored golden paths against any URL with retries and three-state verdicts, sweep a site for objective breakage, persist everything in Postgres, all driven from a CLI the founder can use on his two live apps today.

**Architecture:** A pnpm monorepo with two packages: `@vigil/fixture-app` (a deliberately breakable demo site used as the test bed, per spec §12) and `@vigil/engine` (golden-path schema → Playwright replay executor → retry/verdict state machine → Postgres repositories → sweep crawler → commander CLI). No LLM code in this plan — MAP/HEAL/DIAGNOSE, the job queue, and the scheduler are Plan 1b; the web app is Plan 2. Spec: `docs/superpowers/specs/2026-06-11-vigil-app-watcher-design.md`.

**Tech Stack:** Node 20+, TypeScript (ESM, strict), pnpm workspaces, Playwright (chromium), Zod, pg, commander, Vitest, Express (fixture only), Docker (local Postgres 16).

**Conventions used throughout:** all engine source under `packages/engine/src`, tests next to nothing — they live under `packages/engine/test`. Run tests from the repo root with `pnpm --filter @vigil/engine test -- <file>`. Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (omitted below for brevity — always append it).

---

## File structure (end state of this plan)

```
package.json                      # workspace root, private
pnpm-workspace.yaml
tsconfig.base.json
docker-compose.yml                # local Postgres 16 on port 54329
.env.example                      # DATABASE_URL, VIGIL_SECRET_KEY
packages/
  fixture-app/
    package.json
    tsconfig.json
    src/server.ts                 # breakable demo site + start helper
    test/server.test.ts
  engine/
    package.json
    tsconfig.json
    vitest.config.ts
    migrations/001_init.sql       # users, apps, flows, runs, sweeps, sweep_pages, sweep_findings
    src/
      env.ts                      # env loading/validation
      flows/goldenPath.ts         # zod schema, types, {{placeholder}} interpolation
      replay/executor.ts          # performSteps + replayFlow (Playwright)
      verdict/classify.ts         # pure verdict state machine
      verdict/runWithRetries.ts   # attempt loop with backoff
      db/pool.ts                  # pg Pool singleton
      db/migrate.ts               # SQL-file migration runner
      db/crypto.ts                # AES-256-GCM credential encryption
      db/appsRepo.ts
      db/flowsRepo.ts
      db/runsRepo.ts
      db/sweepRepo.ts             # sweeps, pages, findings + consecutive-count logic
      sweep/crawler.ts            # BFS same-origin crawl + objective checks
      cli.ts                      # vigil app:add | flow:add | check | sweep | report
    test/
      goldenPath.test.ts
      executor.test.ts
      classify.test.ts
      runWithRetries.test.ts
      db.test.ts
      crawler.test.ts
      sweepRepo.test.ts
      cli.test.ts
```

`jobs` table and nightly scheduling are deliberately absent — they arrive with the worker in Plan 1b (migration `002`). The CLI is the founder's interface until then.

---

### Task 1: Workspace scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore` (append), `.env.example`
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`, `packages/engine/vitest.config.ts`
- Create: `packages/fixture-app/package.json`, `packages/fixture-app/tsconfig.json`

- [ ] **Step 1: Root files**

`package.json`:
```json
{
  "name": "vigil",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "pnpm -r test"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "types": ["node"]
  }
}
```

Append to `.gitignore`:
```
node_modules/
dist/
.env
artifacts/
```

`.env.example`:
```
DATABASE_URL=postgres://vigil:vigil@localhost:54329/vigil
VIGIL_SECRET_KEY=0000000000000000000000000000000000000000000000000000000000000000
```

- [ ] **Step 2: Package manifests**

`packages/engine/package.json`:
```json
{
  "name": "@vigil/engine",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "vigil": "tsx src/cli.ts",
    "migrate": "tsx src/db/migrate.ts"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "dotenv": "^16.4.5",
    "pg": "^8.12.0",
    "playwright": "^1.48.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/pg": "^8.11.6",
    "@vigil/fixture-app": "workspace:*",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/engine/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/engine/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { testTimeout: 60_000, hookTimeout: 60_000, pool: 'forks', fileParallelism: false },
});
```
(Sequential files: executor/crawler tests share the fixture server and DB tests share tables.)

`packages/fixture-app/package.json`:
```json
{
  "name": "@vigil/fixture-app",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/server.ts" },
  "scripts": { "test": "vitest run", "start": "tsx src/server.ts" },
  "dependencies": { "express": "^4.19.0" },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/fixture-app/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

- [ ] **Step 3: Install and verify**

Run from repo root:
```bash
pnpm install
pnpm --filter @vigil/engine exec playwright install chromium
pnpm test
```
Expected: install succeeds; `pnpm test` reports "no test files found" for both packages (exit code may be non-zero — that's fine at this step; Task 2 adds the first real test).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm workspace for engine and fixture app"
```

---

### Task 2: Breakable fixture app

The test bed required by spec §12: a tiny site with login, item creation, contact form, and runtime-toggleable breakage so tests (and later, demos) can simulate every failure mode Vigil must catch.

**Files:**
- Create: `packages/fixture-app/src/server.ts`
- Test: `packages/fixture-app/test/server.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/fixture-app/test/server.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startFixture } from '../src/server.js';

let server: Server;
let url: string;

beforeAll(async () => ({ server, url } = await startFixture()));
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(async () => { await fetch(`${url}/__reset`, { method: 'POST' }); });

async function login(): Promise<Response> {
  return fetch(`${url}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'email=demo%40example.com&password=demo-pass',
    redirect: 'manual',
  });
}

describe('fixture app', () => {
  it('serves the home page with nav links', async () => {
    const html = await (await fetch(url)).text();
    expect(html).toContain('Demo App');
    expect(html).toContain('href="/about"');
  });

  it('login redirects to /dashboard on good credentials', async () => {
    const res = await login();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/dashboard');
  });

  it('breaking login-redirect sends users to /blank instead', async () => {
    await fetch(`${url}/__break?feature=login-redirect`, { method: 'POST' });
    expect((await login()).headers.get('location')).toBe('/blank');
  });

  it('breaking about-image serves a missing image reference', async () => {
    await fetch(`${url}/__break?feature=about-image`, { method: 'POST' });
    expect(await (await fetch(`${url}/about`)).text()).toContain('/missing.png');
  });

  it('breaking nav-link points home nav at a 404', async () => {
    await fetch(`${url}/__break?feature=nav-link`, { method: 'POST' });
    expect(await (await fetch(url)).text()).toContain('href="/gone"');
    expect((await fetch(`${url}/gone`)).status).toBe(404);
  });

  it('breaking items-create makes item creation 500', async () => {
    await fetch(`${url}/__break?feature=items-create`, { method: 'POST' });
    const res = await fetch(`${url}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'name=Widget',
    });
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/fixture-app test`
Expected: FAIL — cannot find `../src/server.js`.

- [ ] **Step 3: Implement the fixture server**

`packages/fixture-app/src/server.ts`:
```ts
import express from 'express';
import type { Server } from 'node:http';

export type Breakable =
  | 'login-redirect' | 'nav-link' | 'about-image' | 'console-error' | 'items-create' | 'unstyled';

// 1x1 transparent PNG
const OK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

export function createFixtureApp() {
  const broken = new Set<Breakable>();
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  const page = (title: string, body: string) => {
    const style = broken.has('unstyled') ? '' : '<style>body{font:16px sans-serif;margin:2rem}</style>';
    return `<!doctype html><html><head><title>${title}</title>${style}</head><body>${body}</body></html>`;
  };

  app.post('/__break', (req, res) => { broken.add(req.query.feature as Breakable); res.sendStatus(204); });
  app.post('/__reset', (_req, res) => { broken.clear(); res.sendStatus(204); });
  app.get('/__echo-ua', (req, res) => { res.json({ ua: req.headers['user-agent'] ?? '' }); });

  app.get('/', (_req, res) => {
    const navHref = broken.has('nav-link') ? '/gone' : '/about';
    const script = broken.has('console-error') ? '<script>console.error("boom from fixture")</script>' : '';
    res.send(page('Home', `<h1>Demo App</h1>
      <nav><a href="/login">Login</a> <a href="${navHref}">About</a> <a href="/contact">Contact</a></nav>${script}`));
  });

  app.get('/login', (_req, res) =>
    res.send(page('Login', `<h1>Sign in</h1>
      <form method="post" action="/login">
        <input name="email" placeholder="Email">
        <input name="password" type="password" placeholder="Password">
        <button type="submit">Sign in</button>
      </form>`)));

  app.post('/login', (req, res) => {
    if (req.body.email === 'demo@example.com' && req.body.password === 'demo-pass') {
      res.redirect(broken.has('login-redirect') ? '/blank' : '/dashboard');
    } else {
      res.redirect('/login');
    }
  });

  app.get('/dashboard', (_req, res) =>
    res.send(page('Dashboard', `<h1>Welcome back</h1><p>You are logged in.</p><a href="/items">Items</a>`)));

  app.get('/blank', (_req, res) =>
    res.send('<!doctype html><html><head><title>.</title></head><body></body></html>'));

  app.get('/items', (_req, res) =>
    res.send(page('Items', `<h1>Items</h1>
      <form method="post" action="/items">
        <input name="name" placeholder="Item name">
        <button type="submit">Add item</button>
      </form>`)));

  app.post('/items', (req, res) => {
    if (broken.has('items-create')) { res.status(500).send(page('Error', '<h1>Something went wrong</h1>')); return; }
    res.send(page('Items', `<h1>Items</h1><p>Created: ${req.body.name}</p>`));
  });

  app.get('/contact', (_req, res) =>
    res.send(page('Contact', `<h1>Contact us</h1>
      <form method="post" action="/contact">
        <input name="email" placeholder="Your email">
        <textarea name="message" placeholder="Message"></textarea>
        <button type="submit">Send message</button>
      </form>`)));

  app.post('/contact', (_req, res) =>
    res.send(page('Contact', `<h1>Contact us</h1><p>Thanks, we got your message.</p>`)));

  app.get('/about', (_req, res) => {
    const img = broken.has('about-image') ? '/missing.png' : '/ok.png';
    res.send(page('About', `<h1>About</h1><img src="${img}" alt="team"><p>We are a demo company that exists to be tested.</p>`));
  });

  app.get('/ok.png', (_req, res) => { res.type('png').send(OK_PNG); });

  return app;
}

export async function startFixture(port = 0): Promise<{ server: Server; url: string }> {
  const app = createFixtureApp();
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ server, url: `http://127.0.0.1:${actual}` });
    });
  });
}

// Allow `pnpm --filter @vigil/fixture-app start` for manual poking
if (process.argv[1]?.endsWith('server.ts')) {
  startFixture(4999).then(({ url }) => console.log(`fixture app on ${url}`));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/fixture-app test`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/fixture-app
git commit -m "feat: breakable fixture app as the engine test bed"
```

---

### Task 3: Golden-path schema and interpolation

**Files:**
- Create: `packages/engine/src/flows/goldenPath.ts`
- Test: `packages/engine/test/goldenPath.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/goldenPath.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { goldenPathSchema, interpolate } from '../src/flows/goldenPath.js';

const loginFlow = {
  name: 'login',
  requiresLogin: false,
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/login' } },
    { id: 's2', action: { kind: 'fill', selector: 'input[name=email]', value: '{{email}}', description: 'email field' } },
    { id: 's3', action: { kind: 'fill', selector: 'input[name=password]', value: '{{password}}', description: 'password field' } },
    { id: 's4', action: { kind: 'click', selector: 'button[type=submit]', description: 'Sign in button' } },
    { id: 's5', action: { kind: 'expect_url', pattern: '/dashboard$' } },
    { id: 's6', action: { kind: 'expect_text', text: 'Welcome back' } },
  ],
};

describe('goldenPathSchema', () => {
  it('parses a valid flow', () => {
    expect(goldenPathSchema.parse(loginFlow).steps).toHaveLength(6);
  });

  it('rejects an unknown action kind', () => {
    const bad = { ...loginFlow, steps: [{ id: 'x', action: { kind: 'drag' } }] };
    expect(() => goldenPathSchema.parse(bad)).toThrow();
  });

  it('rejects more than 30 steps', () => {
    const big = { ...loginFlow, steps: Array.from({ length: 31 }, (_, i) => ({ id: `s${i}`, action: { kind: 'goto', path: '/' } })) };
    expect(() => goldenPathSchema.parse(big)).toThrow();
  });
});

describe('interpolate', () => {
  const ctx = { email: 'demo@example.com', password: 'demo-pass', runId: 'r1' };
  it('substitutes credentials', () => {
    expect(interpolate('{{email}}', ctx)).toBe('demo@example.com');
    expect(interpolate('{{password}}', ctx)).toBe('demo-pass');
  });
  it('marks synthetic data clearly (spec §6 run hygiene)', () => {
    expect(interpolate('{{unique}}@example.com', ctx)).toBe('vigil-test+r1@example.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test -- goldenPath`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/engine/src/flows/goldenPath.ts`:
```ts
import { z } from 'zod';

export const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('goto'), path: z.string().startsWith('/') }),
  z.object({ kind: z.literal('click'), selector: z.string().min(1), description: z.string() }),
  z.object({ kind: z.literal('fill'), selector: z.string().min(1), value: z.string(), description: z.string() }),
  z.object({ kind: z.literal('expect_text'), text: z.string().min(1) }),
  z.object({ kind: z.literal('expect_url'), pattern: z.string().min(1) }),
]);

export const stepSchema = z.object({ id: z.string().min(1), action: actionSchema });

export const goldenPathSchema = z.object({
  name: z.string().min(1),
  requiresLogin: z.boolean().default(false),
  steps: z.array(stepSchema).min(1).max(30),
});

export type StepAction = z.infer<typeof actionSchema>;
export type Step = z.infer<typeof stepSchema>;
export type GoldenPath = z.infer<typeof goldenPathSchema>;

export interface InterpolationContext {
  email?: string;
  password?: string;
  runId: string;
}

/** Substitutes {{email}} / {{password}} / {{unique}} placeholders. {{unique}} is
 *  deliberately prefixed `vigil-test+` so synthetic data is recognizable (spec §6). */
export function interpolate(value: string, ctx: InterpolationContext): string {
  return value
    .replaceAll('{{email}}', ctx.email ?? '')
    .replaceAll('{{password}}', ctx.password ?? '')
    .replaceAll('{{unique}}', `vigil-test+${ctx.runId}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test -- goldenPath`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: golden-path schema with synthetic-data interpolation"
```

---

### Task 4: Replay executor

**Files:**
- Create: `packages/engine/src/replay/executor.ts`
- Test: `packages/engine/test/executor.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/executor.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { goldenPathSchema } from '../src/flows/goldenPath.js';
import { replayFlow, VIGIL_USER_AGENT } from '../src/replay/executor.js';

let server: Server;
let url: string;
let artifactsDir: string;

beforeAll(async () => {
  ({ server, url } = await startFixture());
  artifactsDir = await mkdtemp(join(tmpdir(), 'vigil-'));
});
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
    { id: 's6', action: { kind: 'expect_text', text: 'Welcome back' } },
  ],
});

const creds = { email: 'demo@example.com', password: 'demo-pass' };

describe('replayFlow', () => {
  it('completes the login flow against a healthy app', async () => {
    const attempt = await replayFlow(loginFlow, { baseUrl: url, credentials: creds, artifactsDir, runId: 't1' });
    expect(attempt.outcome).toBe('completed');
    expect(attempt.steps).toHaveLength(6);
    expect(attempt.steps.every((s) => s.status === 'ok')).toBe(true);
    expect(attempt.steps[0]!.screenshot).toMatch(/\.png$/);
  });

  it('fails at the expect_url step when login redirect is broken', async () => {
    await fetch(`${url}/__break?feature=login-redirect`, { method: 'POST' });
    const attempt = await replayFlow(loginFlow, {
      baseUrl: url, credentials: creds, artifactsDir, runId: 't2', stepTimeoutMs: 3_000,
    });
    expect(attempt.outcome).toBe('failed_step');
    expect(attempt.failedStepId).toBe('s5');
    const failed = attempt.steps.find((s) => s.stepId === 's5');
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBeTruthy();
  });

  it('identifies itself with the Vigil user agent (spec §6 run hygiene)', async () => {
    const uaFlow = goldenPathSchema.parse({
      name: 'ua', steps: [
        { id: 'u1', action: { kind: 'goto', path: '/__echo-ua' } },
        { id: 'u2', action: { kind: 'expect_text', text: 'Vigil-Check' } },
      ],
    });
    const attempt = await replayFlow(uaFlow, { baseUrl: url, artifactsDir, runId: 't3' });
    expect(attempt.outcome).toBe('completed');
    expect(VIGIL_USER_AGENT).toContain('Vigil-Check');
  });

  it('collects console errors emitted by pages it visits', async () => {
    await fetch(`${url}/__break?feature=console-error`, { method: 'POST' });
    const homeFlow = goldenPathSchema.parse({
      name: 'home', steps: [
        { id: 'h1', action: { kind: 'goto', path: '/' } },
        { id: 'h2', action: { kind: 'expect_text', text: 'Demo App' } },
      ],
    });
    const attempt = await replayFlow(homeFlow, { baseUrl: url, artifactsDir, runId: 't4' });
    expect(attempt.consoleErrors.some((e) => e.includes('boom from fixture'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test -- executor`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the executor**

`packages/engine/src/replay/executor.ts`:
```ts
import { chromium, type Page } from 'playwright';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { interpolate, type GoldenPath, type InterpolationContext, type Step } from '../flows/goldenPath.js';

export const VIGIL_USER_AGENT = 'Vigil-Check/0.1 (synthetic monitor; +https://vigil.invalid)';

export interface StepResult {
  stepId: string;
  status: 'ok' | 'failed';
  error?: string;
  screenshot?: string;
  durationMs: number;
}

export interface FlowAttempt {
  outcome: 'completed' | 'failed_step' | 'crashed';
  failedStepId?: string;
  steps: StepResult[];
  consoleErrors: string[];
  error?: string;
}

export interface ReplayOptions {
  baseUrl: string;
  credentials?: { email: string; password: string };
  artifactsDir: string;
  runId: string;
  stepTimeoutMs?: number;
}

async function executeStep(page: Page, step: Step, opts: ReplayOptions, ctx: InterpolationContext, timeout: number): Promise<void> {
  const a = step.action;
  switch (a.kind) {
    case 'goto':
      await page.goto(new URL(a.path, opts.baseUrl).href, { waitUntil: 'load', timeout });
      break;
    case 'click':
      await page.locator(a.selector).first().click({ timeout });
      break;
    case 'fill':
      await page.locator(a.selector).first().fill(interpolate(a.value, ctx), { timeout });
      break;
    case 'expect_text':
      await page.getByText(a.text).first().waitFor({ state: 'visible', timeout });
      break;
    case 'expect_url':
      await page.waitForURL(new RegExp(a.pattern), { timeout });
      break;
  }
}

/** Executes steps on an existing page. Shared by replayFlow and the sweep's login warm-up. */
export async function performSteps(
  page: Page, flow: GoldenPath, opts: ReplayOptions,
): Promise<{ steps: StepResult[]; failedStepId?: string }> {
  const timeout = opts.stepTimeoutMs ?? 15_000;
  const ctx: InterpolationContext = { ...opts.credentials, runId: opts.runId };
  const results: StepResult[] = [];
  await mkdir(opts.artifactsDir, { recursive: true });

  for (const step of flow.steps) {
    const started = Date.now();
    const screenshot = join(opts.artifactsDir, `${flow.name}-${step.id}.png`);
    try {
      await executeStep(page, step, opts, ctx, timeout);
      await page.screenshot({ path: screenshot }).catch(() => undefined);
      results.push({ stepId: step.id, status: 'ok', screenshot, durationMs: Date.now() - started });
    } catch (err) {
      await page.screenshot({ path: screenshot }).catch(() => undefined);
      results.push({
        stepId: step.id, status: 'failed', screenshot,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      });
      return { steps: results, failedStepId: step.id };
    }
  }
  return { steps: results };
}

export async function replayFlow(flow: GoldenPath, opts: ReplayOptions): Promise<FlowAttempt> {
  const consoleErrors: string[] = [];
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ userAgent: VIGIL_USER_AGENT });
    const page = await context.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    const { steps, failedStepId } = await performSteps(page, flow, opts);
    return failedStepId
      ? { outcome: 'failed_step', failedStepId, steps, consoleErrors }
      : { outcome: 'completed', steps, consoleErrors };
  } catch (err) {
    return {
      outcome: 'crashed', steps: [], consoleErrors,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test -- executor`
Expected: PASS (4 tests, ~20–40s — real browser).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: Playwright replay executor with run-hygiene UA and console capture"
```

---

### Task 5: Verdict state machine and retries

Spec §6: retry twice before any verdict; PASS / BROKEN / UNSURE, never binary. In this plan a replay-only BROKEN is *provisional* — Plan 1b inserts HEAL between failure and verdict; the classification contract here is what HEAL will plug into.

**Files:**
- Create: `packages/engine/src/verdict/classify.ts`, `packages/engine/src/verdict/runWithRetries.ts`
- Test: `packages/engine/test/classify.test.ts`, `packages/engine/test/runWithRetries.test.ts`

- [ ] **Step 1: Write the failing classification tests**

`packages/engine/test/classify.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { classifyAttempts } from '../src/verdict/classify.js';
import type { FlowAttempt } from '../src/replay/executor.js';

const completed: FlowAttempt = { outcome: 'completed', steps: [], consoleErrors: [] };
const failedAt = (id: string): FlowAttempt => ({ outcome: 'failed_step', failedStepId: id, steps: [], consoleErrors: [] });
const crashed: FlowAttempt = { outcome: 'crashed', steps: [], consoleErrors: [], error: 'browser died' };

describe('classifyAttempts', () => {
  it('PASS if any attempt completed', () => {
    expect(classifyAttempts([failedAt('s5'), completed]).verdict).toBe('pass');
  });
  it('BROKEN when every attempt fails at the same step', () => {
    const v = classifyAttempts([failedAt('s5'), failedAt('s5'), failedAt('s5')]);
    expect(v.verdict).toBe('broken');
    expect(v.failedStepId).toBe('s5');
  });
  it('UNSURE when attempts fail at different steps', () => {
    expect(classifyAttempts([failedAt('s2'), failedAt('s5'), failedAt('s4')]).verdict).toBe('unsure');
  });
  it('UNSURE when attempts crash (might be us, not them)', () => {
    expect(classifyAttempts([crashed, crashed, crashed]).verdict).toBe('unsure');
  });
});
```

`packages/engine/test/runWithRetries.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { runWithRetries } from '../src/verdict/runWithRetries.js';
import type { FlowAttempt } from '../src/replay/executor.js';

const completed: FlowAttempt = { outcome: 'completed', steps: [], consoleErrors: [] };
const failedAt = (id: string): FlowAttempt => ({ outcome: 'failed_step', failedStepId: id, steps: [], consoleErrors: [] });

describe('runWithRetries', () => {
  it('stops after the first success', async () => {
    let calls = 0;
    const v = await runWithRetries(async () => { calls++; return completed; }, { maxAttempts: 3, backoffMs: 1 });
    expect(v.verdict).toBe('pass');
    expect(calls).toBe(1);
  });

  it('makes 3 attempts before declaring BROKEN (spec §6: retried twice before alerting)', async () => {
    let calls = 0;
    const v = await runWithRetries(async () => { calls++; return failedAt('s5'); }, { maxAttempts: 3, backoffMs: 1 });
    expect(v.verdict).toBe('broken');
    expect(calls).toBe(3);
  });

  it('recovers to PASS when a retry succeeds', async () => {
    let calls = 0;
    const v = await runWithRetries(async () => (++calls < 2 ? failedAt('s1') : completed), { maxAttempts: 3, backoffMs: 1 });
    expect(v.verdict).toBe('pass');
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @vigil/engine test -- classify runWithRetries`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`packages/engine/src/verdict/classify.ts`:
```ts
import type { FlowAttempt } from '../replay/executor.js';

export type Verdict = 'pass' | 'broken' | 'unsure';

export interface FlowVerdict {
  verdict: Verdict;
  failedStepId?: string;
  attempts: FlowAttempt[];
}

/** Spec §4.4: three states, never binary. BROKEN requires consistent failure at one
 *  step across all attempts; anything inconsistent or crash-flavored is UNSURE. */
export function classifyAttempts(attempts: FlowAttempt[]): FlowVerdict {
  if (attempts.some((a) => a.outcome === 'completed')) return { verdict: 'pass', attempts };
  const failurePoints = new Set(attempts.map((a) => a.failedStepId ?? `__${a.outcome}`));
  const only = attempts[0]?.failedStepId;
  if (failurePoints.size === 1 && only) return { verdict: 'broken', failedStepId: only, attempts };
  return { verdict: 'unsure', attempts };
}
```

`packages/engine/src/verdict/runWithRetries.ts`:
```ts
import { setTimeout as sleep } from 'node:timers/promises';
import type { FlowAttempt } from '../replay/executor.js';
import { classifyAttempts, type FlowVerdict } from './classify.js';

export interface RetryOptions { maxAttempts: number; backoffMs: number; }

export async function runWithRetries(
  attempt: () => Promise<FlowAttempt>,
  opts: RetryOptions = { maxAttempts: 3, backoffMs: 2_000 },
): Promise<FlowVerdict> {
  const attempts: FlowAttempt[] = [];
  for (let i = 0; i < opts.maxAttempts; i++) {
    const a = await attempt();
    attempts.push(a);
    if (a.outcome === 'completed') break;
    if (i < opts.maxAttempts - 1) await sleep(opts.backoffMs * (i + 1));
  }
  return classifyAttempts(attempts);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @vigil/engine test -- classify runWithRetries`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: three-state verdict machine with retry-before-alert policy"
```

---

### Task 6: Postgres storage layer

**Files:**
- Create: `docker-compose.yml`, `packages/engine/migrations/001_init.sql`
- Create: `packages/engine/src/env.ts`, `src/db/pool.ts`, `src/db/migrate.ts`, `src/db/crypto.ts`, `src/db/appsRepo.ts`, `src/db/flowsRepo.ts`, `src/db/runsRepo.ts`
- Test: `packages/engine/test/db.test.ts`

- [ ] **Step 1: Infrastructure files**

`docker-compose.yml` (repo root):
```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: vigil
      POSTGRES_PASSWORD: vigil
      POSTGRES_DB: vigil
    ports:
      - "54329:5432"
    volumes:
      - vigil_pg:/var/lib/postgresql/data
volumes:
  vigil_pg:
```

`packages/engine/migrations/001_init.sql`:
```sql
create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

create table apps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  name text not null,
  production_url text not null,
  preview_url text,
  credentials_encrypted text,
  status text not null default 'active' check (status in ('active', 'paused')),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table flows (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references apps(id) on delete cascade,
  name text not null,
  status text not null default 'confirmed' check (status in ('proposed', 'confirmed', 'paused')),
  golden_path jsonb not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  unique (app_id, name)
);

create table runs (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references flows(id) on delete cascade,
  environment text not null default 'production' check (environment in ('production', 'preview')),
  verdict text not null check (verdict in ('pass', 'broken', 'unsure')),
  failed_step_id text,
  attempts jsonb not null,
  duration_ms int not null,
  created_at timestamptz not null default now()
);
create index runs_flow_created_idx on runs (flow_id, created_at desc);

create table sweeps (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references apps(id) on delete cascade,
  pages_visited int not null,
  started_at timestamptz not null default now()
);

create table sweep_pages (
  sweep_id uuid not null references sweeps(id) on delete cascade,
  url text not null,
  http_status int not null,
  load_ms int not null,
  primary key (sweep_id, url)
);

create table sweep_findings (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references apps(id) on delete cascade,
  page_url text not null,
  kind text not null check (kind in ('dead_link','console_error','failed_request','broken_image','unrendered','slow')),
  evidence text not null,
  fingerprint text not null,
  consecutive_count int not null default 1,
  status text not null default 'open' check (status in ('open', 'resolved')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (app_id, fingerprint)
);
```

- [ ] **Step 2: Write the failing test**

`packages/engine/test/db.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { encryptJson, decryptJson } from '../src/db/crypto.js';
import { ensureUser } from '../src/db/appsRepo.js';
import * as apps from '../src/db/appsRepo.js';
import * as flows from '../src/db/flowsRepo.js';
import * as runs from '../src/db/runsRepo.js';

beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings cascade');
});

const flowJson = {
  name: 'login', requiresLogin: false,
  steps: [{ id: 's1', action: { kind: 'goto', path: '/login' } }],
};

describe('crypto', () => {
  it('round-trips credentials', () => {
    const creds = { email: 'a@b.c', password: 'hunter2' };
    expect(decryptJson(encryptJson(creds))).toEqual(creds);
  });
  it('produces different ciphertexts per call (fresh IV)', () => {
    expect(encryptJson({ a: 1 })).not.toBe(encryptJson({ a: 1 }));
  });
});

describe('repositories', () => {
  it('creates an app with encrypted credentials and reads them back', async () => {
    const userId = await ensureUser('founder@vigil.test');
    const app = await apps.createApp({
      userId, name: 'demo', productionUrl: 'http://x.test',
      previewUrl: null, credentials: { email: 'demo@example.com', password: 'demo-pass' },
    });
    const fetched = await apps.getAppByName(userId, 'demo');
    expect(fetched?.id).toBe(app.id);
    expect(fetched?.credentials).toEqual({ email: 'demo@example.com', password: 'demo-pass' });
  });

  it('stores flows and lists only confirmed ones', async () => {
    const userId = await ensureUser('founder@vigil.test');
    const app = await apps.createApp({ userId, name: 'demo', productionUrl: 'http://x.test', previewUrl: null, credentials: null });
    await flows.addFlow(app.id, flowJson, 'confirmed');
    await flows.addFlow(app.id, { ...flowJson, name: 'maybe' }, 'proposed');
    const confirmed = await flows.listConfirmedFlows(app.id);
    expect(confirmed.map((f) => f.goldenPath.name)).toEqual(['login']);
  });

  it('records runs and returns the latest verdict per flow', async () => {
    const userId = await ensureUser('founder@vigil.test');
    const app = await apps.createApp({ userId, name: 'demo', productionUrl: 'http://x.test', previewUrl: null, credentials: null });
    const flow = await flows.addFlow(app.id, flowJson, 'confirmed');
    await runs.insertRun({ flowId: flow.id, environment: 'production', verdict: 'pass', failedStepId: null, attempts: [], durationMs: 1200 });
    await runs.insertRun({ flowId: flow.id, environment: 'production', verdict: 'broken', failedStepId: 's1', attempts: [], durationMs: 900 });
    const latest = await runs.latestVerdicts(app.id);
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ flowName: 'login', verdict: 'broken', failedStepId: 's1' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `docker compose up -d` then `pnpm --filter @vigil/engine test -- db`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement env, pool, migrate, crypto, repos**

`packages/engine/src/env.ts`:
```ts
import 'dotenv/config';

export function env(name: 'DATABASE_URL' | 'VIGIL_SECRET_KEY'): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (copy .env.example to .env)`);
  return v;
}
```

`packages/engine/src/db/pool.ts`:
```ts
import pg from 'pg';
import { env } from '../env.js';

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: env('DATABASE_URL') });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
```

`packages/engine/src/db/migrate.ts`:
```ts
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './pool.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

export async function migrate(): Promise<void> {
  const pool = getPool();
  await pool.query('create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())');
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const { rowCount } = await pool.query('select 1 from _migrations where name = $1', [file]);
    if (rowCount) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into _migrations (name) values ($1)', [file]);
      await client.query('commit');
      console.log(`applied ${file}`);
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  migrate().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
```

`packages/engine/src/db/crypto.ts`:
```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../env.js';

// AES-256-GCM. The key lives only in the runner's environment — the web app
// (Plan 2) never receives it; it stores ciphertext it cannot read (spec §8).
function key(): Buffer {
  const k = Buffer.from(env('VIGIL_SECRET_KEY'), 'hex');
  if (k.length !== 32) throw new Error('VIGIL_SECRET_KEY must be 64 hex chars (32 bytes)');
  return k;
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decryptJson<T>(payload: string): T {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')) as T;
}
```

`packages/engine/src/db/appsRepo.ts`:
```ts
import { getPool } from './pool.js';
import { encryptJson, decryptJson } from './crypto.js';

export interface Credentials { email: string; password: string; }
export interface AppRecord {
  id: string; userId: string; name: string;
  productionUrl: string; previewUrl: string | null;
  credentials: Credentials | null;
}

export async function ensureUser(email: string): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into users (email) values ($1)
     on conflict (email) do update set email = excluded.email
     returning id`, [email]);
  return rows[0]!.id;
}

export async function createApp(input: {
  userId: string; name: string; productionUrl: string;
  previewUrl: string | null; credentials: Credentials | null;
}): Promise<AppRecord> {
  const { rows } = await getPool().query(
    `insert into apps (user_id, name, production_url, preview_url, credentials_encrypted)
     values ($1, $2, $3, $4, $5) returning id`,
    [input.userId, input.name, input.productionUrl, input.previewUrl,
     input.credentials ? encryptJson(input.credentials) : null]);
  return { id: rows[0]!.id as string, ...input };
}

export async function getAppByName(userId: string, name: string): Promise<AppRecord | null> {
  const { rows } = await getPool().query(
    `select id, user_id, name, production_url, preview_url, credentials_encrypted
     from apps where user_id = $1 and name = $2`, [userId, name]);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id, userId: r.user_id, name: r.name,
    productionUrl: r.production_url, previewUrl: r.preview_url,
    credentials: r.credentials_encrypted ? decryptJson(r.credentials_encrypted) : null,
  };
}
```

`packages/engine/src/db/flowsRepo.ts`:
```ts
import { getPool } from './pool.js';
import { goldenPathSchema, type GoldenPath } from '../flows/goldenPath.js';

export interface FlowRecord { id: string; appId: string; status: string; version: number; goldenPath: GoldenPath; }

export async function addFlow(appId: string, goldenPath: unknown, status: 'proposed' | 'confirmed' = 'confirmed'): Promise<FlowRecord> {
  const parsed = goldenPathSchema.parse(goldenPath);
  const { rows } = await getPool().query(
    `insert into flows (app_id, name, status, golden_path) values ($1, $2, $3, $4) returning id, version`,
    [appId, parsed.name, status, JSON.stringify(parsed)]);
  return { id: rows[0]!.id, appId, status, version: rows[0]!.version, goldenPath: parsed };
}

export async function listConfirmedFlows(appId: string): Promise<FlowRecord[]> {
  const { rows } = await getPool().query(
    `select id, app_id, status, version, golden_path from flows
     where app_id = $1 and status = 'confirmed' order by created_at`, [appId]);
  return rows.map((r) => ({
    id: r.id, appId: r.app_id, status: r.status, version: r.version,
    goldenPath: goldenPathSchema.parse(r.golden_path),
  }));
}
```

`packages/engine/src/db/runsRepo.ts`:
```ts
import { getPool } from './pool.js';
import type { FlowAttempt } from '../replay/executor.js';
import type { Verdict } from '../verdict/classify.js';

export async function insertRun(input: {
  flowId: string; environment: 'production' | 'preview'; verdict: Verdict;
  failedStepId: string | null; attempts: FlowAttempt[]; durationMs: number;
}): Promise<string> {
  const { rows } = await getPool().query(
    `insert into runs (flow_id, environment, verdict, failed_step_id, attempts, duration_ms)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [input.flowId, input.environment, input.verdict, input.failedStepId,
     JSON.stringify(input.attempts), input.durationMs]);
  return rows[0]!.id;
}

export interface LatestVerdict { flowName: string; verdict: Verdict; failedStepId: string | null; at: Date; }

export async function latestVerdicts(appId: string): Promise<LatestVerdict[]> {
  const { rows } = await getPool().query(
    `select distinct on (f.id) f.name as flow_name, r.verdict, r.failed_step_id, r.created_at
     from flows f join runs r on r.flow_id = f.id
     where f.app_id = $1
     order by f.id, r.created_at desc`, [appId]);
  return rows.map((r) => ({ flowName: r.flow_name, verdict: r.verdict, failedStepId: r.failed_step_id, at: r.created_at }));
}
```

- [ ] **Step 5: Set up local env and run tests**

```bash
cp .env.example .env
docker compose up -d
pnpm --filter @vigil/engine test -- db
```
Expected: migration applies, then PASS (5 tests). (The placeholder all-zero key in `.env.example` is fine for local dev; production gets a generated one.)

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml packages/engine .env.example
git commit -m "feat: Postgres storage with encrypted credentials and verdict history"
```

---### Task 7: Sweep crawler

Spec §4.3.1 / §6 SWEEP mode: BFS over same-origin pages, objective checks only, no LLM. The `slow` finding is *not* produced here — it needs cross-sweep history, so it's computed in the persistence layer (Task 8).

**Files:**
- Create: `packages/engine/src/sweep/crawler.ts`
- Test: `packages/engine/test/crawler.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/crawler.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { sweepSite } from '../src/sweep/crawler.js';

let server: Server;
let url: string;

beforeAll(async () => ({ server, url } = await startFixture()));
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(async () => { await fetch(`${url}/__reset`, { method: 'POST' }); });

describe('sweepSite', () => {
  it('visits same-origin pages and reports none broken on a healthy site', async () => {
    const result = await sweepSite({ baseUrl: url, maxPages: 20 });
    expect(result.pages.length).toBeGreaterThanOrEqual(4); // home, login, contact, about
    expect(result.findings).toEqual([]);
  });

  it('reports a dead link when nav points at a 404', async () => {
    await fetch(`${url}/__break?feature=nav-link`, { method: 'POST' });
    const result = await sweepSite({ baseUrl: url, maxPages: 20 });
    const dead = result.findings.find((f) => f.kind === 'dead_link');
    expect(dead?.pageUrl).toContain('/gone');
  });

  it('reports console errors', async () => {
    await fetch(`${url}/__break?feature=console-error`, { method: 'POST' });
    const result = await sweepSite({ baseUrl: url, maxPages: 20 });
    const err = result.findings.find((f) => f.kind === 'console_error');
    expect(err?.evidence).toContain('boom from fixture');
  });

  it('reports broken images', async () => {
    await fetch(`${url}/__break?feature=about-image`, { method: 'POST' });
    const result = await sweepSite({ baseUrl: url, maxPages: 20 });
    const img = result.findings.find((f) => f.kind === 'broken_image');
    expect(img?.evidence).toContain('missing.png');
  });

  it('reports pages that render no meaningful content', async () => {
    // /blank is only linked post-login; crawl it directly via extraSeeds
    const result = await sweepSite({ baseUrl: url, maxPages: 20, extraSeeds: ['/blank'] });
    const blank = result.findings.find((f) => f.kind === 'unrendered' && f.pageUrl.endsWith('/blank'));
    expect(blank).toBeTruthy();
  });

  it('respects the page cap', async () => {
    const result = await sweepSite({ baseUrl: url, maxPages: 2 });
    expect(result.pages.length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test -- crawler`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the crawler**

`packages/engine/src/sweep/crawler.ts`:
```ts
import { chromium, type Page } from 'playwright';
import { VIGIL_USER_AGENT, performSteps, type ReplayOptions } from '../replay/executor.js';
import type { GoldenPath } from '../flows/goldenPath.js';

export type FindingKind = 'dead_link' | 'console_error' | 'failed_request' | 'broken_image' | 'unrendered' | 'slow';

export interface SweepFinding { pageUrl: string; kind: FindingKind; evidence: string; }
export interface SweptPage { url: string; httpStatus: number; loadMs: number; }
export interface SweepResult { pages: SweptPage[]; findings: SweepFinding[]; }

export interface SweepOptions {
  baseUrl: string;
  maxPages?: number;
  /** paths seeded into the queue beyond the root (e.g. post-login pages) */
  extraSeeds?: string[];
  /** optional login warm-up executed before crawling (cookies persist in the context) */
  loginFlow?: GoldenPath;
  credentials?: { email: string; password: string };
  pageTimeoutMs?: number;
}

function normalize(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.origin !== new URL(base).origin) return null; // same-origin only
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

async function checkPage(page: Page): Promise<{ brokenImages: string[]; unrendered: boolean }> {
  return page.evaluate(() => {
    const brokenImages = Array.from(document.images)
      .filter((img) => img.complete && img.naturalWidth === 0 && !!img.getAttribute('src'))
      .map((img) => img.getAttribute('src')!);
    const hasStyles = document.styleSheets.length > 0;
    const textLength = (document.body?.innerText ?? '').trim().length;
    return { brokenImages, unrendered: !hasStyles || textLength < 30 };
  });
}

export async function sweepSite(opts: SweepOptions): Promise<SweepResult> {
  const maxPages = opts.maxPages ?? 200;
  const timeout = opts.pageTimeoutMs ?? 20_000;
  const findings: SweepFinding[] = [];
  const pages: SweptPage[] = [];

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ userAgent: VIGIL_USER_AGENT });
    const page = await context.newPage();

    if (opts.loginFlow) {
      const replayOpts: ReplayOptions = {
        baseUrl: opts.baseUrl, credentials: opts.credentials,
        artifactsDir: 'artifacts/sweep-login', runId: `sweep-${Date.now()}`,
      };
      await performSteps(page, opts.loginFlow, replayOpts);
    }

    const queue: string[] = [new URL(opts.baseUrl).href];
    for (const seed of opts.extraSeeds ?? []) {
      const n = normalize(seed, opts.baseUrl);
      if (n) queue.push(n);
    }
    const visited = new Set<string>();

    while (queue.length > 0 && visited.size < maxPages) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const consoleErrors: string[] = [];
      const failedRequests: string[] = [];
      const onConsole = (msg: { type(): string; text(): string }) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); };
      const onPageError = (err: Error) => consoleErrors.push(err.message);
      const onResponse = (res: { status(): number; url(): string }) => {
        if (res.status() >= 400 && res.url() !== current) failedRequests.push(`${res.status()} ${res.url()}`);
      };
      page.on('console', onConsole);
      page.on('pageerror', onPageError);
      page.on('response', onResponse);

      const started = Date.now();
      try {
        const response = await page.goto(current, { waitUntil: 'load', timeout });
        const loadMs = Date.now() - started;
        const status = response?.status() ?? 0;
        pages.push({ url: current, httpStatus: status, loadMs });

        if (status >= 400) {
          findings.push({ pageUrl: current, kind: 'dead_link', evidence: `HTTP ${status}` });
        } else {
          for (const e of consoleErrors) findings.push({ pageUrl: current, kind: 'console_error', evidence: e });
          for (const f of failedRequests) findings.push({ pageUrl: current, kind: 'failed_request', evidence: f });
          const { brokenImages, unrendered } = await checkPage(page);
          for (const src of brokenImages) findings.push({ pageUrl: current, kind: 'broken_image', evidence: src });
          if (unrendered) findings.push({ pageUrl: current, kind: 'unrendered', evidence: 'no stylesheet or fewer than 30 chars of visible text' });

          // Only enqueue links (<a href>), never click anything — sweep is read-only (spec §4.3.1)
          const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')!));
          for (const href of hrefs) {
            const n = normalize(href, current);
            if (n && !visited.has(n)) queue.push(n);
          }
        }
      } catch (err) {
        pages.push({ url: current, httpStatus: 0, loadMs: Date.now() - started });
        findings.push({ pageUrl: current, kind: 'dead_link', evidence: err instanceof Error ? err.message : String(err) });
      } finally {
        page.off('console', onConsole);
        page.off('pageerror', onPageError);
        page.off('response', onResponse);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  return { pages, findings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test -- crawler`
Expected: PASS (6 tests, ~30–60s).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: read-only site sweep crawler with objective breakage checks"
```

---

### Task 8: Sweep persistence — consecutive-count confirmation and slow pages

Spec §6: a finding is only *confirmed* (user-visible) after appearing in two consecutive sweeps; one-off blips are suppressed. `slow` findings compare a page's load time to 3× its median over previous sweeps (floor 3s).

**Files:**
- Create: `packages/engine/src/db/sweepRepo.ts`
- Test: `packages/engine/test/sweepRepo.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/sweepRepo.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, createApp } from '../src/db/appsRepo.js';
import { recordSweep, confirmedFindings } from '../src/db/sweepRepo.js';
import type { SweepResult } from '../src/sweep/crawler.js';

let appId: string;

beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings cascade');
  const userId = await ensureUser('founder@vigil.test');
  appId = (await createApp({ userId, name: 'demo', productionUrl: 'http://x.test', previewUrl: null, credentials: null })).id;
});

const clean: SweepResult = { pages: [{ url: 'http://x.test/', httpStatus: 200, loadMs: 500 }], findings: [] };
const withDeadLink: SweepResult = {
  pages: clean.pages,
  findings: [{ pageUrl: 'http://x.test/gone', kind: 'dead_link', evidence: 'HTTP 404' }],
};

describe('sweep persistence', () => {
  it('does not confirm a finding seen only once', async () => {
    await recordSweep(appId, withDeadLink);
    expect(await confirmedFindings(appId)).toEqual([]);
  });

  it('confirms a finding seen in two consecutive sweeps', async () => {
    await recordSweep(appId, withDeadLink);
    await recordSweep(appId, withDeadLink);
    const confirmed = await confirmedFindings(appId);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]).toMatchObject({ kind: 'dead_link', pageUrl: 'http://x.test/gone' });
  });

  it('resets the streak when a finding disappears (blip suppression)', async () => {
    await recordSweep(appId, withDeadLink);
    await recordSweep(appId, clean);       // gone → resolved
    await recordSweep(appId, withDeadLink); // back → streak restarts at 1
    expect(await confirmedFindings(appId)).toEqual([]);
  });

  it('flags a slow page only against its own history (3x median, 3s floor)', async () => {
    const fast = (ms: number): SweepResult => ({ pages: [{ url: 'http://x.test/p', httpStatus: 200, loadMs: ms }], findings: [] });
    await recordSweep(appId, fast(1000));
    await recordSweep(appId, fast(1100));
    await recordSweep(appId, fast(900));
    // 4s > 3s floor but ~4x median(1000) → slow finding recorded (streak 1, not yet confirmed)
    await recordSweep(appId, fast(4000));
    await recordSweep(appId, fast(4200)); // second consecutive slow → confirmed
    const confirmed = await confirmedFindings(appId);
    expect(confirmed.some((f) => f.kind === 'slow')).toBe(true);
  });

  it('never flags slow under the 3 second floor even if relatively slower', async () => {
    const fast = (ms: number): SweepResult => ({ pages: [{ url: 'http://x.test/p', httpStatus: 200, loadMs: ms }], findings: [] });
    await recordSweep(appId, fast(200));
    await recordSweep(appId, fast(200));
    await recordSweep(appId, fast(2500)); // 12x median but under floor
    await recordSweep(appId, fast(2500));
    expect((await confirmedFindings(appId)).filter((f) => f.kind === 'slow')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test -- sweepRepo`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/engine/src/db/sweepRepo.ts`:
```ts
import { createHash } from 'node:crypto';
import { getPool } from './pool.js';
import type { FindingKind, SweepFinding, SweepResult } from '../sweep/crawler.js';

const SLOW_FLOOR_MS = 3_000;
const SLOW_FACTOR = 3;
const HISTORY_SWEEPS = 7;

function fingerprint(f: SweepFinding): string {
  // Normalize evidence so the same logical finding hashes identically across sweeps
  const evidenceKey = f.kind === 'slow' ? '' : f.evidence.slice(0, 200);
  return createHash('sha256').update(`${f.kind}|${f.pageUrl}|${evidenceKey}`).digest('hex');
}

async function median(values: number[]): Promise<number> {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Computes `slow` findings for this sweep from page history, then upserts all findings:
 *  seen → consecutive_count + 1; not seen → resolved (streak resets via re-insert). */
export async function recordSweep(appId: string, result: SweepResult): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query(
    'insert into sweeps (app_id, pages_visited) values ($1, $2) returning id',
    [appId, result.pages.length]);
  const sweepId = rows[0]!.id as string;

  for (const p of result.pages) {
    await pool.query(
      'insert into sweep_pages (sweep_id, url, http_status, load_ms) values ($1, $2, $3, $4) on conflict do nothing',
      [sweepId, p.url, p.httpStatus, p.loadMs]);
  }

  // Derive slow findings against each page's own history (excluding this sweep)
  const findings: SweepFinding[] = [...result.findings];
  for (const p of result.pages) {
    if (p.httpStatus === 0 || p.httpStatus >= 400) continue;
    const { rows: hist } = await pool.query<{ load_ms: number }>(
      `select sp.load_ms from sweep_pages sp
       join sweeps s on s.id = sp.sweep_id
       where s.app_id = $1 and sp.url = $2 and sp.sweep_id <> $3
       order by s.started_at desc limit $4`,
      [appId, p.url, sweepId, HISTORY_SWEEPS]);
    if (hist.length < 3) continue; // not enough history to judge
    const med = await median(hist.map((h) => h.load_ms));
    if (p.loadMs >= SLOW_FLOOR_MS && med > 0 && p.loadMs >= SLOW_FACTOR * med) {
      findings.push({ pageUrl: p.url, kind: 'slow', evidence: `loaded in ${p.loadMs}ms vs median ${med}ms` });
    }
  }

  const seen: string[] = [];
  for (const f of findings) {
    const fp = fingerprint(f);
    seen.push(fp);
    await pool.query(
      `insert into sweep_findings (app_id, page_url, kind, evidence, fingerprint)
       values ($1, $2, $3, $4, $5)
       on conflict (app_id, fingerprint) do update set
         consecutive_count = case when sweep_findings.status = 'open' then sweep_findings.consecutive_count + 1 else 1 end,
         evidence = excluded.evidence,
         status = 'open',
         last_seen = now()`,
      [appId, f.pageUrl, f.kind, f.evidence, fp]);
  }

  // Anything open that wasn't seen this sweep is resolved (and its streak dies)
  if (seen.length > 0) {
    await pool.query(
      `update sweep_findings set status = 'resolved' where app_id = $1 and status = 'open' and not (fingerprint = any($2))`,
      [appId, seen]);
  } else {
    await pool.query(`update sweep_findings set status = 'resolved' where app_id = $1 and status = 'open'`, [appId]);
  }

  return sweepId;
}

export interface ConfirmedFinding { pageUrl: string; kind: FindingKind; evidence: string; firstSeen: Date; }

/** Spec §6: only findings present in ≥2 consecutive sweeps are user-visible. */
export async function confirmedFindings(appId: string): Promise<ConfirmedFinding[]> {
  const { rows } = await getPool().query(
    `select page_url, kind, evidence, first_seen from sweep_findings
     where app_id = $1 and status = 'open' and consecutive_count >= 2
     order by first_seen`, [appId]);
  return rows.map((r) => ({ pageUrl: r.page_url, kind: r.kind, evidence: r.evidence, firstSeen: r.first_seen }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test -- sweepRepo`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat: sweep persistence with two-sweep confirmation and history-based slow detection"
```

---

### Task 9: CLI — the founder's interface

Ties everything together: `vigil app:add`, `flow:add`, `check`, `sweep`, `report`. This is the working software of Plan 1 — usable on the founder's two live apps the day it lands.

**Files:**
- Create: `packages/engine/src/cli.ts`
- Test: `packages/engine/test/cli.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/cli.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { cmdAppAdd, cmdFlowAdd, cmdCheck, cmdSweep, cmdReport } from '../src/cli.js';

let server: Server;
let url: string;
let dir: string;

beforeAll(async () => {
  await migrate();
  ({ server, url } = await startFixture());
  dir = await mkdtemp(join(tmpdir(), 'vigil-cli-'));
});
afterAll(async () => {
  await closePool();
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings cascade');
  await fetch(`${url}/__reset`, { method: 'POST' });
});

const loginFlowJson = {
  name: 'login',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/login' } },
    { id: 's2', action: { kind: 'fill', selector: 'input[name=email]', value: '{{email}}', description: 'email' } },
    { id: 's3', action: { kind: 'fill', selector: 'input[name=password]', value: '{{password}}', description: 'password' } },
    { id: 's4', action: { kind: 'click', selector: 'button[type=submit]', description: 'Sign in' } },
    { id: 's5', action: { kind: 'expect_url', pattern: '/dashboard$' } },
  ],
};

async function setupApp(): Promise<void> {
  await cmdAppAdd({ name: 'demo', url, loginEmail: 'demo@example.com', loginPassword: 'demo-pass' });
  const flowFile = join(dir, 'login.json');
  await writeFile(flowFile, JSON.stringify(loginFlowJson));
  await cmdFlowAdd('demo', flowFile);
}

describe('vigil CLI', () => {
  it('check reports PASS on a healthy app and exits 0', async () => {
    await setupApp();
    const { exitCode, lines } = await cmdCheck('demo', { retries: 1, stepTimeoutMs: 5_000 });
    expect(exitCode).toBe(0);
    expect(lines.join('\n')).toContain('login');
    expect(lines.join('\n')).toContain('PASS');
  });

  it('check reports BROKEN with the failed step and exits 1 when the app breaks', async () => {
    await setupApp();
    await fetch(`${url}/__break?feature=login-redirect`, { method: 'POST' });
    const { exitCode, lines } = await cmdCheck('demo', { retries: 2, stepTimeoutMs: 3_000 });
    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain('BROKEN');
    expect(lines.join('\n')).toContain('s5');
  });

  it('sweep + report surfaces a confirmed dead link after two sweeps', async () => {
    await setupApp();
    await fetch(`${url}/__break?feature=nav-link`, { method: 'POST' });
    await cmdSweep('demo');
    await cmdSweep('demo');
    const { lines } = await cmdReport('demo');
    expect(lines.join('\n')).toContain('dead_link');
    expect(lines.join('\n')).toContain('/gone');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/engine test -- cli`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the CLI**

`packages/engine/src/cli.ts`:
```ts
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureUser, createApp, getAppByName, type AppRecord } from './db/appsRepo.js';
import { addFlow, listConfirmedFlows } from './db/flowsRepo.js';
import { insertRun, latestVerdicts } from './db/runsRepo.js';
import { recordSweep, confirmedFindings } from './db/sweepRepo.js';
import { replayFlow } from './replay/executor.js';
import { runWithRetries } from './verdict/runWithRetries.js';
import { sweepSite } from './sweep/crawler.js';
import { closePool } from './db/pool.js';

const FOUNDER_EMAIL = process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local';

async function requireApp(name: string): Promise<AppRecord> {
  const userId = await ensureUser(FOUNDER_EMAIL);
  const app = await getAppByName(userId, name);
  if (!app) throw new Error(`No app named "${name}". Add it with: vigil app:add`);
  return app;
}

export async function cmdAppAdd(opts: {
  name: string; url: string; previewUrl?: string;
  loginEmail?: string; loginPassword?: string;
}): Promise<void> {
  const userId = await ensureUser(FOUNDER_EMAIL);
  const credentials = opts.loginEmail && opts.loginPassword
    ? { email: opts.loginEmail, password: opts.loginPassword }
    : null;
  await createApp({
    userId, name: opts.name, productionUrl: opts.url,
    previewUrl: opts.previewUrl ?? null, credentials,
  });
  console.log(`Added app "${opts.name}" → ${opts.url}`);
}

export async function cmdFlowAdd(appName: string, file: string): Promise<void> {
  const app = await requireApp(appName);
  const json = JSON.parse(await readFile(file, 'utf8'));
  const flow = await addFlow(app.id, json, 'confirmed');
  console.log(`Added flow "${flow.goldenPath.name}" (${flow.goldenPath.steps.length} steps) to ${appName}`);
}

export interface CheckOptions { preview?: boolean; retries?: number; stepTimeoutMs?: number; }

export async function cmdCheck(appName: string, opts: CheckOptions = {}): Promise<{ exitCode: number; lines: string[] }> {
  const app = await requireApp(appName);
  const baseUrl = opts.preview ? app.previewUrl : app.productionUrl;
  if (!baseUrl) throw new Error(`App "${appName}" has no ${opts.preview ? 'preview' : 'production'} URL`);
  const flows = await listConfirmedFlows(app.id);
  if (flows.length === 0) throw new Error(`App "${appName}" has no confirmed flows. Add one with: vigil flow:add`);

  const lines: string[] = [];
  let anyBroken = false;
  for (const flow of flows) {
    const started = Date.now();
    const runId = `${Date.now()}-${flow.goldenPath.name}`;
    const verdict = await runWithRetries(
      () => replayFlow(flow.goldenPath, {
        baseUrl, credentials: app.credentials ?? undefined,
        artifactsDir: join('artifacts', runId), runId,
        stepTimeoutMs: opts.stepTimeoutMs,
      }),
      { maxAttempts: opts.retries ?? 3, backoffMs: 2_000 },
    );
    await insertRun({
      flowId: flow.id, environment: opts.preview ? 'preview' : 'production',
      verdict: verdict.verdict, failedStepId: verdict.failedStepId ?? null,
      attempts: verdict.attempts, durationMs: Date.now() - started,
    });
    const mark = verdict.verdict === 'pass' ? '✅ PASS' : verdict.verdict === 'broken' ? '❌ BROKEN' : '⚠️ UNSURE';
    if (verdict.verdict === 'broken') anyBroken = true;
    lines.push(`${mark}  ${flow.goldenPath.name}${verdict.failedStepId ? `  (failed at step ${verdict.failedStepId})` : ''}`);
  }
  for (const l of lines) console.log(l);
  return { exitCode: anyBroken ? 1 : 0, lines };
}

export async function cmdSweep(appName: string): Promise<void> {
  const app = await requireApp(appName);
  const flows = await listConfirmedFlows(app.id);
  const loginFlow = flows.find((f) => f.goldenPath.name === 'login')?.goldenPath;
  const result = await sweepSite({
    baseUrl: app.productionUrl, maxPages: 200,
    loginFlow, credentials: app.credentials ?? undefined,
  });
  await recordSweep(app.id, result);
  console.log(`Swept ${result.pages.length} pages, ${result.findings.length} raw findings (confirmation needs 2 consecutive sweeps)`);
}

export async function cmdReport(appName: string): Promise<{ lines: string[] }> {
  const app = await requireApp(appName);
  const lines: string[] = [];
  lines.push(`# ${appName} — latest verdicts`);
  for (const v of await latestVerdicts(app.id)) {
    lines.push(`${v.verdict.toUpperCase().padEnd(7)} ${v.flowName}${v.failedStepId ? ` (step ${v.failedStepId})` : ''} — ${v.at.toISOString()}`);
  }
  lines.push(`# rest of your app (confirmed sweep findings)`);
  for (const f of await confirmedFindings(app.id)) {
    lines.push(`${f.kind}  ${f.pageUrl}  — ${f.evidence}`);
  }
  for (const l of lines) console.log(l);
  return { lines };
}

// ---- commander wiring (only runs when invoked as a script) ----
if (process.argv[1]?.endsWith('cli.ts')) {
  const program = new Command().name('vigil');
  program.command('app:add')
    .requiredOption('--name <name>').requiredOption('--url <url>')
    .option('--preview-url <url>').option('--login-email <email>').option('--login-password <password>')
    .action(async (o) => { await cmdAppAdd({ name: o.name, url: o.url, previewUrl: o.previewUrl, loginEmail: o.loginEmail, loginPassword: o.loginPassword }); });
  program.command('flow:add').argument('<app>').argument('<file>')
    .action(async (app, file) => { await cmdFlowAdd(app, file); });
  program.command('check').argument('<app>').option('--preview')
    .action(async (app, o) => { const { exitCode } = await cmdCheck(app, { preview: o.preview }); process.exitCode = exitCode; });
  program.command('sweep').argument('<app>')
    .action(async (app) => { await cmdSweep(app); });
  program.command('report').argument('<app>')
    .action(async (app) => { await cmdReport(app); });
  program.hook('postAction', async () => { await closePool(); });
  program.parseAsync().catch((e) => { console.error(e.message); process.exit(2); });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/engine test -- cli`
Expected: PASS (3 tests, ~60–90s — full browser runs with retries).

- [ ] **Step 5: Run the entire suite**

Run: `pnpm test`
Expected: all packages green.

- [ ] **Step 6: Commit**

```bash
git add packages/engine
git commit -m "feat: vigil CLI — app:add, flow:add, check, sweep, report"
```

---

### Task 10: Dogfood on the founder's two live apps

No new code — the acceptance gate from spec §11. Needs from the founder: both app URLs and dummy test logins.

- [ ] **Step 1: Register both apps**

```bash
cd packages/engine
pnpm vigil app:add --name app-one --url <URL_1> --login-email <TEST_EMAIL_1> --login-password <TEST_PASS_1>
pnpm vigil app:add --name app-two --url <URL_2> --login-email <TEST_EMAIL_2> --login-password <TEST_PASS_2>
```
(Real values come from the founder at execution time; they are data, not part of this plan.)

- [ ] **Step 2: Hand-author golden paths**

Write 3–5 flow JSON files per app (login + the app's core actions) following the schema from Task 3, by exploring each app manually in a browser. Add each with `pnpm vigil flow:add <app> <file>`. Keep flow JSONs in a git-ignored `flows-private/` directory (they may reference app internals).

- [ ] **Step 3: Verify clean checks**

Run: `pnpm vigil check app-one && pnpm vigil check app-two`
Expected: all flows PASS. If any flow is UNSURE/BROKEN on a working app, that's an executor bug or a selector problem — fix before proceeding (this is the point of dogfooding).

- [ ] **Step 4: Verify breakage detection (spec §11 exit criterion)**

The founder introduces a deliberate small break in one app via his builder (e.g. rename the login button), then:
Run: `pnpm vigil check app-one`
Expected: the affected flow reports BROKEN at the right step; everything else PASS. Revert the break, re-check, expect PASS (recovery).

- [ ] **Step 5: Verify sweeps**

Run: `pnpm vigil sweep app-one` twice, then `pnpm vigil report app-one`
Expected: report renders; findings (if any) are real issues, not noise. Triage anything that looks like a false positive — each one is an engine bug to fix now, while the only angry customer is us.

- [ ] **Step 6: Commit any fixes; tag the milestone**

```bash
git add -A && git commit -m "fix: engine adjustments from dogfooding on live apps"
git tag plan-1-complete
```

---

## Self-review (performed at write time)

1. **Spec coverage:** §4.4 three-state verdicts → Tasks 5; §6 retries/replay-first/run-hygiene UA + synthetic data → Tasks 3–5; §4.3.1 sweep checks incl. slow-vs-median and read-only crawling → Tasks 7–8; §7 data model (minus `jobs`, deferred to Plan 1b with the worker) → Task 6; §8 credential encryption with runner-only key → Task 6; §12 fixture test bed + dogfooding → Tasks 2, 10. Not covered here by design: MAP/HEAL/DIAGNOSE, queue, scheduler (Plan 1b); web app, billing, email (Plan 2); environments are supported via `--preview` (§4.1).
2. **Placeholder scan:** Task 10 contains `<URL_1>`-style placeholders — intentional: they are runtime data only the founder has, not missing design. No TBDs elsewhere.
3. **Type consistency:** `FlowAttempt`/`StepResult` defined in Task 4 and consumed in Tasks 5, 6, 9; `GoldenPath` from Task 3 used in 4, 6, 7, 9; `SweepResult`/`SweepFinding` from Task 7 consumed in Task 8's repo and Task 9's CLI; `performSteps` exported in Task 4 and reused by the crawler in Task 7. Verified consistent.
