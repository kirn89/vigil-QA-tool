# Vigil Web UI — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the "Calm & trustworthy" design system (Direction A) and redesign the four read-only pages — Login, Overview, App report, Flow detail — that render from existing data, plus their empty/loading/error states.

**Architecture:** A Tailwind theme token layer + Inter font; a hand-rolled presentational component kit in `packages/web/src/components`; authenticated pages grouped under a `(app)` route group with a `Sidebar` shell; a new Flow-detail route + read-only data function. Server-components-first; client components only for interaction (login form, sidebar active state, screenshot lightbox). No new runtime deps (native `<dialog>` for the lightbox; Radix deferred).

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS, `next/font` (Inter), Vitest + @testing-library/react.

## Global Constraints

- Visual direction A. Tokens (exact values): page `#FAFAF8`, surface `#FFFFFF`, surface-2 `#F3F2EE`, border `rgba(20,20,16,0.08)`; text primary `#1A1A18`, soft `#6B6B66`, faint `#9A9A93`; brand `#3F4D6B` (hover `#33405C`); pass fg `#0F6E56`/bg `#E1F5EE`; warn(unsure) fg `#854F0B`/bg `#FAEEDA`; broken fg `#A32D2D`/bg `#FCEBEB`.
- Two font weights only: 400 and 500. Never 600/700 (the existing `font-semibold` usages must be replaced with `font-medium`).
- Sentence case everywhere. Monospace reserved for URLs, selectors, console-error text, step ids — never prose/flow-names/headings.
- UNSURE is always amber, never red; calm language ("Needs a look").
- Light mode only (pilot). Components read tokens via Tailwind classes — never hard-coded hex in components (hex lives only in the theme/token config).
- `Check now` is present but visually disabled ("coming soon") — its backend is sub-project 2.2.
- Tests run via `pnpm --filter @vigil/web test`; build via `pnpm --filter @vigil/web build` must pass.
- ESM `.js` import specifiers throughout.

---

## File Structure

- `packages/web/tailwind.config.ts` — extend theme with tokens + Inter font family
- `packages/web/src/app/layout.tsx` — load Inter via `next/font`, set token bg/text
- `packages/web/src/lib/ui.ts` — `statusStyles(verdict)` (label + pill classes), `relativeTime(iso)`
- `packages/web/src/components/`: `VerdictBadge.tsx` (evolve), `EmptyState.tsx`, `ScreenshotStrip.tsx`, `Sidebar.tsx`, `AppCard.tsx`, `FlowRow.tsx` (replaces `FlowReport.tsx`), `FindingItem.tsx` (replaces `FindingsList.tsx`), `RunTimeline.tsx`, `CheckNowButton.tsx`
- `packages/web/src/app/(app)/layout.tsx` — sidebar shell for authenticated pages
- `packages/web/src/app/(app)/page.tsx` — Overview (moved from `src/app/page.tsx`)
- `packages/web/src/app/(app)/apps/[id]/page.tsx` — App report (moved)
- `packages/web/src/app/(app)/apps/[id]/flows/[flowId]/page.tsx` — Flow detail (new)
- `packages/web/src/lib/data.ts` — add `lastChecked`/`history`/`id` to view models; add `getFlowDetail`
- loading/error: `(app)/loading.tsx`, `(app)/apps/[id]/loading.tsx`, `(app)/apps/[id]/not-found.tsx`
- Tests under `packages/web/test/`

Route-group note: moving `page.tsx`/`apps/` into `(app)/` does NOT change their URLs (`/` and `/apps/[id]`); it only attaches the sidebar layout to authenticated pages while keeping `/login` bare.

---

## Task 1: Theme tokens, Inter font, status helper

**Files:**
- Modify: `packages/web/tailwind.config.ts`, `packages/web/src/app/layout.tsx`
- Create: `packages/web/src/lib/ui.ts`
- Test: `packages/web/test/ui.test.ts`

**Interfaces:**
- Produces: `statusStyles(verdict: DisplayVerdict): { label: string; pill: string; dot: string }` and `relativeTime(iso: string | null): string` in `src/lib/ui.ts`. Tailwind tokens: colors `page, surface, surface-2, ink(.soft/.faint), brand(.hover), line, pass.fg/bg, warn.fg/bg, broken.fg/bg`; `fontFamily.sans` = Inter.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/ui.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { statusStyles, relativeTime } from '../src/lib/ui.js';

describe('statusStyles', () => {
  it('maps verdicts to calm labels and tokenized pills', () => {
    expect(statusStyles('pass').label).toBe('All clear');
    expect(statusStyles('pass').pill).toContain('pass');
    expect(statusStyles('broken').label).toBe('Broken');
    expect(statusStyles('broken').pill).toContain('broken');
    const unsure = statusStyles('unsure');
    expect(unsure.label).toBe('Needs a look');
    expect(unsure.pill).toContain('warn');     // amber family
    expect(unsure.pill).not.toContain('broken'); // never red
    expect(statusStyles(null).label).toBe('Not checked yet');
  });
});

describe('relativeTime', () => {
  it('returns a never-checked hint for null and a relative string otherwise', () => {
    expect(relativeTime(null)).toBe('Not checked yet');
    const out = relativeTime(new Date(Date.now() - 2 * 3600_000).toISOString());
    expect(out).toMatch(/hour|hours/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test ui`
Expected: FAIL — module `../src/lib/ui.js` not found.

- [ ] **Step 3: Implement `src/lib/ui.ts`**

```typescript
import { statusLabel, type DisplayVerdict } from './format.js';

/** Calm status pill classes keyed to the Tailwind tokens. UNSURE = warn (amber), never broken (red). */
export function statusStyles(verdict: DisplayVerdict): { label: string; pill: string; dot: string } {
  const map = {
    pass: { pill: 'bg-pass-bg text-pass-fg', dot: 'bg-pass-fg' },
    broken: { pill: 'bg-broken-bg text-broken-fg', dot: 'bg-broken-fg' },
    unsure: { pill: 'bg-warn-bg text-warn-fg', dot: 'bg-warn-fg' },
    none: { pill: 'bg-surface-2 text-ink-faint', dot: 'bg-ink-faint' },
  } as const;
  const key = verdict ?? 'none';
  return { label: statusLabel(verdict), ...map[key] };
}

export function relativeTime(iso: string | null): string {
  if (!iso) return 'Not checked yet';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
```

- [ ] **Step 4: Add tokens to `tailwind.config.ts`**

```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: '#FAFAF8',
        surface: '#FFFFFF',
        'surface-2': '#F3F2EE',
        line: 'rgba(20,20,16,0.08)',
        ink: { DEFAULT: '#1A1A18', soft: '#6B6B66', faint: '#9A9A93' },
        brand: { DEFAULT: '#3F4D6B', hover: '#33405C' },
        pass: { fg: '#0F6E56', bg: '#E1F5EE' },
        warn: { fg: '#854F0B', bg: '#FAEEDA' },
        broken: { fg: '#A32D2D', bg: '#FCEBEB' },
      },
      fontFamily: { sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      borderRadius: { lg: '12px' },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 5: Load Inter + tokens in `src/app/layout.tsx`**

```tsx
import './globals.css';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata = { title: 'Vigil', description: 'Your app, watched.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-page font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: Run test + build**

Run: `pnpm --filter @vigil/web test ui && pnpm --filter @vigil/web build`
Expected: ui tests PASS; `next build` succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/web/tailwind.config.ts packages/web/src/app/layout.tsx packages/web/src/lib/ui.ts packages/web/test/ui.test.ts
git commit -m "feat(web): design tokens, Inter font, calm status helper"
```

---

## Task 2: Primitives — VerdictBadge, EmptyState, ScreenshotStrip

**Files:**
- Modify: `packages/web/src/components/VerdictBadge.tsx`
- Create: `packages/web/src/components/EmptyState.tsx`, `packages/web/src/components/ScreenshotStrip.tsx`
- Test: `packages/web/test/primitives.test.tsx`

**Interfaces:**
- Consumes: `statusStyles` (Task 1), `DisplayVerdict`.
- Produces:
  - `VerdictBadge({ verdict }: { verdict: DisplayVerdict })`
  - `EmptyState({ icon, title, children }: { icon: string; title: string; children?: React.ReactNode })` (icon = Tabler class name string, e.g. `'ti-apps'`)
  - `ScreenshotStrip({ shots }: { shots: string[] })` — client component; thumbnails open a native `<dialog>` lightbox; renders nothing when `shots` is empty.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/primitives.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VerdictBadge } from '../src/components/VerdictBadge.js';
import { EmptyState } from '../src/components/EmptyState.js';
import { ScreenshotStrip } from '../src/components/ScreenshotStrip.js';

describe('VerdictBadge', () => {
  it('renders the calm label and amber (not red) classes for unsure', () => {
    const { rerender } = render(<VerdictBadge verdict="broken" />);
    expect(screen.getByText('Broken')).toBeTruthy();
    rerender(<VerdictBadge verdict="unsure" />);
    const el = screen.getByText('Needs a look');
    expect(el.className).toMatch(/warn/);
    expect(el.className).not.toMatch(/broken/);
  });
});

describe('EmptyState', () => {
  it('renders a title and optional CTA children', () => {
    render(<EmptyState icon="ti-apps" title="No apps yet"><a href="/connect">Connect</a></EmptyState>);
    expect(screen.getByText('No apps yet')).toBeTruthy();
    expect(screen.getByText('Connect')).toBeTruthy();
  });
});

describe('ScreenshotStrip', () => {
  it('renders a thumbnail per shot, nothing when empty', () => {
    const { container, rerender } = render(<ScreenshotStrip shots={['https://s/a.png', 'https://s/b.png']} />);
    expect(screen.getAllByRole('img')).toHaveLength(2);
    rerender(<ScreenshotStrip shots={[]} />);
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test primitives`
Expected: FAIL — `EmptyState`/`ScreenshotStrip` modules not found.

- [ ] **Step 3: Implement `VerdictBadge.tsx` (rebuilt on statusStyles)**

```tsx
import { statusStyles } from '../lib/ui.js';
import type { DisplayVerdict } from '../lib/format.js';

export function VerdictBadge({ verdict }: { verdict: DisplayVerdict }) {
  const s = statusStyles(verdict);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  );
}
```

- [ ] **Step 4: Implement `EmptyState.tsx`**

```tsx
import type { ReactNode } from 'react';

export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-surface px-6 py-12 text-center">
      <i className={`ti ${icon} text-2xl text-ink-faint`} aria-hidden="true" />
      <p className="text-ink-soft">{title}</p>
      {children}
    </div>
  );
}
```

- [ ] **Step 5: Implement `ScreenshotStrip.tsx`**

```tsx
'use client';
import { useRef, useState } from 'react';

export function ScreenshotStrip({ shots }: { shots: string[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [active, setActive] = useState<string | null>(null);
  if (shots.length === 0) return null;
  const open = (src: string) => { setActive(src); dialogRef.current?.showModal(); };
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {shots.map((src, i) => (
        <button key={i} type="button" onClick={() => open(src)} className="rounded-lg border border-line">
          <img src={src} alt={`step screenshot ${i + 1}`} className="h-32 rounded-lg" />
        </button>
      ))}
      <dialog ref={dialogRef} onClick={() => dialogRef.current?.close()} className="rounded-lg p-0 backdrop:bg-black/50">
        {active && <img src={active} alt="screenshot enlarged" className="max-h-[80vh] max-w-[80vw]" />}
      </dialog>
    </div>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @vigil/web test primitives`
Expected: PASS (all three).

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/VerdictBadge.tsx packages/web/src/components/EmptyState.tsx packages/web/src/components/ScreenshotStrip.tsx packages/web/test/primitives.test.tsx
git commit -m "feat(web): VerdictBadge (tokenized) + EmptyState + ScreenshotStrip"
```

---

## Task 3: Sidebar + authenticated app shell

**Files:**
- Create: `packages/web/src/components/Sidebar.tsx`, `packages/web/src/app/(app)/layout.tsx`
- Move: `packages/web/src/app/page.tsx` → `packages/web/src/app/(app)/page.tsx`; `packages/web/src/app/apps/` → `packages/web/src/app/(app)/apps/`
- Test: `packages/web/test/sidebar.test.tsx`

**Interfaces:**
- Consumes: `listApps` (existing) — for nav items.
- Produces: `Sidebar({ apps, activeId }: { apps: { id: string; name: string }[]; activeId?: string })` — client component using `usePathname` for active highlighting; an `(app)` layout that renders `Sidebar` + `children`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/sidebar.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from '../src/components/Sidebar.js';

vi.mock('next/navigation', () => ({ usePathname: () => '/apps/app-1' }));

describe('Sidebar', () => {
  it('lists Overview, the apps, and Settings, marking the active app', () => {
    render(<Sidebar apps={[{ id: 'app-1', name: 'scholarai' }, { id: 'app-2', name: 'settlenepal' }]} />);
    expect(screen.getByText('Overview')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
    const active = screen.getByText('scholarai').closest('a')!;
    expect(active.getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('settlenepal').closest('a')!.getAttribute('aria-current')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test sidebar`
Expected: FAIL — `Sidebar` module not found.

- [ ] **Step 3: Implement `Sidebar.tsx`**

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const itemBase = 'flex items-center gap-2 rounded-lg px-3 py-2 text-sm';

export function Sidebar({ apps }: { apps: { id: string; name: string }[] }) {
  const pathname = usePathname();
  const item = (href: string, label: string, icon: string, active: boolean) => (
    <Link href={href} aria-current={active ? 'page' : undefined}
      className={`${itemBase} ${active ? 'bg-surface-2 text-ink font-medium' : 'text-ink-soft hover:bg-surface-2'}`}>
      <i className={`ti ${icon} text-lg`} aria-hidden="true" />{label}
    </Link>
  );
  return (
    <nav className="flex h-full flex-col gap-1 border-r border-line bg-surface p-3">
      <span className="px-3 py-2 text-sm font-medium text-brand">Vigil</span>
      {item('/', 'Overview', 'ti-layout-dashboard', pathname === '/')}
      <p className="px-3 pt-4 pb-1 text-xs text-ink-faint">Apps</p>
      {apps.map((a) => item(`/apps/${a.id}`, a.name, 'ti-app-window', pathname.startsWith(`/apps/${a.id}`)))}
      <div className="mt-auto">{item('/settings', 'Settings', 'ti-settings', pathname === '/settings')}</div>
    </nav>
  );
}
```

- [ ] **Step 4: Move pages into the `(app)` group and add the layout**

```bash
mkdir -p "packages/web/src/app/(app)"
git mv packages/web/src/app/page.tsx "packages/web/src/app/(app)/page.tsx"
git mv packages/web/src/app/apps "packages/web/src/app/(app)/apps"
```

Create `packages/web/src/app/(app)/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { listApps } from '../../lib/data.js';
import { Sidebar } from '../../components/Sidebar.js';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const apps = await listApps();
  return (
    <div className="grid min-h-screen grid-cols-[220px_1fr]">
      <aside className="sticky top-0 h-screen"><Sidebar apps={apps.map((a) => ({ id: a.id, name: a.name }))} /></aside>
      <main className="min-w-0">{children}</main>
    </div>
  );
}
```

After moving, fix the relative import depth in the moved pages (they gain one directory level): in `(app)/page.tsx` change `../lib/` → `../../lib/` and `../components/` → `../../components/`; in `(app)/apps/[id]/page.tsx` change `../../../lib/` → `../../../../lib/` and `../../../components/` → `../../../../components/`. (These pages are rewritten in Tasks 4–5 anyway; just keep them compiling here.)

- [ ] **Step 5: Run test + build**

Run: `pnpm --filter @vigil/web test sidebar && pnpm --filter @vigil/web build`
Expected: sidebar test PASS; build succeeds; `/` and `/apps/[id]` still compile under the group.

- [ ] **Step 6: Commit**

```bash
git add -A packages/web/src/app packages/web/src/components/Sidebar.tsx packages/web/test/sidebar.test.tsx
git commit -m "feat(web): sidebar nav + authenticated (app) route-group shell"
```

---

## Task 4: AppCard + Overview redesign

**Files:**
- Create: `packages/web/src/components/AppCard.tsx`
- Modify: `packages/web/src/lib/data.ts` (add `lastChecked` to `AppSummary`), `packages/web/src/app/(app)/page.tsx`
- Test: `packages/web/test/appcard.test.tsx`

**Interfaces:**
- Consumes: `VerdictBadge`, `EmptyState`, `relativeTime`, `AppSummary`.
- Produces: `AppCard({ app }: { app: AppSummary })`; `AppSummary` gains `lastChecked: string | null`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/appcard.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppCard } from '../src/components/AppCard.js';

describe('AppCard', () => {
  it('shows the app name, status, and last-checked time', () => {
    render(<AppCard app={{ id: 'a1', name: 'scholarai', worst: 'pass', lastChecked: new Date(Date.now() - 3600_000).toISOString() }} />);
    expect(screen.getByText('scholarai')).toBeTruthy();
    expect(screen.getByText('All clear')).toBeTruthy();
    expect(screen.getByText(/hour ago/)).toBeTruthy();
  });
  it('shows not-checked-yet when never run', () => {
    render(<AppCard app={{ id: 'a2', name: 'demo', worst: null, lastChecked: null }} />);
    expect(screen.getByText('Not checked yet')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test appcard`
Expected: FAIL — `AppCard` module not found.

- [ ] **Step 3: Add `lastChecked` to the data layer**

In `src/lib/data.ts`, change the `AppSummary` interface to:

```typescript
export interface AppSummary { id: string; name: string; worst: V | null; lastChecked: string | null }
```

In `listApps`, track the latest run time while iterating flows and include it. Replace the loop body that builds each app with:

```typescript
  for (const a of apps ?? []) {
    const { data: flows } = await sb.from('flows').select('id').eq('app_id', a.id).eq('status', 'confirmed');
    const verdicts: (V | null)[] = [];
    let lastChecked: string | null = null;
    for (const f of flows ?? []) {
      const { data: run } = await sb.from('runs').select('verdict,created_at').eq('flow_id', f.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      verdicts.push((run?.verdict as V | undefined) ?? null);
      if (run?.created_at && (!lastChecked || run.created_at > lastChecked)) lastChecked = run.created_at;
    }
    out.push({ id: a.id, name: a.name, worst: worstOf(verdicts), lastChecked });
  }
```

- [ ] **Step 4: Implement `AppCard.tsx`**

```tsx
import Link from 'next/link';
import type { AppSummary } from '../lib/data.js';
import { VerdictBadge } from './VerdictBadge.js';
import { relativeTime } from '../lib/ui.js';

export function AppCard({ app }: { app: AppSummary }) {
  return (
    <Link href={`/apps/${app.id}`}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5 hover:border-ink-faint/30">
      <div className="flex items-center justify-between">
        <span className="text-base font-medium">{app.name}</span>
        <VerdictBadge verdict={app.worst} />
      </div>
      <span className="text-xs text-ink-faint">Last checked {relativeTime(app.lastChecked).toLowerCase()}</span>
    </Link>
  );
}
```

- [ ] **Step 5: Rewrite `src/app/(app)/page.tsx`**

```tsx
import { listApps } from '../../lib/data.js';
import { AppCard } from '../../components/AppCard.js';
import { EmptyState } from '../../components/EmptyState.js';

export default async function OverviewPage() {
  const apps = await listApps();
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="text-2xl font-medium">Your apps</h1>
      {apps.length === 0 ? (
        <div className="mt-8">
          <EmptyState icon="ti-apps" title="No apps yet — connect your first one to start watching it.">
            <a href="/connect" className="rounded-lg bg-brand px-4 py-2 text-sm text-white hover:bg-brand-hover">Connect an app</a>
          </EmptyState>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {apps.map((a) => <AppCard key={a.id} app={a} />)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run test + build**

Run: `pnpm --filter @vigil/web test appcard && pnpm --filter @vigil/web typecheck && pnpm --filter @vigil/web build`
Expected: appcard tests PASS; typecheck clean; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/AppCard.tsx packages/web/src/lib/data.ts "packages/web/src/app/(app)/page.tsx" packages/web/test/appcard.test.tsx
git commit -m "feat(web): AppCard + redesigned Overview with empty state"
```

---

## Task 5: FlowRow + FindingItem + CheckNowButton + App report redesign

**Files:**
- Create: `packages/web/src/components/FlowRow.tsx`, `packages/web/src/components/FindingItem.tsx`, `packages/web/src/components/CheckNowButton.tsx`
- Delete: `packages/web/src/components/FlowReport.tsx`, `packages/web/src/components/FindingsList.tsx`
- Modify: `packages/web/src/lib/data.ts` (add `id` to `FlowReportVM`), `packages/web/src/app/(app)/apps/[id]/page.tsx`
- Test: `packages/web/test/report.test.tsx`

**Interfaces:**
- Consumes: `VerdictBadge`, `ScreenshotStrip`, `statusStyles`, `relativeTime`, `FlowReportVM`, `FindingVM`.
- Produces: `FlowRow({ appId, flow })`, `FindingItem({ finding })`, `CheckNowButton()` (disabled "coming soon"); `FlowReportVM` gains `id: string`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/report.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowRow } from '../src/components/FlowRow.js';
import { FindingItem } from '../src/components/FindingItem.js';
import { CheckNowButton } from '../src/components/CheckNowButton.js';

describe('FlowRow', () => {
  it('shows failed step + screenshots only for broken', () => {
    const { rerender } = render(<FlowRow appId="a1" flow={{ id: 'f1', name: 'login', verdict: 'broken', failedStepId: 's6', at: null, shots: ['https://s/a.png'] }} />);
    expect(screen.getByText(/s6/)).toBeTruthy();
    expect(screen.getByRole('img')).toBeTruthy();
    rerender(<FlowRow appId="a1" flow={{ id: 'f1', name: 'login', verdict: 'pass', failedStepId: null, at: null, shots: [] }} />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('FindingItem', () => {
  it('renders kind, page url and evidence', () => {
    render(<FindingItem finding={{ kind: 'dead_link', pageUrl: 'https://a/x', evidence: 'HTTP 404' }} />);
    expect(screen.getByText('HTTP 404')).toBeTruthy();
    expect(screen.getByText(/https:\/\/a\/x/)).toBeTruthy();
  });
});

describe('CheckNowButton', () => {
  it('renders a disabled coming-soon control', () => {
    render(<CheckNowButton />);
    const btn = screen.getByRole('button', { name: /check now/i });
    expect(btn.hasAttribute('disabled')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test report`
Expected: FAIL — component modules not found.

- [ ] **Step 3: Add `id` to `FlowReportVM` and select it**

In `src/lib/data.ts`: change `FlowReportVM` to include `id: string`:

```typescript
export interface FlowReportVM { id: string; name: string; verdict: V | null; failedStepId: string | null; at: string | null; shots: string[] }
```

In `getAppReport`, the flows query already selects `id,name`; add `id: f.id` to the pushed `flowVMs` object:

```typescript
    flowVMs.push({
      id: f.id,
      name: f.name,
      verdict: (run?.verdict as V | undefined) ?? null,
      failedStepId: run?.failed_step_id ?? null,
      at: run?.created_at ?? null,
      shots,
    });
```

- [ ] **Step 4: Implement the three components**

`packages/web/src/components/FlowRow.tsx`:

```tsx
import Link from 'next/link';
import type { FlowReportVM } from '../lib/data.js';
import { VerdictBadge } from './VerdictBadge.js';
import { ScreenshotStrip } from './ScreenshotStrip.js';
import { relativeTime } from '../lib/ui.js';

export function FlowRow({ appId, flow }: { appId: string; flow: FlowReportVM }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <Link href={`/apps/${appId}/flows/${flow.id}`} className="font-medium hover:text-brand">{flow.name}</Link>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-faint">{relativeTime(flow.at).toLowerCase()}</span>
          <VerdictBadge verdict={flow.verdict} />
        </div>
      </div>
      {flow.verdict === 'broken' && (flow.failedStepId || flow.shots.length > 0) && (
        <div className="mt-3">
          {flow.failedStepId && <p className="text-sm text-ink-soft">Failed at step <span className="font-mono text-xs">{flow.failedStepId}</span></p>}
          <ScreenshotStrip shots={flow.shots} />
          <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-faint">A suggested fix will appear here once diagnosis is available.</div>
        </div>
      )}
    </div>
  );
}
```

`packages/web/src/components/FindingItem.tsx`:

```tsx
import type { FindingVM } from '../lib/data.js';

export function FindingItem({ finding }: { finding: FindingVM }) {
  return (
    <li className="rounded-lg border border-line bg-surface p-3 text-sm">
      <span className="font-mono text-xs text-ink-faint">{finding.kind}</span>
      <span className="ml-2 break-all font-mono text-xs text-ink-soft">{finding.pageUrl}</span>
      <p className="mt-1 text-ink">{finding.evidence}</p>
    </li>
  );
}
```

`packages/web/src/components/CheckNowButton.tsx`:

```tsx
export function CheckNowButton() {
  return (
    <button type="button" disabled title="Coming soon"
      className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-sm text-ink-faint">
      <i className="ti ti-player-play" aria-hidden="true" />Check now
      <span className="rounded-full bg-surface px-1.5 py-0.5 text-[11px]">soon</span>
    </button>
  );
}
```

- [ ] **Step 5: Rewrite the App report page + delete old components**

```bash
git rm packages/web/src/components/FlowReport.tsx packages/web/src/components/FindingsList.tsx
```

`packages/web/src/app/(app)/apps/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { getAppReport } from '../../../../lib/data.js';
import { FlowRow } from '../../../../components/FlowRow.js';
import { FindingItem } from '../../../../components/FindingItem.js';
import { CheckNowButton } from '../../../../components/CheckNowButton.js';

export default async function AppReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getAppReport(id);
  if (!report) notFound();
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-medium">{report.app.name}</h1>
        <CheckNowButton />
      </div>

      <h2 className="mt-8 text-sm font-medium text-ink-soft">Watched flows</h2>
      <div className="mt-3 space-y-3">
        {report.flows.length === 0
          ? <p className="text-sm text-ink-soft">No watched flows yet.</p>
          : report.flows.map((f) => <FlowRow key={f.id} appId={report.app.id} flow={f} />)}
      </div>

      <h2 className="mt-10 text-sm font-medium text-ink-soft">Rest of your app</h2>
      {report.findings.length === 0
        ? <p className="mt-3 text-sm text-ink-faint">We found nothing else amiss.</p>
        : <ul className="mt-3 space-y-2">{report.findings.map((f, i) => <FindingItem key={i} finding={f} />)}</ul>}
    </div>
  );
}
```

- [ ] **Step 6: Run test + build**

Run: `pnpm --filter @vigil/web test report && pnpm --filter @vigil/web typecheck && pnpm --filter @vigil/web build`
Expected: report tests PASS; typecheck clean; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A packages/web/src/components packages/web/src/lib/data.ts "packages/web/src/app/(app)/apps/[id]/page.tsx" packages/web/test/report.test.tsx
git commit -m "feat(web): FlowRow + FindingItem + CheckNowButton + redesigned app report"
```

---

## Task 6: Flow detail page + getFlowDetail + RunTimeline

**Files:**
- Modify: `packages/web/src/lib/data.ts` (add `getFlowDetail`)
- Create: `packages/web/src/components/RunTimeline.tsx`, `packages/web/src/app/(app)/apps/[id]/flows/[flowId]/page.tsx`
- Test: `packages/web/test/runtimeline.test.tsx`

**Interfaces:**
- Consumes: `VerdictBadge`, `statusStyles`, `relativeTime`, the supabase server client + engine `GoldenPath` type.
- Produces:
  - `interface FlowDetailVM { flow: { id: string; name: string }; appId: string; runs: { verdict: V; failedStepId: string | null; at: string }[]; steps: { id: string; kind: string; detail: string }[] }`
  - `getFlowDetail(appId: string, flowId: string): Promise<FlowDetailVM | null>`
  - `RunTimeline({ runs }: { runs: FlowDetailVM['runs'] })`

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/runtimeline.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunTimeline } from '../src/components/RunTimeline.js';

describe('RunTimeline', () => {
  it('renders one entry per run with its verdict label', () => {
    render(<RunTimeline runs={[
      { verdict: 'pass', failedStepId: null, at: new Date(Date.now() - 3600_000).toISOString() },
      { verdict: 'broken', failedStepId: 's6', at: new Date(Date.now() - 7200_000).toISOString() },
    ]} />);
    expect(screen.getByText('All clear')).toBeTruthy();
    expect(screen.getByText('Broken')).toBeTruthy();
    expect(screen.getByText(/s6/)).toBeTruthy();
  });
  it('shows an empty hint when there are no runs', () => {
    render(<RunTimeline runs={[]} />);
    expect(screen.getByText(/not checked yet/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test runtimeline`
Expected: FAIL — `RunTimeline` module not found.

- [ ] **Step 3: Implement `RunTimeline.tsx`**

```tsx
import type { FlowDetailVM } from '../lib/data.js';
import { VerdictBadge } from './VerdictBadge.js';
import { relativeTime } from '../lib/ui.js';

export function RunTimeline({ runs }: { runs: FlowDetailVM['runs'] }) {
  if (runs.length === 0) return <p className="text-sm text-ink-faint">Not checked yet.</p>;
  return (
    <ul className="space-y-2">
      {runs.map((r, i) => (
        <li key={i} className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3">
          <span className="text-sm text-ink-soft">
            {relativeTime(r.at)}{r.failedStepId && <> · failed at <span className="font-mono text-xs">{r.failedStepId}</span></>}
          </span>
          <VerdictBadge verdict={r.verdict} />
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Add `getFlowDetail` to `src/lib/data.ts`**

Add the interface and function (uses the existing `createClient`; reads the golden path JSON already stored on `flows.golden_path`):

```typescript
export interface FlowDetailVM {
  flow: { id: string; name: string };
  appId: string;
  runs: { verdict: V; failedStepId: string | null; at: string }[];
  steps: { id: string; kind: string; detail: string }[];
}

export async function getFlowDetail(appId: string, flowId: string): Promise<FlowDetailVM | null> {
  const sb = await createClient();
  const { data: flow } = await sb.from('flows').select('id,name,golden_path').eq('id', flowId).eq('app_id', appId).maybeSingle();
  if (!flow) return null;
  const { data: runs } = await sb.from('runs')
    .select('verdict,failed_step_id,created_at').eq('flow_id', flowId)
    .order('created_at', { ascending: false }).limit(20);
  const gp = flow.golden_path as { steps?: { id: string; action: Record<string, unknown> }[] } | null;
  const steps = (gp?.steps ?? []).map((s) => ({
    id: s.id,
    kind: String(s.action.kind ?? ''),
    detail: String(s.action.path ?? s.action.selector ?? s.action.pattern ?? s.action.text ?? ''),
  }));
  return {
    flow: { id: flow.id, name: flow.name },
    appId,
    runs: (runs ?? []).map((r) => ({ verdict: r.verdict as V, failedStepId: r.failed_step_id ?? null, at: r.created_at })),
    steps,
  };
}
```

- [ ] **Step 5: Create the Flow detail page**

`packages/web/src/app/(app)/apps/[id]/flows/[flowId]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getFlowDetail } from '../../../../../../lib/data.js';
import { RunTimeline } from '../../../../../../components/RunTimeline.js';

export default async function FlowDetailPage({ params }: { params: Promise<{ id: string; flowId: string }> }) {
  const { id, flowId } = await params;
  const detail = await getFlowDetail(id, flowId);
  if (!detail) notFound();
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <Link href={`/apps/${id}`} className="text-sm text-ink-soft hover:text-brand">← Back to {detail.flow.name}&apos;s app</Link>
      <h1 className="mt-2 text-2xl font-medium">{detail.flow.name}</h1>

      <h2 className="mt-8 text-sm font-medium text-ink-soft">Check history</h2>
      <div className="mt-3"><RunTimeline runs={detail.runs} /></div>

      <h2 className="mt-10 text-sm font-medium text-ink-soft">Steps we run</h2>
      <ol className="mt-3 space-y-1">
        {detail.steps.map((s) => (
          <li key={s.id} className="rounded-lg border border-line bg-surface px-4 py-2 text-sm">
            <span className="font-mono text-xs text-ink-faint">{s.kind}</span>
            {s.detail && <span className="ml-2 font-mono text-xs text-ink-soft">{s.detail}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 6: Run test + build**

Run: `pnpm --filter @vigil/web test runtimeline && pnpm --filter @vigil/web typecheck && pnpm --filter @vigil/web build`
Expected: runtimeline tests PASS; typecheck clean; build succeeds (route `/apps/[id]/flows/[flowId]` compiled).

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/lib/data.ts packages/web/src/components/RunTimeline.tsx "packages/web/src/app/(app)/apps/[id]/flows/[flowId]/page.tsx" packages/web/test/runtimeline.test.tsx
git commit -m "feat(web): flow detail page + run timeline + getFlowDetail"
```

---

## Task 7: Login redesign + loading/error states

**Files:**
- Modify: `packages/web/src/app/login/page.tsx`
- Create: `packages/web/src/app/(app)/loading.tsx`, `packages/web/src/app/(app)/apps/[id]/loading.tsx`, `packages/web/src/app/(app)/apps/[id]/not-found.tsx`
- Test: `packages/web/test/login.test.tsx`

**Interfaces:**
- Consumes: existing `sendMagicLink` action.
- Produces: restyled login; route-level loading skeletons + a calm not-found.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/login.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../src/app/login/actions.js', () => ({ sendMagicLink: async () => ({ message: '' }) }));
import LoginPage from '../src/app/login/page.js';

describe('LoginPage', () => {
  it('renders the sign-in heading, email field, and submit', () => {
    render(<LoginPage />);
    expect(screen.getByText(/sign in to vigil/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/you@/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign-in link/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test login`
Expected: FAIL — login page currently uses `font-semibold`/neutral classes; the test passes on text but run it to establish the baseline, then restyle. (If it already passes on text, proceed to restyle in Step 3 and keep it green.)

- [ ] **Step 3: Restyle `src/app/login/page.tsx` with tokens**

```tsx
'use client';
import { useActionState } from 'react';
import { sendMagicLink } from './actions.js';

export default function LoginPage() {
  const [state, action, pending] = useActionState(sendMagicLink, { message: '' });
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <div className="rounded-lg border border-line bg-surface p-8">
        <span className="text-sm font-medium text-brand">Vigil</span>
        <h1 className="mt-4 text-2xl font-medium">Sign in to Vigil</h1>
        <p className="mt-2 text-sm text-ink-soft">We&apos;ll email you a one-time sign-in link.</p>
        <form action={action} className="mt-6 space-y-3">
          <input name="email" type="email" required autoComplete="email" placeholder="you@example.com"
            className="w-full rounded-lg border border-line bg-page px-3 py-2 text-sm outline-none focus:border-brand" />
          <button type="submit" disabled={pending}
            className="w-full rounded-lg bg-brand px-3 py-2 text-sm text-white hover:bg-brand-hover disabled:opacity-60">
            {pending ? 'Sending…' : 'Send sign-in link'}
          </button>
        </form>
        {state.message && <p className="mt-4 text-sm text-ink-soft">{state.message}</p>}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Add loading skeletons + not-found**

`packages/web/src/app/(app)/loading.tsx`:

```tsx
export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="h-7 w-40 rounded bg-surface-2" />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-lg border border-line bg-surface" />)}
      </div>
    </div>
  );
}
```

`packages/web/src/app/(app)/apps/[id]/loading.tsx`:

```tsx
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="h-7 w-48 rounded bg-surface-2" />
      <div className="mt-8 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-lg border border-line bg-surface" />)}</div>
    </div>
  );
}
```

`packages/web/src/app/(app)/apps/[id]/not-found.tsx`:

```tsx
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-20 text-center">
      <p className="text-ink-soft">We couldn&apos;t find that app.</p>
      <Link href="/" className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-sm text-white hover:bg-brand-hover">Back to overview</Link>
    </div>
  );
}
```

- [ ] **Step 5: Run the full web suite + build**

Run: `pnpm --filter @vigil/web test && pnpm --filter @vigil/web typecheck && pnpm --filter @vigil/web build`
Expected: all web tests PASS (RLS test skips offline); typecheck clean; `next build` succeeds with routes `/`, `/login`, `/apps/[id]`, `/apps/[id]/flows/[flowId]`.

- [ ] **Step 6: Commit**

```bash
git add "packages/web/src/app/login/page.tsx" "packages/web/src/app/(app)/loading.tsx" "packages/web/src/app/(app)/apps/[id]/loading.tsx" "packages/web/src/app/(app)/apps/[id]/not-found.tsx" packages/web/test/login.test.tsx
git commit -m "feat(web): restyled login + loading skeletons + not-found"
```

---

## Self-Review

**Spec coverage (Phase A, spec §9):**
- Tokens + Tailwind theme + Inter → Task 1. Status helper (calm labels, amber-not-red) → Task 1/2.
- Component kit: VerdictBadge/EmptyState/ScreenshotStrip → Task 2; Sidebar → Task 3; AppCard → Task 4; FlowRow/FindingItem/CheckNowButton → Task 5; RunTimeline → Task 6. (`Toast` deferred — not needed by the Phase-A read-only pages; login uses an inline message. Noted, not a gap.)
- Pages: Login → Task 7; Overview → Task 4; App report → Task 5; Flow detail → Task 6.
- States: empty (Overview/report/timeline) → Tasks 4/5/6; loading skeletons + not-found → Task 7; error copy via not-found + inline messages.
- Phase-1 read data (verdicts/history/screenshots/findings) surfaced → Tasks 4/5/6. Fix-prompt reserved slot → Task 5. Check-now visual-only/disabled → Task 5.
- Light mode only, two weights (existing `font-semibold` replaced by `font-medium`), sentence case, mono reserved for urls/selectors/step-ids → enforced across Tasks 1–7.

**Placeholder scan:** none — every step has concrete code/commands. The fix-prompt "slot" is intentional UI copy, not a TODO.

**Type consistency:** `DisplayVerdict`/`statusStyles`/`relativeTime` (Task 1) used in Tasks 2/4/5/6. `AppSummary` gains `lastChecked` (Task 4) — consumed by `AppCard`. `FlowReportVM` gains `id` (Task 5) — consumed by `FlowRow` for the flow-detail link. `FlowDetailVM` defined in Task 6, consumed by `RunTimeline` + the flow page. `FindingVM` unchanged. Route-group moves keep URLs identical; relative import depths corrected per task. Deleted `FlowReport`/`FindingsList` (Task 5) are no longer imported anywhere after the report rewrite.
