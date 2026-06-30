import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowRow } from '../src/components/FlowRow.js';
import { FindingItem } from '../src/components/FindingItem.js';
import { CheckNowButton } from '../src/components/CheckNowButton.js';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe('FlowRow', () => {
  it('shows failed step + screenshots only for broken', () => {
    const { rerender } = render(<FlowRow appId="a1" flow={{ id: 'f1', name: 'login', verdict: 'broken', failedStepId: 's6', at: null, shots: ['https://s/a.png'] }} />);
    expect(screen.getByText(/s6/)).toBeTruthy();
    expect(screen.getByRole('img')).toBeTruthy();
    rerender(<FlowRow appId="a1" flow={{ id: 'f1', name: 'login', verdict: 'pass', failedStepId: null, at: null, shots: [] }} />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('FindingItem', () => {
  it('renders kind, page url and evidence', () => {
    render(<FindingItem finding={{ kind: 'dead_link', pageUrl: 'https://a/x', evidence: 'HTTP 404' }} />);
    expect(screen.getByText('HTTP 404')).toBeTruthy();
    expect(screen.getByText(/https:\/\/a\/x/)).toBeTruthy();
  });
});

describe('CheckNowButton', () => {
  it('renders an enabled live control', () => {
    render(<CheckNowButton appId="a1" hasPreview={false} initialStatus={null} />);
    const btn = screen.getByRole('button', { name: /check now/i });
    expect(btn.hasAttribute('disabled')).toBe(false);
  });
});
