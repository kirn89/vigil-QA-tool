import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from '../src/components/Sidebar.js';

vi.mock('next/navigation', () => ({ usePathname: () => '/apps/app-1' }));
vi.mock('../src/app/(app)/actions.js', () => ({ signOutAction: async () => {} }));

describe('Sidebar', () => {
  it('lists Overview, the apps, and Settings, marking the active app', () => {
    render(<Sidebar apps={[{ id: 'app-1', name: 'scholarai' }, { id: 'app-2', name: 'settlenepal' }]} />);
    expect(screen.getByText('Overview')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
    const active = screen.getByText('scholarai').closest('a')!;
    expect(active.getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('settlenepal').closest('a')!.getAttribute('aria-current')).toBeNull();
  });

  it('renders a sign-out control', () => {
    render(<Sidebar apps={[]} />);
    expect(screen.getByRole('button', { name: /sign out/i })).toBeTruthy();
  });
});
