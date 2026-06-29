import Link from 'next/link';
import type { AppSummary } from '../lib/data.js';
import { VerdictBadge } from './VerdictBadge.js';
import { relativeTime } from '../lib/ui.js';

export function AppCard({ app }: { app: AppSummary }) {
  return (
    <Link href={`/apps/${app.id}`}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5 hover:border-ink-faint/30">
      <div className="flex items-center justify-between">
        <span className="text-base font-medium">{app.name}</span>
        <VerdictBadge verdict={app.worst} />
      </div>
      <span className="text-xs text-ink-faint">
        {app.lastChecked ? `Last checked ${relativeTime(app.lastChecked).toLowerCase()}` : relativeTime(null)}
      </span>
    </Link>
  );
}
