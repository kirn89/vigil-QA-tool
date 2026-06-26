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
