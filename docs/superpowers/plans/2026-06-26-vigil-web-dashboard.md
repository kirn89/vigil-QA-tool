# Web Foundation + Read-Only Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Next.js + Supabase read-only dashboard that renders each user's apps, flow verdicts (PASS/BROKEN/UNSURE) with history, per-step screenshots for failures, and confirmed sweep findings — reading the existing engine data under RLS, with zero engine runtime changes.

**Architecture:** New `packages/web` Next.js (App Router) app on Vercel, using `@supabase/ssr` for magic-link auth and RLS-scoped reads of the shared Supabase Postgres + Storage. Identity links Supabase Auth to the engine's `users` table via a `users.auth_id` column and claim-by-email on first login. All auth/RLS SQL lives in `packages/web/supabase/` and is applied to Supabase only — never through the engine's `migrations/` runner (which runs against embedded Postgres in tests).

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, `@supabase/ssr` + `@supabase/supabase-js`, Vitest + @testing-library/react + jsdom, `pg` (for RLS/claim integration tests via the service role).

## Global Constraints

- New workspace package `packages/web`, name `@vigil/web`. pnpm workspace already globs `packages/*`.
- Supabase is the whole backplane: Auth (magic-link) + Postgres + Storage. Web uses `@supabase/ssr`.
- Env var names (browser-safe): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Server-only: `SUPABASE_SERVICE_KEY`, `SUPABASE_SCREENSHOT_BUCKET`, `DATABASE_URL` (for RLS/claim tests + apply script). The service key is NEVER imported into a client component.
- RLS on from day one; SELECT-only policies; the dashboard is strictly read-only (no INSERT/UPDATE/DELETE from the web).
- Auth/RLS SQL goes in `packages/web/supabase/*.sql`, applied via the web package only. Do NOT add it to `packages/engine/migrations/`.
- Reuse types only from `@vigil/engine` (`Verdict`, `FlowAttempt`, `StepResult`, `FindingKind`) — no runtime/`pg`-repo coupling.
- TypeScript ESM throughout. Tests run with `pnpm --filter @vigil/web test`.
- Screenshot locators look like `Vigil_screenshots/<key>` (Supabase) or a local filesystem path (dev). Supabase locators → signed URLs; local paths → placeholder.

---

## File Structure

- `packages/web/package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.env.example`, `src/app/globals.css`
- `packages/web/src/lib/supabase/server.ts` — RLS-scoped server client (user session)
- `packages/web/src/lib/supabase/service.ts` — service-role client (server-only: signed URLs, claim)
- `packages/web/src/lib/supabase/middleware.ts` — session refresh + route protection
- `packages/web/middleware.ts` — Next middleware entry
- `packages/web/supabase/001_web_rls.sql` — `users.auth_id` + RLS policies (Supabase-only)
- `packages/web/scripts/apply-rls.ts` — applies the SQL to `DATABASE_URL`
- `packages/web/src/lib/claimUser.ts` — claim-by-email linking
- `packages/web/src/app/login/page.tsx`, `src/app/login/actions.ts` — magic-link request
- `packages/web/src/app/auth/callback/route.ts` — code exchange + claim
- `packages/web/src/lib/screenshots.ts` — locator → signed URL / placeholder
- `packages/web/src/lib/data.ts` — RLS-scoped view-model queries (app list, report)
- `packages/web/src/app/page.tsx` — app list
- `packages/web/src/app/apps/[id]/page.tsx` — per-app report
- `packages/web/src/components/{VerdictBadge,FlowReport,FindingsList}.tsx`
- Tests under `packages/web/test/`

---

## Task 1: Scaffold `packages/web` (Next.js + Tailwind + Vitest)

**Files:**
- Create: `packages/web/package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.env.example`, `src/app/globals.css`, `src/app/layout.tsx`, `src/lib/format.ts`
- Test: `packages/web/test/format.test.ts`

**Interfaces:**
- Produces: package `@vigil/web`; `statusLabel(verdict: 'pass'|'broken'|'unsure'|null): string` in `src/lib/format.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/format.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { statusLabel } from '../src/lib/format.js';

describe('statusLabel', () => {
  it('maps verdicts to plain-English, non-alarmist labels', () => {
    expect(statusLabel('pass')).toBe('All clear');
    expect(statusLabel('broken')).toBe('Broken');
    expect(statusLabel('unsure')).toBe('Needs a look');
    expect(statusLabel(null)).toBe('Not checked yet');
  });
});
```

- [ ] **Step 2: Create the package scaffold**

`packages/web/package.json`:

```json
{
  "name": "@vigil/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "db:rls": "tsx scripts/apply-rls.ts"
  },
  "dependencies": {
    "@supabase/ssr": "^0.6.1",
    "@supabase/supabase-js": "^2.45.0",
    "@vigil/engine": "workspace:*",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.1.0",
    "@types/node": "^20.14.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.0",
    "pg": "^8.12.0",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.14",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`packages/web/next.config.mjs`:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };
export default nextConfig;
```

`packages/web/postcss.config.mjs`:

```javascript
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`packages/web/tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss';
export default { content: ['./src/**/*.{ts,tsx}'], theme: { extend: {} }, plugins: [] } satisfies Config;
```

`packages/web/src/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`packages/web/src/app/layout.tsx`:

```tsx
import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'Vigil', description: 'Your app, watched.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
```

`packages/web/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'jsdom', globals: false, include: ['test/**/*.test.{ts,tsx}'] },
});
```

`packages/web/.env.example`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
SUPABASE_SERVICE_KEY=<service-role-key>
SUPABASE_SCREENSHOT_BUCKET=Vigil_screenshots
# Used only by db:rls and RLS/claim tests (the Supabase session pooler string):
DATABASE_URL=postgresql://...pooler.supabase.com:5432/postgres
```

- [ ] **Step 3: Implement `src/lib/format.ts`**

```typescript
export type DisplayVerdict = 'pass' | 'broken' | 'unsure' | null;

/** Plain-English, deliberately non-alarmist labels (false alarms are the top product risk). */
export function statusLabel(verdict: DisplayVerdict): string {
  switch (verdict) {
    case 'pass': return 'All clear';
    case 'broken': return 'Broken';
    case 'unsure': return 'Needs a look';
    default: return 'Not checked yet';
  }
}
```

- [ ] **Step 4: Install and run the test**

Run: `pnpm install && pnpm --filter @vigil/web test format`
Expected: PASS (1 test). Also `pnpm --filter @vigil/web typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/web pnpm-lock.yaml
git commit -m "feat(web): scaffold Next.js + Tailwind + Vitest package"
```

---

## Task 2: Supabase clients (server-session + service-role)

**Files:**
- Create: `packages/web/src/lib/supabase/server.ts`, `packages/web/src/lib/supabase/service.ts`
- Test: `packages/web/test/service.test.ts`

**Interfaces:**
- Produces:
  - `createClient(): Promise<SupabaseClient>` in `server.ts` (RLS-scoped, reads the user's session cookies).
  - `createServiceClient(): SupabaseClient` in `service.ts` (service-role; server-only; bypasses RLS).

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/service.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('createServiceClient', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('constructs a client from the service-role env (no session persistence)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'service-key-123');
    const { createServiceClient } = await import('../src/lib/supabase/service.js');
    const client = createServiceClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
    expect(typeof client.storage.from).toBe('function');
  });

  it('throws a clear error when the service key is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_KEY', '');
    const { createServiceClient } = await import('../src/lib/supabase/service.js');
    expect(() => createServiceClient()).toThrow(/SUPABASE_SERVICE_KEY/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test service`
Expected: FAIL — module `../src/lib/supabase/service.js` not found.

- [ ] **Step 3: Implement the clients**

`packages/web/src/lib/supabase/server.ts`:

```typescript
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/** RLS-scoped client bound to the signed-in user's session cookies. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component; ignored — middleware refreshes the session.
          }
        },
      },
    },
  );
}
```

`packages/web/src/lib/supabase/service.ts`:

```typescript
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/** Server-only service-role client. Bypasses RLS — never import from a client component.
 *  Used for signed URLs and claim-by-email linking. */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  if (!key) throw new Error('Missing SUPABASE_SERVICE_KEY');
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/web test service`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/supabase packages/web/test/service.test.ts
git commit -m "feat(web): supabase server-session and service-role clients"
```

---

## Task 3: RLS migration + apply script + isolation test (Supabase-only)

**Files:**
- Create: `packages/web/supabase/001_web_rls.sql`, `packages/web/scripts/apply-rls.ts`
- Test: `packages/web/test/rls.test.ts`

**Interfaces:**
- Produces: `users.auth_id uuid unique`; SELECT-only RLS policies scoped to `auth.uid()` on `users, apps, flows, runs, sweeps, sweep_pages, sweep_findings, journey_candidates`; `applyRls(connectionString: string): Promise<void>` in `scripts/apply-rls.ts`.

**Note:** The RLS test is an integration test against Supabase (where `auth.uid()` exists). It is **skipped** when `DATABASE_URL` is unset or does not point at a database with the `auth` schema. It seeds via the service role (bypasses RLS), then asserts visibility by switching to the `authenticated` role with a JWT-claims `sub`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/rls.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { applyRls } from '../scripts/apply-rls.js';

const CONN = process.env.DATABASE_URL;
const ssl = (process.env.DATABASE_SSL ?? '').toLowerCase();
const pool = CONN ? new pg.Pool({ connectionString: CONN, ssl: ssl === 'true' || ssl === 'require' ? { rejectUnauthorized: false } : undefined }) : undefined;

async function hasAuthSchema(): Promise<boolean> {
  if (!pool) return false;
  const { rows } = await pool.query("select 1 from information_schema.routines where routine_schema='auth' and routine_name='uid'");
  return rows.length > 0;
}

const maybe = { describe: describe.skip as typeof describe };
let enabled = false;

beforeAll(async () => {
  if (!pool) return;
  enabled = await hasAuthSchema();
  if (enabled) await applyRls(CONN!);
});
afterAll(async () => { await pool?.end(); });

// Seed two owners with one app each; assert each authenticated user sees only their own app.
(enabled ? describe : describe.skip)('RLS isolation', () => {
  it('an authenticated user reads only their own apps', async () => {
    const a = randomUUID(), b = randomUUID();
    const c = await pool!.connect();
    try {
      // Seed via service-role connection (bypasses RLS).
      await c.query("insert into users (id, email, auth_id) values (gen_random_uuid(), $1, $2)", [`a-${a}@t.test`, a]);
      await c.query("insert into users (id, email, auth_id) values (gen_random_uuid(), $1, $2)", [`b-${b}@t.test`, b]);
      const { rows: ua } = await c.query("select id from users where auth_id=$1", [a]);
      const { rows: ub } = await c.query("select id from users where auth_id=$1", [b]);
      await c.query("insert into apps (user_id, name, production_url) values ($1,$2,$3)", [ua[0].id, `appA-${a}`, 'https://a.test']);
      await c.query("insert into apps (user_id, name, production_url) values ($1,$2,$3)", [ub[0].id, `appB-${b}`, 'https://b.test']);

      // As authenticated user A:
      await c.query('begin');
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: a, role: 'authenticated' })]);
      const { rows: visible } = await c.query('select name from apps');
      await c.query('rollback');

      const names = visible.map((r) => r.name);
      expect(names).toContain(`appA-${a}`);
      expect(names).not.toContain(`appB-${b}`);
    } finally {
      // cleanup (service role)
      await c.query("delete from apps where name like $1 or name like $2", [`appA-%`, `appB-%`]).catch(() => {});
      await c.query("delete from users where email like '%@t.test'").catch(() => {});
      c.release();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test rls`
Expected: FAIL — module `../scripts/apply-rls.js` not found. (If `DATABASE_URL` is unset, the suite is skipped — set it to the Supabase pooler string to actually exercise RLS.)

- [ ] **Step 3: Write the RLS SQL (idempotent)**

`packages/web/supabase/001_web_rls.sql`:

```sql
-- Web auth/RLS layer. Applied to SUPABASE ONLY (auth schema required). Never run
-- through the engine migrate() runner (embedded Postgres has no auth.uid()).

alter table users add column if not exists auth_id uuid unique;

alter table users enable row level security;
alter table apps enable row level security;
alter table flows enable row level security;
alter table runs enable row level security;
alter table sweeps enable row level security;
alter table sweep_pages enable row level security;
alter table sweep_findings enable row level security;
alter table journey_candidates enable row level security;

drop policy if exists web_users_select on users;
create policy web_users_select on users for select to authenticated
  using (auth_id = auth.uid());

drop policy if exists web_apps_select on apps;
create policy web_apps_select on apps for select to authenticated
  using (user_id in (select id from users where auth_id = auth.uid()));

drop policy if exists web_flows_select on flows;
create policy web_flows_select on flows for select to authenticated
  using (app_id in (select a.id from apps a join users u on u.id = a.user_id where u.auth_id = auth.uid()));

drop policy if exists web_runs_select on runs;
create policy web_runs_select on runs for select to authenticated
  using (flow_id in (select f.id from flows f join apps a on a.id = f.app_id join users u on u.id = a.user_id where u.auth_id = auth.uid()));

drop policy if exists web_sweeps_select on sweeps;
create policy web_sweeps_select on sweeps for select to authenticated
  using (app_id in (select a.id from apps a join users u on u.id = a.user_id where u.auth_id = auth.uid()));

drop policy if exists web_sweep_pages_select on sweep_pages;
create policy web_sweep_pages_select on sweep_pages for select to authenticated
  using (sweep_id in (select s.id from sweeps s join apps a on a.id = s.app_id join users u on u.id = a.user_id where u.auth_id = auth.uid()));

drop policy if exists web_sweep_findings_select on sweep_findings;
create policy web_sweep_findings_select on sweep_findings for select to authenticated
  using (app_id in (select a.id from apps a join users u on u.id = a.user_id where u.auth_id = auth.uid()));

drop policy if exists web_journey_candidates_select on journey_candidates;
create policy web_journey_candidates_select on journey_candidates for select to authenticated
  using (app_id in (select a.id from apps a join users u on u.id = a.user_id where u.auth_id = auth.uid()));
```

- [ ] **Step 4: Write the apply script**

`packages/web/scripts/apply-rls.ts`:

```typescript
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase');

/** Applies every supabase/*.sql (idempotent) against the given connection. */
export async function applyRls(connectionString: string): Promise<void> {
  const ssl = (process.env.DATABASE_SSL ?? '').toLowerCase();
  const pool = new pg.Pool({ connectionString, ssl: ssl === 'true' || ssl === 'require' ? { rejectUnauthorized: false } : undefined });
  try {
    const sql = await readFile(join(SQL_DIR, '001_web_rls.sql'), 'utf8');
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const conn = process.env.DATABASE_URL;
  if (!conn) { console.error('DATABASE_URL required'); process.exit(1); }
  applyRls(conn).then(() => { console.log('applied web RLS'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL=<supabase-pooler> DATABASE_SSL=true pnpm --filter @vigil/web test rls`
Expected: PASS — user A sees `appA-*`, not `appB-*`. (Without `DATABASE_URL`/auth schema the suite SKIPS; note this in the task report.)

- [ ] **Step 6: Commit**

```bash
git add packages/web/supabase packages/web/scripts packages/web/test/rls.test.ts
git commit -m "feat(web): supabase RLS policies + apply script + isolation test"
```

---

## Task 4: Claim-by-email linking

**Files:**
- Create: `packages/web/src/lib/claimUser.ts`
- Test: `packages/web/test/claimUser.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (uses an injected minimal DB interface for testability).
- Produces: `claimUser(db: ClaimDb, authId: string, email: string): Promise<void>` and `interface ClaimDb { query(sql: string, params: unknown[]): Promise<{ rowCount: number }> }`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/claimUser.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { claimUser, type ClaimDb } from '../src/lib/claimUser.js';

function fakeDb() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db: ClaimDb & { calls: typeof calls; updateRowCount: number } = {
    calls, updateRowCount: 1,
    async query(sql: string, params: unknown[]) {
      calls.push({ sql, params });
      // First call is the UPDATE (claim); return configured rowCount. Insert returns 1.
      if (/^update/i.test(sql.trim())) return { rowCount: db.updateRowCount };
      return { rowCount: 1 };
    },
  };
  return db;
}

describe('claimUser', () => {
  it('claims an existing row by email (UPDATE sets auth_id)', async () => {
    const db = fakeDb();
    await claimUser(db, 'auth-1', 'Founder@Vigil.test');
    const update = db.calls[0]!;
    expect(update.sql).toMatch(/update users set auth_id/i);
    expect(update.params).toEqual(['auth-1', 'founder@vigil.test']); // email lowercased
    expect(db.calls).toHaveLength(1); // no insert needed when a row was claimed
  });

  it('inserts a new linked row when no email match exists', async () => {
    const db = fakeDb();
    db.updateRowCount = 0; // nothing claimed
    await claimUser(db, 'auth-2', 'new@vigil.test');
    expect(db.calls).toHaveLength(2);
    expect(db.calls[1]!.sql).toMatch(/insert into users/i);
    expect(db.calls[1]!.params).toEqual(['new@vigil.test', 'auth-2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test claimUser`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/web/src/lib/claimUser.ts`:

```typescript
export interface ClaimDb {
  query(sql: string, params: unknown[]): Promise<{ rowCount: number }>;
}

/** Link a Supabase auth identity to the engine's users table. Claims a pre-existing
 *  (concierge-created) row by email; if none, inserts a new linked row. Idempotent:
 *  a second call with the same email no longer matches an unlinked row, inserts nothing
 *  new because the email already carries this auth_id. Runs with the service role. */
export async function claimUser(db: ClaimDb, authId: string, email: string): Promise<void> {
  const normalized = email.toLowerCase();
  const claimed = await db.query(
    'update users set auth_id = $1 where lower(email) = $2 and auth_id is null',
    [authId, normalized],
  );
  if (claimed.rowCount === 0) {
    await db.query(
      'insert into users (email, auth_id) values ($1, $2) on conflict (email) do update set auth_id = excluded.auth_id',
      [normalized, authId],
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigil/web test claimUser`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/claimUser.ts packages/web/test/claimUser.test.ts
git commit -m "feat(web): claim-by-email user linking"
```

---

## Task 5: Auth — login page, callback, middleware

**Files:**
- Create: `packages/web/src/app/login/page.tsx`, `packages/web/src/app/login/actions.ts`, `packages/web/src/app/auth/callback/route.ts`, `packages/web/src/lib/supabase/middleware.ts`, `packages/web/middleware.ts`
- Test: `packages/web/test/middleware.test.ts`

**Interfaces:**
- Consumes: `createServiceClient` (Task 2), `claimUser` (Task 4).
- Produces: `isProtectedPath(pathname: string): boolean` in `src/lib/supabase/middleware.ts` (exported for unit testing the redirect rule).

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/middleware.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { isProtectedPath } from '../src/lib/supabase/middleware.js';

describe('isProtectedPath', () => {
  it('treats app pages as protected and auth pages as public', () => {
    expect(isProtectedPath('/')).toBe(true);
    expect(isProtectedPath('/apps/123')).toBe(true);
    expect(isProtectedPath('/login')).toBe(false);
    expect(isProtectedPath('/auth/callback')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test middleware`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement middleware helper + entry**

`packages/web/src/lib/supabase/middleware.ts`:

```typescript
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export function isProtectedPath(pathname: string): boolean {
  return !pathname.startsWith('/login') && !pathname.startsWith('/auth');
}

/** Refresh the session and redirect unauthenticated users away from protected pages. */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user && isProtectedPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return response;
}
```

`packages/web/middleware.ts`:

```typescript
import { type NextRequest } from 'next/server';
import { updateSession } from './src/lib/supabase/middleware.js';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

- [ ] **Step 4: Implement login page + action + callback**

`packages/web/src/app/login/actions.ts`:

```typescript
'use server';
import { createClient } from '../../lib/supabase/server.js';
import { headers } from 'next/headers';

export async function sendMagicLink(_prev: unknown, formData: FormData): Promise<{ message: string }> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { message: 'Enter your email.' };
  const supabase = await createClient();
  const origin = (await headers()).get('origin') ?? '';
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  return { message: error ? `Could not send link: ${error.message}` : 'Check your email for a sign-in link.' };
}
```

`packages/web/src/app/login/page.tsx`:

```tsx
'use client';
import { useActionState } from 'react';
import { sendMagicLink } from './actions.js';

export default function LoginPage() {
  const [state, action, pending] = useActionState(sendMagicLink, { message: '' });
  return (
    <main className="mx-auto max-w-sm px-4 py-24">
      <h1 className="text-2xl font-semibold">Sign in to Vigil</h1>
      <p className="mt-2 text-sm text-neutral-600">We&apos;ll email you a one-time sign-in link.</p>
      <form action={action} className="mt-6 space-y-3">
        <input name="email" type="email" required placeholder="you@example.com"
          className="w-full rounded-md border border-neutral-300 px-3 py-2" />
        <button type="submit" disabled={pending}
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-60">
          {pending ? 'Sending…' : 'Send sign-in link'}
        </button>
      </form>
      {state.message && <p className="mt-4 text-sm text-neutral-700">{state.message}</p>}
    </main>
  );
}
```

`packages/web/src/app/auth/callback/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import pg from 'pg';
import { createClient } from '../../../lib/supabase/server.js';
import { claimUser } from '../../../lib/claimUser.js';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  if (!code) return NextResponse.redirect(`${origin}/login`);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login`);

  const { data: { user } } = await supabase.auth.getUser();
  if (user?.email) {
    const ssl = (process.env.DATABASE_SSL ?? '').toLowerCase();
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: ssl === 'true' || ssl === 'require' ? { rejectUnauthorized: false } : undefined });
    try {
      await claimUser({ query: (sql, params) => pool.query(sql, params).then((r) => ({ rowCount: r.rowCount ?? 0 })) }, user.id, user.email);
    } finally {
      await pool.end();
    }
  }
  return NextResponse.redirect(`${origin}/`);
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm --filter @vigil/web test middleware && pnpm --filter @vigil/web typecheck`
Expected: PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/login packages/web/src/app/auth packages/web/src/lib/supabase/middleware.ts packages/web/middleware.ts packages/web/test/middleware.test.ts
git commit -m "feat(web): magic-link login, callback with claim, session middleware"
```

---

## Task 6: Data layer — view-model queries + screenshot signed URLs

**Files:**
- Create: `packages/web/src/lib/screenshots.ts`, `packages/web/src/lib/data.ts`
- Test: `packages/web/test/screenshots.test.ts`

**Interfaces:**
- Consumes: `FlowAttempt`, `StepResult`, `Verdict`, `FindingKind` from `@vigil/engine`.
- Produces:
  - `parseLocator(locator: string): { bucket: string; key: string } | null` and `signedUrlFor(storage: SignerLike, locator: string, ttlSeconds?: number): Promise<string | null>` in `screenshots.ts`, where `interface SignerLike { from(bucket: string): { createSignedUrl(key: string, ttl: number): Promise<{ data: { signedUrl: string } | null }> } }`.
  - `listApps()`, `getAppReport(appId)` in `data.ts` returning view models: `interface AppSummary { id: string; name: string; worst: 'pass'|'broken'|'unsure'|null }`; `interface FlowReportVM { name: string; verdict: 'pass'|'broken'|'unsure'|null; failedStepId: string|null; at: string|null; shots: string[] }`; `interface FindingVM { kind: FindingKind; pageUrl: string; evidence: string }`; `interface AppReportVM { app: { id: string; name: string }; flows: FlowReportVM[]; findings: FindingVM[] }`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/screenshots.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { parseLocator, signedUrlFor } from '../src/lib/screenshots.js';

describe('parseLocator', () => {
  it('splits a Supabase bucket locator into bucket + key', () => {
    expect(parseLocator('Vigil_screenshots/app/run/s1.png')).toEqual({ bucket: 'Vigil_screenshots', key: 'app/run/s1.png' });
  });
  it('returns null for a local filesystem path', () => {
    expect(parseLocator('/Users/x/artifacts/run/s1.png')).toBeNull();
    expect(parseLocator('artifacts/run/s1.png')).toBeNull();
  });
});

describe('signedUrlFor', () => {
  it('mints a signed URL for a bucket locator', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed/x' } });
    const storage = { from: vi.fn().mockReturnValue({ createSignedUrl }) };
    const url = await signedUrlFor(storage, 'Vigil_screenshots/a/s1.png', 60);
    expect(storage.from).toHaveBeenCalledWith('Vigil_screenshots');
    expect(createSignedUrl).toHaveBeenCalledWith('a/s1.png', 60);
    expect(url).toBe('https://signed/x');
  });
  it('returns null (placeholder) for a local path without calling storage', async () => {
    const storage = { from: vi.fn() };
    expect(await signedUrlFor(storage, '/tmp/s1.png')).toBeNull();
    expect(storage.from).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test screenshots`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `screenshots.ts`**

```typescript
export interface SignerLike {
  from(bucket: string): { createSignedUrl(key: string, ttl: number): Promise<{ data: { signedUrl: string } | null }> };
}

/** A Supabase storage locator is "<bucket>/<key>"; a local dev path is absolute or
 *  starts with "artifacts/". Only the former can be signed. */
export function parseLocator(locator: string): { bucket: string; key: string } | null {
  if (locator.startsWith('/') || locator.startsWith('artifacts/')) return null;
  const slash = locator.indexOf('/');
  if (slash <= 0) return null;
  return { bucket: locator.slice(0, slash), key: locator.slice(slash + 1) };
}

export async function signedUrlFor(storage: SignerLike, locator: string, ttlSeconds = 60): Promise<string | null> {
  const parsed = parseLocator(locator);
  if (!parsed) return null;
  const { data } = await storage.from(parsed.bucket).createSignedUrl(parsed.key, ttlSeconds);
  return data?.signedUrl ?? null;
}
```

- [ ] **Step 4: Implement `data.ts`**

```typescript
import type { FlowAttempt, FindingKind } from '@vigil/engine';
import { createClient } from './supabase/server.js';
import { createServiceClient } from './supabase/service.js';
import { signedUrlFor } from './screenshots.js';

type V = 'pass' | 'broken' | 'unsure';
export interface AppSummary { id: string; name: string; worst: V | null }
export interface FlowReportVM { name: string; verdict: V | null; failedStepId: string | null; at: string | null; shots: string[] }
export interface FindingVM { kind: FindingKind; pageUrl: string; evidence: string }
export interface AppReportVM { app: { id: string; name: string }; flows: FlowReportVM[]; findings: FindingVM[] }

const RANK: Record<V, number> = { broken: 3, unsure: 2, pass: 1 };
function worstOf(verdicts: (V | null)[]): V | null {
  let worst: V | null = null;
  for (const v of verdicts) if (v && (!worst || RANK[v] > RANK[worst])) worst = v;
  return worst;
}

/** Apps for the signed-in user (RLS-scoped), each with its worst current flow verdict. */
export async function listApps(): Promise<AppSummary[]> {
  const sb = await createClient();
  const { data: apps } = await sb.from('apps').select('id,name').order('name');
  const out: AppSummary[] = [];
  for (const a of apps ?? []) {
    const { data: flows } = await sb.from('flows').select('id').eq('app_id', a.id).eq('status', 'confirmed');
    const verdicts: (V | null)[] = [];
    for (const f of flows ?? []) {
      const { data: run } = await sb.from('runs').select('verdict').eq('flow_id', f.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      verdicts.push((run?.verdict as V | undefined) ?? null);
    }
    out.push({ id: a.id, name: a.name, worst: worstOf(verdicts) });
  }
  return out;
}

/** Full report for one app: confirmed flows + latest verdict + failure screenshots,
 *  plus confirmed (>=2 consecutive) sweep findings. All RLS-scoped. */
export async function getAppReport(appId: string): Promise<AppReportVM | null> {
  const sb = await createClient();
  const { data: app } = await sb.from('apps').select('id,name').eq('id', appId).maybeSingle();
  if (!app) return null;

  const storage = createServiceClient().storage;
  const { data: flows } = await sb.from('flows').select('id,name').eq('app_id', appId).eq('status', 'confirmed').order('name');
  const flowVMs: FlowReportVM[] = [];
  for (const f of flows ?? []) {
    const { data: run } = await sb.from('runs')
      .select('verdict,failed_step_id,attempts,created_at')
      .eq('flow_id', f.id).order('created_at', { ascending: false }).limit(1).maybeSingle();

    let shots: string[] = [];
    if (run?.verdict === 'broken' && run.attempts) {
      const attempts = run.attempts as FlowAttempt[];
      const last = attempts[attempts.length - 1];
      const locators = (last?.steps ?? []).map((s) => s.screenshot).filter((x): x is string => !!x);
      const signed = await Promise.all(locators.map((loc) => signedUrlFor(storage, loc)));
      shots = signed.filter((u): u is string => !!u);
    }
    flowVMs.push({
      name: f.name,
      verdict: (run?.verdict as V | undefined) ?? null,
      failedStepId: run?.failed_step_id ?? null,
      at: run?.created_at ?? null,
      shots,
    });
  }

  const { data: findings } = await sb.from('sweep_findings')
    .select('kind,page_url,evidence')
    .eq('app_id', appId).eq('status', 'open').gte('consecutive_count', 2).order('first_seen');

  return {
    app: { id: app.id, name: app.name },
    flows: flowVMs,
    findings: (findings ?? []).map((r) => ({ kind: r.kind as FindingKind, pageUrl: r.page_url, evidence: r.evidence })),
  };
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm --filter @vigil/web test screenshots && pnpm --filter @vigil/web typecheck`
Expected: PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/screenshots.ts packages/web/src/lib/data.ts packages/web/test/screenshots.test.ts
git commit -m "feat(web): RLS-scoped view-model queries + signed screenshot URLs"
```

---

## Task 7: Dashboard pages + components

**Files:**
- Create: `packages/web/src/components/VerdictBadge.tsx`, `packages/web/src/components/FlowReport.tsx`, `packages/web/src/components/FindingsList.tsx`, `packages/web/src/app/page.tsx`, `packages/web/src/app/apps/[id]/page.tsx`
- Test: `packages/web/test/components.test.tsx`

**Interfaces:**
- Consumes: `AppSummary`, `FlowReportVM`, `FindingVM` (Task 6); `statusLabel` (Task 1).
- Produces: presentational components rendering the view models. `VerdictBadge({ verdict })`, `FlowReport({ flow })`, `FindingsList({ findings })`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/components.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VerdictBadge } from '../src/components/VerdictBadge.js';
import { FlowReport } from '../src/components/FlowReport.js';
import { FindingsList } from '../src/components/FindingsList.js';

describe('VerdictBadge', () => {
  it('renders plain-English labels and a non-alarmist style for unsure', () => {
    const { rerender } = render(<VerdictBadge verdict="broken" />);
    expect(screen.getByText('Broken')).toBeTruthy();
    rerender(<VerdictBadge verdict="unsure" />);
    const el = screen.getByText('Needs a look');
    expect(el.className).not.toMatch(/red/); // unsure must not use alarm (red) styling
  });
});

describe('FlowReport', () => {
  it('shows failed step and screenshots only for BROKEN', () => {
    render(<FlowReport flow={{ name: 'login', verdict: 'broken', failedStepId: 's6', at: null, shots: ['https://signed/a.png'] }} />);
    expect(screen.getByText(/login/)).toBeTruthy();
    expect(screen.getByText(/s6/)).toBeTruthy();
    expect(screen.getByRole('img')).toBeTruthy();
  });
  it('shows no failure detail for PASS', () => {
    render(<FlowReport flow={{ name: 'login', verdict: 'pass', failedStepId: null, at: null, shots: [] }} />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('FindingsList', () => {
  it('lists sweep findings, with an all-clear message when empty', () => {
    const { rerender } = render(<FindingsList findings={[{ kind: 'dead_link', pageUrl: 'https://a/x', evidence: 'HTTP 404' }]} />);
    expect(screen.getByText(/HTTP 404/)).toBeTruthy();
    rerender(<FindingsList findings={[]} />);
    expect(screen.getByText(/nothing/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test components`
Expected: FAIL — component modules not found.

- [ ] **Step 3: Implement components**

`packages/web/src/components/VerdictBadge.tsx`:

```tsx
import { statusLabel, type DisplayVerdict } from '../lib/format.js';

const STYLE: Record<'pass' | 'broken' | 'unsure' | 'none', string> = {
  pass: 'bg-green-100 text-green-800',
  broken: 'bg-red-100 text-red-800',
  unsure: 'bg-amber-100 text-amber-800', // amber, never red — UNSURE must not alarm
  none: 'bg-neutral-100 text-neutral-600',
};

export function VerdictBadge({ verdict }: { verdict: DisplayVerdict }) {
  const key = verdict ?? 'none';
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLE[key]}`}>{statusLabel(verdict)}</span>;
}
```

`packages/web/src/components/FlowReport.tsx`:

```tsx
import type { FlowReportVM } from '../lib/data.js';
import { VerdictBadge } from './VerdictBadge.js';

export function FlowReport({ flow }: { flow: FlowReportVM }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium">{flow.name}</span>
        <VerdictBadge verdict={flow.verdict} />
      </div>
      {flow.verdict === 'broken' && (
        <div className="mt-3">
          {flow.failedStepId && <p className="text-sm text-neutral-600">Failed at step {flow.failedStepId}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {flow.shots.map((src, i) => (
              <img key={i} src={src} alt={`step screenshot ${i + 1}`} className="h-32 rounded border border-neutral-200" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

`packages/web/src/components/FindingsList.tsx`:

```tsx
import type { FindingVM } from '../lib/data.js';

export function FindingsList({ findings }: { findings: FindingVM[] }) {
  if (findings.length === 0) return <p className="text-sm text-neutral-500">We found nothing else amiss.</p>;
  return (
    <ul className="space-y-2">
      {findings.map((f, i) => (
        <li key={i} className="rounded-md border border-neutral-200 bg-white p-3 text-sm">
          <span className="font-mono text-xs text-neutral-500">{f.kind}</span>
          <span className="ml-2 break-all">{f.pageUrl}</span>
          <p className="mt-1 text-neutral-700">{f.evidence}</p>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Implement pages**

`packages/web/src/app/page.tsx`:

```tsx
import Link from 'next/link';
import { listApps } from '../lib/data.js';
import { VerdictBadge } from '../components/VerdictBadge.js';

export default async function HomePage() {
  const apps = await listApps();
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-xl font-semibold">Your apps</h1>
      {apps.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-600">No apps yet.</p>
      ) : (
        <ul className="mt-6 space-y-2">
          {apps.map((a) => (
            <li key={a.id}>
              <Link href={`/apps/${a.id}`} className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4 hover:bg-neutral-50">
                <span className="font-medium">{a.name}</span>
                <VerdictBadge verdict={a.worst} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

`packages/web/src/app/apps/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { getAppReport } from '../../../lib/data.js';
import { FlowReport } from '../../../components/FlowReport.js';
import { FindingsList } from '../../../components/FindingsList.js';

export default async function AppReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getAppReport(id);
  if (!report) notFound();
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-xl font-semibold">{report.app.name}</h1>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-neutral-500">Watched flows</h2>
      <div className="mt-3 space-y-3">
        {report.flows.length === 0
          ? <p className="text-sm text-neutral-600">No watched flows yet.</p>
          : report.flows.map((f) => <FlowReport key={f.name} flow={f} />)}
      </div>

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-neutral-500">Rest of your app</h2>
      <div className="mt-3"><FindingsList findings={report.findings} /></div>
    </main>
  );
}
```

- [ ] **Step 5: Run tests + typecheck + build**

Run: `pnpm --filter @vigil/web test && pnpm --filter @vigil/web typecheck && pnpm --filter @vigil/web build`
Expected: all component tests PASS; typecheck clean; `next build` succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components packages/web/src/app/page.tsx packages/web/src/app/apps packages/web/test/components.test.tsx
git commit -m "feat(web): app list + per-app report dashboard pages"
```

---

## Self-Review

**Spec coverage:**
- §3 stack (Next.js/Tailwind/Vercel/@supabase/ssr, `packages/web`) → Task 1.
- §3 Supabase clients (auth session + service role) → Task 2.
- §5.1 `users.auth_id` + §5.2 RLS policies → Task 3 (Supabase-only SQL + apply script).
- §5.1 claim-by-email → Task 4 (logic) + Task 5 (wired into callback).
- §6 login/callback/middleware + magic-link → Task 5.
- §6 app list + per-app report; §7 data flow (RLS reads, latest-verdict, signed URLs, local→placeholder) → Tasks 6 & 7.
- §9 testing: RLS isolation → Task 3; claim-by-email → Task 4; signed URLs → Task 6; report rendering + non-alarmist UNSURE → Task 7. Middleware redirect → Task 5.
- §8 config (env var names, service key server-only) → Task 1 (`.env.example`) + Task 2 (service client server-only).
- §5.3 dogfooding note → operational (set `VIGIL_USER_EMAIL`); no task needed.

**Placeholder scan:** none — every step has concrete code/SQL/commands and expected output.

**Type consistency:** `DisplayVerdict` (Task 1) used by `VerdictBadge` (Task 7). `SignerLike`/`parseLocator`/`signedUrlFor` (Task 6) consistent across `data.ts` and tests. View models `AppSummary`/`FlowReportVM`/`FindingVM`/`AppReportVM` defined in Task 6, consumed by Task 7. `ClaimDb`/`claimUser` (Task 4) consumed by Task 5's callback (adapter wraps `pg` to the `{rowCount}` shape). `createServiceClient` (Task 2) used in Tasks 5 & 6. Engine type imports (`FlowAttempt`, `StepResult`, `FindingKind`, `Verdict`) match `@vigil/engine` exports.

**Cross-cutting note:** RLS/auth SQL is isolated in `packages/web/supabase/` and applied via `pnpm --filter @vigil/web db:rls` — never through the engine `migrations/` runner, so engine embedded-Postgres tests are unaffected (constraint honored).
