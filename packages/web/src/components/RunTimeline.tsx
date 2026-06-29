import type { FlowDetailVM } from '../lib/data.js';
import { VerdictBadge } from './VerdictBadge.js';
import { relativeTime } from '../lib/ui.js';

export function RunTimeline({ runs }: { runs: FlowDetailVM['runs'] }) {
  if (runs.length === 0) return <p className="text-sm text-ink-faint">Not checked yet.</p>;
  return (
    <ul className="space-y-2">
      {runs.map((r, i) => (
        <li key={i} className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3">
          <span className="text-sm text-ink-soft">
            {relativeTime(r.at)}{r.failedStepId && <> · failed at <span className="font-mono text-xs">{r.failedStepId}</span></>}
          </span>
          <VerdictBadge verdict={r.verdict} />
        </li>
      ))}
    </ul>
  );
}
