import type { FindingVM } from '../lib/data.js';

export function FindingsList({ findings }: { findings: FindingVM[] }) {
  if (findings.length === 0) return <p className="text-sm text-neutral-500">We found nothing else amiss.</p>;
  return (
    <ul className="space-y-2">
      {findings.map((f, i) => (
        <li key={i} className="rounded-md border border-neutral-200 bg-white p-3 text-sm">
          <span className="font-mono text-xs text-neutral-500">{f.kind}</span>
          <span className="ml-2 break-all">{f.pageUrl}</span>
          <p className="mt-1 text-neutral-700">{f.evidence}</p>
        </li>
      ))}
    </ul>
  );
}
