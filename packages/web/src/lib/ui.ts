import { statusLabel, type DisplayVerdict } from './format.js';

/** Calm status pill classes keyed to the Tailwind tokens. UNSURE = warn (amber), never broken (red). */
export function statusStyles(verdict: DisplayVerdict): { label: string; pill: string; dot: string } {
  const map = {
    pass: { pill: 'bg-pass-bg text-pass-fg', dot: 'bg-pass-fg' },
    broken: { pill: 'bg-broken-bg text-broken-fg', dot: 'bg-broken-fg' },
    unsure: { pill: 'bg-warn-bg text-warn-fg', dot: 'bg-warn-fg' },
    none: { pill: 'bg-surface-2 text-ink-faint', dot: 'bg-ink-faint' },
  } as const;
  const key = verdict ?? 'none';
  return { label: statusLabel(verdict), ...map[key] };
}

export function relativeTime(iso: string | null): string {
  if (!iso) return 'Not checked yet';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
