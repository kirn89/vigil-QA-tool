import { statusStyles } from '../lib/ui.js';
import type { DisplayVerdict } from '../lib/format.js';

export function VerdictBadge({ verdict }: { verdict: DisplayVerdict }) {
  const s = statusStyles(verdict);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  );
}
