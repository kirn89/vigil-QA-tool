import type { FindingVM } from '../lib/data.js';

export function FindingItem({ finding }: { finding: FindingVM }) {
  return (
    <li className="rounded-lg border border-line bg-surface p-3 text-sm">
      <span className="font-mono text-xs text-ink-faint">{finding.kind}</span>
      <span className="ml-2 break-all font-mono text-xs text-ink-soft">{finding.pageUrl}</span>
      <p className="mt-1 text-ink">{finding.evidence}</p>
    </li>
  );
}
