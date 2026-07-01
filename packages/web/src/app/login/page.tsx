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
