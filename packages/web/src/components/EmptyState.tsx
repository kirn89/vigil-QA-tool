import type { ReactNode } from 'react';

export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-surface px-6 py-12 text-center">
      <i className={`ti ${icon} text-2xl text-ink-faint`} aria-hidden="true" />
      <p className="text-ink-soft">{title}</p>
      {children}
    </div>
  );
}
