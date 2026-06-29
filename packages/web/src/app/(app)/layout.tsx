import type { ReactNode } from 'react';
import { listApps } from '../../lib/data.js';
import { Sidebar } from '../../components/Sidebar.js';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const apps = await listApps();
  return (
    <div className="grid min-h-screen grid-cols-[220px_1fr]">
      <aside className="sticky top-0 h-screen"><Sidebar apps={apps.map((a) => ({ id: a.id, name: a.name }))} /></aside>
      <main className="min-w-0">{children}</main>
    </div>
  );
}
