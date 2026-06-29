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
