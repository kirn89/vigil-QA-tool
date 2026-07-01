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
