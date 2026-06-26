import { statusLabel, type DisplayVerdict } from '../lib/format.js';

const STYLE: Record<'pass' | 'broken' | 'unsure' | 'none', string> = {
  pass: 'bg-green-100 text-green-800',
  broken: 'bg-red-100 text-red-800',
  unsure: 'bg-amber-100 text-amber-800', // amber, never red — UNSURE must not alarm
  none: 'bg-neutral-100 text-neutral-600',
};

export function VerdictBadge({ verdict }: { verdict: DisplayVerdict }) {
  const key = verdict ?? 'none';
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLE[key]}`}>{statusLabel(verdict)}</span>;
}
