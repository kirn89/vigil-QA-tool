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
