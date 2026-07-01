# Vigil — Production Email+Password Auth (Design)

**Date:** 2026-06-29
**Status:** Approved for planning
**Scope:** Replace the magic-link login with a complete, self-serve email+password auth (register → verify email → sign in), plus forgot/reset password and sign-out. This is Phase 2 sub-project A of the auth+onboarding work; mapping/onboarding is sub-project B (next), and re-testing Check-now follows.

## 1. Goal & context

Today the web app has only a Supabase **magic-link** sign-in and no self-serve sign-up. In practice the magic email often never arrives (Supabase built-in email is heavily rate-limited), so a user can't reliably log in — which is why Check-now couldn't be tested. This sub-project delivers conventional production auth: anyone can **register with email + password**, **verify their email**, and **sign in**, with **forgot/reset password** and **sign out**. It reverses the earlier invite-only decision to **open self-serve**.

## 2. Decisions (settled in brainstorming)

- **Email + password** with email verification (Supabase Auth `signUp` / `signInWithPassword`).
- **Open self-serve** — anyone can register (Supabase "allow new users" on; email confirmation required).
- **Email delivery:** Supabase **built-in email for now** (rate-limited, fine for a handful of test signups). **Must swap to Resend SMTP before onboarding real customers** — noted as a required later step, not part of this slice.
- **Identity unchanged:** keep `users.auth_id` + **claim-by-email** (`claimUser`, already built + tested). It links a new auth identity to a `public.users` row — creating one for brand-new users, claiming the existing row for concierge-added emails.
- **Password reset included** now (production-standard).
- After verifying/first sign-in, a brand-new user lands on the **Overview empty state**; the "add your app" onboarding is sub-project B.

## 3. Pages & flows (`packages/web`)

1. **`/signup`** — email + password + confirm-password. Client validation (password ≥ 8 chars, passwords match). `supabase.auth.signUp({ email, password, options: { emailRedirectTo: '<origin>/auth/callback' } })` → "check your email to confirm your account" state. Surfaces "this email is already registered" without leaking more than needed.
2. **`/auth/callback`** (reuse existing route) — the email-confirmation link lands here → `exchangeCodeForSession(code)` → `claimUser(authId, email)` → redirect to `/`. On error → `/login`.
3. **`/login`** — **rewritten** from magic-link to email + password: `supabase.auth.signInWithPassword({ email, password })` → on success `claimUser` → redirect to `/`; on failure a calm "email or password is incorrect" (or "please confirm your email first" when Supabase returns email-not-confirmed). Links to `/signup` and `/forgot-password`.
4. **`/forgot-password`** — email → `supabase.auth.resetPasswordForEmail(email, { redirectTo: '<origin>/auth/reset' })` → "check your email" state.
5. **`/auth/reset`** — reached via the recovery link (Supabase establishes a recovery session): a new-password + confirm form → `supabase.auth.updateUser({ password })` → redirect to `/` (signed in) with a success note.
6. **Sign out** — a control in the sidebar footer → a server action calling `supabase.auth.signOut()` → redirect to `/login`.

## 4. Identity linking

`claimUser(db, authId, email)` (existing, service-role) runs at every auth entry that establishes a session for a possibly-first-time identity: the confirm **callback** (#2), **password sign-in** (#3), and **reset** (#5). It is idempotent (UPDATE-by-email then INSERT-on-none), so running it on each sign-in is safe. RLS and the `users`/`apps`/… policies are unchanged.

## 5. Middleware

Extend `isProtectedPath` so the public (unauthenticated-allowed) prefixes are `/login`, `/signup`, `/forgot-password`, and `/auth`. Everything else stays protected (redirect to `/login`). The session-refresh behavior is unchanged.

## 6. Supabase configuration (dashboard — ops, not code)

Documented in the plan for the operator to apply:
- Authentication → Providers → **Email**: enabled, **Confirm email = ON**.
- Authentication → **Allow new users to sign up = ON** (open self-serve).
- Authentication → URL Configuration → **Site URL** = the Vercel production URL; **Redirect URLs** include `<vercel-url>/auth/callback` and `<vercel-url>/auth/reset` (and `http://localhost:3000/...` for local dev).
- Email templates: default is fine for now (built-in email). SMTP (Resend) is the pre-launch upgrade.

## 7. Error handling & UX

- Calm, plain-English messages (consistent with the design system): incorrect credentials, unconfirmed email, already-registered, weak/mismatched password, expired reset link.
- Never reveal whether an email exists beyond what the flow requires (Supabase's default responses are used as-is).
- Loading/disabled states on submit; success confirmations ("check your email").

## 8. Testing

- **Unit:** password validation (≥8, match) and its error messages; `isProtectedPath` returns false for `/login`,`/signup`,`/forgot-password`,`/auth/*` and true for `/`,`/apps/x`; the reset form's validation. (`claimUser` is already unit-tested.)
- **Live (controller):** create a **pre-confirmed** user via the Supabase **admin API** (`auth.admin.createUser({ email, password, email_confirm: true })`), then verify `signInWithPassword` succeeds and `claimUser` links a `users` row — proving the sign-in + linking path without needing an email click. Clean up the test user after.
- **Live (you):** the real register → receive Supabase confirmation email → click → land on the dashboard, since the email goes to your inbox.
- Full web suite + typecheck + `next build` green; existing RLS/dashboard tests unaffected.

## 9. Non-goals / build order (not cuts)
- Resend SMTP for reliable email — required before real customers; separate step.
- Mapping/onboarding ("add your app" → map journeys → review) — **sub-project B**, next.
- OAuth / social login, MFA, org/team accounts, rate-limit tuning beyond Supabase defaults — later/never per current needs.
- Re-testing Check-now end-to-end — after B, once a user can register + add + map an app.
