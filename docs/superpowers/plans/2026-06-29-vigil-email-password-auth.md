# Email+Password Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace magic-link with self-serve email+password auth — register → verify email → sign in, plus forgot/reset password and sign-out.

**Architecture:** Next.js server actions call Supabase Auth (`signUp`/`signInWithPassword`/`resetPasswordForEmail`/`updateUser`/`signOut`); pure validation helpers are unit-tested; a shared `linkUser` server helper runs `claimUser` (existing) at every auth entry to link `users.auth_id`; middleware opens the new auth routes; the email-confirmation + recovery links route through the existing `/auth/callback` (extended with a `next` param).

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, `@supabase/ssr` + `@supabase/supabase-js`, `pg` (linkUser), Vitest + @testing-library/react.

## Global Constraints

- Email + password with **email confirmation required**; **open self-serve** (anyone can register).
- Email delivery is Supabase **built-in** for now (rate-limited); Resend SMTP is a later pre-launch step — do NOT wire Resend here.
- Identity unchanged: `users.auth_id` + `claimUser` (existing). `linkUser` runs at confirm-callback, password sign-in, and reset. Idempotent.
- Password rule: **minimum 8 characters**; signup requires password === confirm.
- Public (unauthenticated-allowed) route prefixes: `/login`, `/signup`, `/forgot-password`, `/auth`. Everything else redirects to `/login`.
- After confirm/sign-in a user lands on `/` (Overview). Add-app onboarding is a later sub-project — not here.
- Design system: tokens via classes (no hex), two font weights (400/500), sentence case, calm plain-English messages.
- Tests: `pnpm --filter @vigil/web test`, `typecheck`, `build` must pass. ESM `.js` import specifiers.

---

## File Structure

- `packages/web/src/lib/authValidation.ts` — `validatePassword`, `validateSignup` (pure) — create
- `packages/web/src/lib/supabase/middleware.ts` — extend `isProtectedPath` — modify
- `packages/web/src/lib/linkUser.ts` — shared server helper (pg pool → claimUser) — create
- `packages/web/src/app/auth/callback/route.ts` — use `linkUser`, honor `next` param — modify
- `packages/web/src/app/signup/page.tsx` + `actions.ts` — create
- `packages/web/src/app/login/page.tsx` + `actions.ts` — rewrite to password
- `packages/web/src/app/forgot-password/page.tsx` + `actions.ts` — create
- `packages/web/src/app/auth/reset/page.tsx` + `actions.ts` — create
- `packages/web/src/app/(app)/actions.ts` — `signOutAction` — create; `packages/web/src/components/Sidebar.tsx` — sign-out button — modify
- Tests under `packages/web/test/`

---

## Task 1: Validation helpers + middleware public paths

**Files:**
- Create: `packages/web/src/lib/authValidation.ts`
- Modify: `packages/web/src/lib/supabase/middleware.ts` (`isProtectedPath`)
- Test: `packages/web/test/authValidation.test.ts`, and extend `packages/web/test/middleware.test.ts`

**Interfaces:**
- Produces: `validatePassword(password: string): string | null`; `validateSignup(email: string, password: string, confirm: string): string | null` (returns an error message or null when valid).

- [ ] **Step 1: Write the failing tests**

Create `packages/web/test/authValidation.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { validatePassword, validateSignup } from '../src/lib/authValidation.js';

describe('validatePassword', () => {
  it('requires at least 8 characters', () => {
    expect(validatePassword('short')).toMatch(/8 characters/);
    expect(validatePassword('longenough')).toBeNull();
  });
});

describe('validateSignup', () => {
  it('requires email, a valid password, and matching confirm', () => {
    expect(validateSignup('', 'longenough', 'longenough')).toMatch(/email/i);
    expect(validateSignup('a@b.co', 'short', 'short')).toMatch(/8 characters/);
    expect(validateSignup('a@b.co', 'longenough', 'different')).toMatch(/match/i);
    expect(validateSignup('a@b.co', 'longenough', 'longenough')).toBeNull();
  });
});
```

Add to `packages/web/test/middleware.test.ts` (inside the existing `describe('isProtectedPath', ...)`):

```typescript
  it('treats signup and forgot-password as public too', () => {
    expect(isProtectedPath('/signup')).toBe(false);
    expect(isProtectedPath('/forgot-password')).toBe(false);
    expect(isProtectedPath('/auth/reset')).toBe(false);
    expect(isProtectedPath('/apps/1')).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @vigil/web test authValidation`
Expected: FAIL — module not found. (middleware test will fail on the new public paths.)

- [ ] **Step 3: Implement `authValidation.ts`**

```typescript
export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  return null;
}

export function validateSignup(email: string, password: string, confirm: string): string | null {
  if (!email.trim()) return 'Enter your email.';
  const pw = validatePassword(password);
  if (pw) return pw;
  if (password !== confirm) return 'Passwords do not match.';
  return null;
}
```

- [ ] **Step 4: Extend `isProtectedPath`**

In `packages/web/src/lib/supabase/middleware.ts`, replace the function body:

```typescript
export function isProtectedPath(pathname: string): boolean {
  const publicPrefixes = ['/login', '/signup', '/forgot-password', '/auth'];
  return !publicPrefixes.some((p) => pathname.startsWith(p));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @vigil/web test authValidation && pnpm --filter @vigil/web test middleware`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/authValidation.ts packages/web/src/lib/supabase/middleware.ts packages/web/test/authValidation.test.ts packages/web/test/middleware.test.ts
git commit -m "feat(web): auth validation helpers + open auth routes in middleware"
```

---

## Task 2: Shared linkUser helper + callback refactor (with next param)

**Files:**
- Create: `packages/web/src/lib/linkUser.ts`
- Modify: `packages/web/src/app/auth/callback/route.ts`
- Test: `packages/web/test/linkUser.test.ts`

**Interfaces:**
- Consumes: `claimUser`, `ClaimDb` (existing).
- Produces: `interface LinkDeps { claim?: (db: ClaimDb, authId: string, email: string) => Promise<void> }`; `linkUser(authId: string, email: string, deps?: LinkDeps): Promise<void>` — opens a `pg` pool and runs `claimUser` (or the injected `claim`).

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/linkUser.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { linkUser } from '../src/lib/linkUser.js';

describe('linkUser', () => {
  it('runs claim with the auth id + email (via injected claim, no real DB)', async () => {
    const claim = vi.fn().mockResolvedValue(undefined);
    await linkUser('auth-1', 'Founder@Vigil.test', { claim });
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim.mock.calls[0][1]).toBe('auth-1');
    expect(claim.mock.calls[0][2]).toBe('Founder@Vigil.test');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test linkUser`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `linkUser.ts`**

```typescript
import pg from 'pg';
import { claimUser, type ClaimDb } from './claimUser.js';

export interface LinkDeps { claim?: (db: ClaimDb, authId: string, email: string) => Promise<void>; }

/** Link a Supabase auth identity to the engine users table, via a short-lived pg pool.
 *  Reused by the confirm callback, password sign-in, and password reset. */
export async function linkUser(authId: string, email: string, deps: LinkDeps = {}): Promise<void> {
  const claim = deps.claim ?? claimUser;
  const ssl = (process.env.DATABASE_SSL ?? '').toLowerCase();
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: ssl === 'true' || ssl === 'require' ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await claim(
      { query: (sql, params) => pool.query(sql, params).then((r) => ({ rowCount: r.rowCount ?? 0 })) },
      authId,
      email,
    );
  } finally {
    await pool.end();
  }
}
```

(The injected `claim` in the test never touches the pool, so no real connection is made; `pool.end()` on an unused pool resolves immediately.)

- [ ] **Step 4: Refactor the callback to use `linkUser` + honor `next`**

Replace `packages/web/src/app/auth/callback/route.ts` with:

```typescript
import { NextResponse } from 'next/server';
import { createClient } from '../../../lib/supabase/server.js';
import { linkUser } from '../../../lib/linkUser.js';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next');
  const next = nextParam && nextParam.startsWith('/') ? nextParam : '/';
  if (!code) return NextResponse.redirect(`${origin}/login`);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login`);

  const { data: { user } } = await supabase.auth.getUser();
  if (user?.email) await linkUser(user.id, user.email);
  return NextResponse.redirect(`${origin}${next}`);
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm --filter @vigil/web test linkUser && pnpm --filter @vigil/web typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/linkUser.ts "packages/web/src/app/auth/callback/route.ts" packages/web/test/linkUser.test.ts
git commit -m "feat(web): shared linkUser helper + callback honors next param"
```

---

## Task 3: Sign-up page + action

**Files:**
- Create: `packages/web/src/app/signup/page.tsx`, `packages/web/src/app/signup/actions.ts`
- Test: `packages/web/test/signup.test.tsx`

**Interfaces:**
- Consumes: `validateSignup` (Task 1), `createClient`.
- Produces: `signUpAction(prev: { message: string }, formData: FormData): Promise<{ message: string; sent?: boolean }>`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/signup.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('../src/app/signup/actions.js', () => ({ signUpAction: async () => ({ message: '' }) }));
import SignupPage from '../src/app/signup/page.js';

describe('SignupPage', () => {
  it('renders email, password, confirm fields and a create-account button', () => {
    render(<SignupPage />);
    expect(screen.getByPlaceholderText(/you@/i)).toBeTruthy();
    expect(screen.getByLabelText(/^password/i)).toBeTruthy();
    expect(screen.getByLabelText(/confirm/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /create account/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /sign in/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test signup`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the action**

`packages/web/src/app/signup/actions.ts`:

```typescript
'use server';
import { headers } from 'next/headers';
import { createClient } from '../../lib/supabase/server.js';
import { validateSignup } from '../../lib/authValidation.js';

export async function signUpAction(_prev: { message: string }, formData: FormData): Promise<{ message: string; sent?: boolean }> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const invalid = validateSignup(email, password, confirm);
  if (invalid) return { message: invalid };

  const supabase = await createClient();
  const origin = (await headers()).get('origin') ?? '';
  const { error } = await supabase.auth.signUp({
    email, password, options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return { message: error.message };
  return { message: 'Check your email to confirm your account.', sent: true };
}
```

- [ ] **Step 4: Implement the page**

`packages/web/src/app/signup/page.tsx`:

```tsx
'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { signUpAction } from './actions.js';

export default function SignupPage() {
  const [state, action, pending] = useActionState(signUpAction, { message: '' });
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <div className="rounded-lg border border-line bg-surface p-8">
        <span className="text-sm font-medium text-brand">Vigil</span>
        <h1 className="mt-4 text-2xl font-medium">Create your account</h1>
        {state.sent ? (
          <p className="mt-4 text-sm text-ink-soft">{state.message}</p>
        ) : (
          <>
            <form action={action} className="mt-6 space-y-3">
              <input name="email" type="email" required autoComplete="email" placeholder="you@example.com"
                className="w-full rounded-lg border border-line bg-page px-3 py-2 text-sm outline-none focus:border-brand" />
              <input name="password" type="password" required autoComplete="new-password" aria-label="Password" placeholder="Password (8+ characters)"
                className="w-full rounded-lg border border-line bg-page px-3 py-2 text-sm outline-none focus:border-brand" />
              <input name="confirm" type="password" required autoComplete="new-password" aria-label="Confirm password" placeholder="Confirm password"
                className="w-full rounded-lg border border-line bg-page px-3 py-2 text-sm outline-none focus:border-brand" />
              <button type="submit" disabled={pending}
                className="w-full rounded-lg bg-brand px-3 py-2 text-sm text-white hover:bg-brand-hover disabled:opacity-60">
                {pending ? 'Creating…' : 'Create account'}
              </button>
            </form>
            {state.message && <p className="mt-4 text-sm text-ink-soft">{state.message}</p>}
          </>
        )}
        <p className="mt-6 text-sm text-ink-soft">Already have an account? <Link href="/login" className="text-brand">Sign in</Link></p>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm --filter @vigil/web test signup && pnpm --filter @vigil/web typecheck`
Expected: PASS; clean.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/signup packages/web/test/signup.test.tsx
git commit -m "feat(web): sign-up page + action (email confirmation)"
```

---

## Task 4: Login rewrite to email+password

**Files:**
- Modify: `packages/web/src/app/login/page.tsx`, `packages/web/src/app/login/actions.ts`
- Test: `packages/web/test/login.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `createClient`, `linkUser` (Task 2).
- Produces: `signInAction(prev: { message: string }, formData: FormData): Promise<{ message: string }>` — on success `redirect('/')`.

- [ ] **Step 1: Rewrite the failing test**

Replace `packages/web/test/login.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('../src/app/login/actions.js', () => ({ signInAction: async () => ({ message: '' }) }));
import LoginPage from '../src/app/login/page.js';

describe('LoginPage', () => {
  it('renders email + password, plus sign-up and forgot-password links', () => {
    render(<LoginPage />);
    expect(screen.getByPlaceholderText(/you@/i)).toBeTruthy();
    expect(screen.getByLabelText(/password/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /create/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /forgot/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test login`
Expected: FAIL — the old magic-link page has no password field / links; and `signInAction` isn't exported yet.

- [ ] **Step 3: Rewrite the action**

Replace `packages/web/src/app/login/actions.ts`:

```typescript
'use server';
import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server.js';
import { linkUser } from '../../lib/linkUser.js';

export async function signInAction(_prev: { message: string }, formData: FormData): Promise<{ message: string }> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { message: 'Enter your email and password.' };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const msg = /confirm/i.test(error.message)
      ? 'Please confirm your email first — check your inbox.'
      : 'Email or password is incorrect.';
    return { message: msg };
  }
  if (data.user?.email) await linkUser(data.user.id, data.user.email);
  redirect('/');
}
```

- [ ] **Step 4: Rewrite the page**

Replace `packages/web/src/app/login/page.tsx`:

```tsx
'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { signInAction } from './actions.js';

export default function LoginPage() {
  const [state, action, pending] = useActionState(signInAction, { message: '' });
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <div className="rounded-lg border border-line bg-surface p-8">
        <span className="text-sm font-medium text-brand">Vigil</span>
        <h1 className="mt-4 text-2xl font-medium">Sign in to Vigil</h1>
        <form action={action} className="mt-6 space-y-3">
          <input name="email" type="email" required autoComplete="email" placeholder="you@example.com"
            className="w-full rounded-lg border border-line bg-page px-3 py-2 text-sm outline-none focus:border-brand" />
          <input name="password" type="password" required autoComplete="current-password" aria-label="Password" placeholder="Password"
            className="w-full rounded-lg border border-line bg-page px-3 py-2 text-sm outline-none focus:border-brand" />
          <button type="submit" disabled={pending}
            className="w-full rounded-lg bg-brand px-3 py-2 text-sm text-white hover:bg-brand-hover disabled:opacity-60">
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        {state.message && <p className="mt-4 text-sm text-ink-soft">{state.message}</p>}
        <div className="mt-6 flex justify-between text-sm text-ink-soft">
          <Link href="/signup" className="text-brand">Create an account</Link>
          <Link href="/forgot-password" className="text-brand">Forgot password?</Link>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm --filter @vigil/web test login && pnpm --filter @vigil/web typecheck`
Expected: PASS; clean.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/login packages/web/test/login.test.tsx
git commit -m "feat(web): email+password login (replaces magic-link) + links"
```

---

## Task 5: Forgot-password + reset pages

**Files:**
- Create: `packages/web/src/app/forgot-password/page.tsx` + `actions.ts`, `packages/web/src/app/auth/reset/page.tsx` + `actions.ts`
- Test: `packages/web/test/reset.test.tsx`

**Interfaces:**
- Consumes: `createClient`, `validatePassword` (Task 1).
- Produces: `requestReset(prev, formData): Promise<{ message: string; sent?: boolean }>`; `updatePasswordAction(prev, formData): Promise<{ message: string }>` (on success `redirect('/')`).

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/reset.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('../src/app/auth/reset/actions.js', () => ({ updatePasswordAction: async () => ({ message: '' }) }));
import ResetPage from '../src/app/auth/reset/page.js';

describe('ResetPage', () => {
  it('renders a new-password + confirm form and an update button', () => {
    render(<ResetPage />);
    expect(screen.getByLabelText(/new password/i)).toBeTruthy();
    expect(screen.getByLabelText(/confirm/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /update password/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test reset`
Expected: FAIL — module not found.

- [ ] **Step 3: Forgot-password action + page**

`packages/web/src/app/forgot-password/actions.ts`:

```typescript
'use server';
import { headers } from 'next/headers';
import { createClient } from '../../lib/supabase/server.js';

export async function requestReset(_prev: { message: string }, formData: FormData): Promise<{ message: string; sent?: boolean }> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { message: 'Enter your email.' };
  const supabase = await createClient();
  const origin = (await headers()).get('origin') ?? '';
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/auth/reset` });
  return { message: 'If that email has an account, a reset link is on its way.', sent: true };
}
```

`packages/web/src/app/forgot-password/page.tsx`:

```tsx
'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { requestReset } from './actions.js';

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(requestReset, { message: '' });
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <div className="rounded-lg border border-line bg-surface p-8">
        <h1 className="text-2xl font-medium">Reset your password</h1>
        {state.sent ? (
          <p className="mt-4 text-sm text-ink-soft">{state.message}</p>
        ) : (
          <>
            <form action={action} className="mt-6 space-y-3">
              <input name="email" type="email" required autoComplete="email" placeholder="you@example.com"
                className="w-full rounded-lg border border-line bg-page px-3 py-2 text-sm outline-none focus:border-brand" />
              <button type="submit" disabled={pending}
                className="w-full rounded-lg bg-brand px-3 py-2 text-sm text-white hover:bg-brand-hover disabled:opacity-60">
                {pending ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            {state.message && <p className="mt-4 text-sm text-ink-soft">{state.message}</p>}
          </>
        )}
        <p className="mt-6 text-sm text-ink-soft"><Link href="/login" className="text-brand">Back to sign in</Link></p>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Reset action + page**

`packages/web/src/app/auth/reset/actions.ts`:

```typescript
'use server';
import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server.js';
import { validatePassword } from '../../../lib/authValidation.js';

export async function updatePasswordAction(_prev: { message: string }, formData: FormData): Promise<{ message: string }> {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const invalid = validatePassword(password);
  if (invalid) return { message: invalid };
  if (password !== confirm) return { message: 'Passwords do not match.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { message: 'This reset link has expired — request a new one.' };
  redirect('/');
}
```

`packages/web/src/app/auth/reset/page.tsx`:

```tsx
'use client';
import { useActionState } from 'react';
import { updatePasswordAction } from './actions.js';

export default function ResetPage() {
  const [state, action, pending] = useActionState(updatePasswordAction, { message: '' });
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <div className="rounded-lg border border-line bg-surface p-8">
        <h1 className="text-2xl font-medium">Choose a new password</h1>
        <form action={action} className="mt-6 space-y-3">
          <input name="password" type="password" required autoComplete="new-password" aria-label="New password" placeholder="New password (8+ characters)"
            className="w-full rounded-lg border border-line bg-page px-3 py-2 text-sm outline-none focus:border-brand" />
          <input name="confirm" type="password" required autoComplete="new-password" aria-label="Confirm new password" placeholder="Confirm new password"
            className="w-full rounded-lg border border-line bg-page px-3 py-2 text-sm outline-none focus:border-brand" />
          <button type="submit" disabled={pending}
            className="w-full rounded-lg bg-brand px-3 py-2 text-sm text-white hover:bg-brand-hover disabled:opacity-60">
            {pending ? 'Updating…' : 'Update password'}
          </button>
        </form>
        {state.message && <p className="mt-4 text-sm text-ink-soft">{state.message}</p>}
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm --filter @vigil/web test reset && pnpm --filter @vigil/web typecheck`
Expected: PASS; clean.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/forgot-password "packages/web/src/app/auth/reset" packages/web/test/reset.test.tsx
git commit -m "feat(web): forgot-password + reset flows"
```

---

## Task 6: Sign-out action + sidebar button

**Files:**
- Create: `packages/web/src/app/(app)/actions.ts`
- Modify: `packages/web/src/components/Sidebar.tsx`
- Test: `packages/web/test/sidebar.test.tsx` (extend)

**Interfaces:**
- Consumes: `createClient`.
- Produces: `signOutAction(): Promise<void>` (`redirect('/login')`); `Sidebar` renders a "Sign out" control.

- [ ] **Step 1: Extend the failing test**

Add to `packages/web/test/sidebar.test.tsx` (the file already mocks `next/navigation` usePathname; add a mock for the action and a case). At the top with the other mocks:

```tsx
vi.mock('../src/app/(app)/actions.js', () => ({ signOutAction: async () => {} }));
```

Inside the existing `describe('Sidebar', ...)`:

```tsx
  it('renders a sign-out control', () => {
    render(<Sidebar apps={[]} />);
    expect(screen.getByRole('button', { name: /sign out/i })).toBeTruthy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigil/web test sidebar`
Expected: FAIL — no sign-out button; action module missing.

- [ ] **Step 3: Implement the sign-out action**

Create `packages/web/src/app/(app)/actions.ts`:

```typescript
'use server';
import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server.js';

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
```

- [ ] **Step 4: Add the sign-out button to the Sidebar footer**

In `packages/web/src/components/Sidebar.tsx`, import the action at the top:

```tsx
import { signOutAction } from '../app/(app)/actions.js';
```

Replace the footer block (currently `<div className="mt-auto">{item('/settings', ...)}</div>`) with the Settings item plus a sign-out form:

```tsx
      <div className="mt-auto flex flex-col gap-1">
        <span className={`${itemBase} cursor-default text-ink-faint`}>
          <i className="ti ti-settings text-lg" aria-hidden="true" />Settings
          <span className="ml-auto rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px]">soon</span>
        </span>
        <form action={signOutAction}>
          <button type="submit" className={`${itemBase} w-full text-ink-soft hover:bg-surface-2`}>
            <i className="ti ti-logout text-lg" aria-hidden="true" />Sign out
          </button>
        </form>
      </div>
```

(This also resolves the earlier stubbed `/settings` link — it becomes a non-navigating "soon" item, consistent with the deferred-routes pattern.)

- [ ] **Step 5: Run tests + typecheck + build**

Run: `pnpm --filter @vigil/web test && pnpm --filter @vigil/web typecheck && pnpm --filter @vigil/web build`
Expected: full web suite PASS (RLS skips offline); typecheck clean; `next build` succeeds with routes `/login`, `/signup`, `/forgot-password`, `/auth/reset`, `/auth/callback`, `/`, `/apps/[id]`, `/apps/[id]/flows/[flowId]`.

- [ ] **Step 6: Commit**

```bash
git add "packages/web/src/app/(app)/actions.ts" packages/web/src/components/Sidebar.tsx packages/web/test/sidebar.test.tsx
git commit -m "feat(web): sign-out action + sidebar control"
```

---

## Self-Review

**Spec coverage:**
- §3.1 signup → Task 3; §3.2 callback (confirm + claim, next param) → Task 2; §3.3 password login → Task 4; §3.4 forgot → Task 5; §3.5 reset → Task 5; §3.6 sign-out → Task 6.
- §4 identity linking (linkUser at callback + login + reset) → Task 2 (helper + callback), Task 4 (login), Task 5 (reset).
- §5 middleware public paths → Task 1.
- §6 Supabase config → operator steps (below); no code task (dashboard settings).
- §7 error/UX (calm messages, confirm-email hint, expired-link) → Tasks 4/5.
- §8 testing: validation + isProtectedPath (Task 1), linkUser (Task 2), page renders (Tasks 3/4/5/6). Live admin-user sign-in + real register e2e → controller/operator (below), not a code task.
- §9 non-goals (Resend, onboarding, OAuth) → excluded.

**Operator/controller steps (not code tasks, run at/after execution):**
1. Supabase dashboard per §6: Email provider on + confirm-email ON; allow new users ON; Site URL + redirect URLs include `/auth/callback` and `/auth/reset` (prod + `http://localhost:3000`).
2. Live check (controller): create a pre-confirmed user via `auth.admin.createUser({ email, password, email_confirm: true })`, verify `signInWithPassword` works and a `users` row gets `auth_id` linked, then delete the test user.
3. Real register→verify→login e2e by the operator (confirmation email to their inbox).

**Placeholder scan:** none — every step has concrete code/commands. The "soon" Settings item is intentional UI (route not built), matching the existing deferred-routes pattern.

**Type consistency:** `validatePassword`/`validateSignup` (Task 1) used by Tasks 3 (signup action) and 5 (reset action). `linkUser(authId, email, deps?)` (Task 2) called by callback (Task 2), `signInAction` (Task 4), and reset is via callback→session (Task 5 uses `updateUser`, no linkUser needed since the reset session's user is already linked from signup; login/callback cover linking). `isProtectedPath` public prefixes (Task 1) cover all new routes. Action signatures (`(prev,formData)=>{message,...}`) are consistent with `useActionState` usage across pages. `signOutAction()` (Task 6) matches the `<form action={...}>` usage.
