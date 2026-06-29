import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppCard } from '../src/components/AppCard.js';

describe('AppCard', () => {
  it('shows the app name, status, and last-checked time', () => {
    render(<AppCard app={{ id: 'a1', name: 'scholarai', worst: 'pass', lastChecked: new Date(Date.now() - 3600_000).toISOString() }} />);
    expect(screen.getByText('scholarai')).toBeTruthy();
    expect(screen.getByText('All clear')).toBeTruthy();
    expect(screen.getByText(/hour ago/)).toBeTruthy();
  });
  it('shows not-checked-yet when never run', () => {
    render(<AppCard app={{ id: 'a2', name: 'demo', worst: null, lastChecked: null }} />);
    expect(screen.getAllByText('Not checked yet').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Last checked/)).toBeNull();
  });
});
