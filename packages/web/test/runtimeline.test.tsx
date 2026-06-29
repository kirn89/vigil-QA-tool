import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunTimeline } from '../src/components/RunTimeline.js';

describe('RunTimeline', () => {
  it('renders one entry per run with its verdict label', () => {
    render(<RunTimeline runs={[
      { verdict: 'pass', failedStepId: null, at: new Date(Date.now() - 3600_000).toISOString() },
      { verdict: 'broken', failedStepId: 's6', at: new Date(Date.now() - 7200_000).toISOString() },
    ]} />);
    expect(screen.getByText('All clear')).toBeTruthy();
    expect(screen.getByText('Broken')).toBeTruthy();
    expect(screen.getByText(/s6/)).toBeTruthy();
  });
  it('shows an empty hint when there are no runs', () => {
    render(<RunTimeline runs={[]} />);
    expect(screen.getByText(/not checked yet/i)).toBeTruthy();
  });
});
