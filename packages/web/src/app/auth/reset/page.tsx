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
          <input name="confirm" type="password" required autoComplete="new-password" aria-label="Confirm" placeholder="Confirm new password"
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
