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
