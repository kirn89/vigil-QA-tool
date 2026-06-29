import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-20 text-center">
      <p className="text-ink-soft">We couldn&apos;t find that app.</p>
      <Link href="/" className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-sm text-white hover:bg-brand-hover">Back to overview</Link>
    </div>
  );
}
