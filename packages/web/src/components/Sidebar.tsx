'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const itemBase = 'flex items-center gap-2 rounded-lg px-3 py-2 text-sm';

export function Sidebar({ apps }: { apps: { id: string; name: string }[] }) {
  const pathname = usePathname();
  const item = (href: string, label: string, icon: string, active: boolean) => (
    <Link href={href} aria-current={active ? 'page' : undefined}
      className={`${itemBase} ${active ? 'bg-surface-2 text-ink font-medium' : 'text-ink-soft hover:bg-surface-2'}`}>
      <i className={`ti ${icon} text-lg`} aria-hidden="true" />{label}
    </Link>
  );
  return (
    <nav className="flex h-full flex-col gap-1 border-r border-line bg-surface p-3">
      <span className="px-3 py-2 text-sm font-medium text-brand">Vigil</span>
      {item('/', 'Overview', 'ti-layout-dashboard', pathname === '/')}
      <p className="px-3 pt-4 pb-1 text-xs text-ink-faint">Apps</p>
      {apps.map((a) => {
        const active = pathname.startsWith(`/apps/${a.id}`);
        return (
          <Link key={a.id} href={`/apps/${a.id}`} aria-current={active ? 'page' : undefined}
            className={`${itemBase} ${active ? 'bg-surface-2 text-ink font-medium' : 'text-ink-soft hover:bg-surface-2'}`}>
            <i className="ti ti-app-window text-lg" aria-hidden="true" />{a.name}
          </Link>
        );
      })}
      <div className="mt-auto">
        <span className={`${itemBase} text-ink-faint cursor-default`}>
          <i className="ti ti-settings text-lg" aria-hidden="true" />Settings
          <span className="ml-auto text-xs text-ink-faint rounded px-1 bg-surface-2">soon</span>
        </span>
      </div>
    </nav>
  );
}
