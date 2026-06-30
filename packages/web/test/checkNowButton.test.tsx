import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../src/app/(app)/apps/[id]/check-now-actions.js', () => ({
  requestCheck: vi.fn(async () => ({ ok: true, jobId: 'j1' })),
  pollJob: vi.fn(async () => ({ id: 'j1', status: 'done', environment: 'production' })),
}));
import { CheckNowButton } from '../src/components/CheckNowButton.js';

describe('CheckNowButton', () => {
  it('renders an enabled Check now button (no longer "soon")', () => {
    render(<CheckNowButton appId="a1" hasPreview={false} initialStatus={null} />);
    const btn = screen.getByRole('button', { name: /check now/i });
    expect(btn.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(/soon/i)).toBeNull();
  });
  it('offers a preview target only when the app has a preview URL', () => {
    const { rerender } = render(<CheckNowButton appId="a1" hasPreview={false} initialStatus={null} />);
    expect(screen.queryByText(/preview/i)).toBeNull();
    rerender(<CheckNowButton appId="a1" hasPreview initialStatus={null} />);
    expect(screen.getByText(/preview/i)).toBeTruthy();
  });
  it('shows a running state when a job is already active on load', () => {
    render(<CheckNowButton appId="a1" hasPreview={false} initialStatus="running" />);
    expect(screen.getByText(/checking/i)).toBeTruthy();
  });
});
