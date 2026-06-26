import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VerdictBadge } from '../src/components/VerdictBadge.js';
import { FlowReport } from '../src/components/FlowReport.js';
import { FindingsList } from '../src/components/FindingsList.js';

describe('VerdictBadge', () => {
  it('renders plain-English labels and a non-alarmist style for unsure', () => {
    const { rerender } = render(<VerdictBadge verdict="broken" />);
    expect(screen.getByText('Broken')).toBeTruthy();
    rerender(<VerdictBadge verdict="unsure" />);
    const el = screen.getByText('Needs a look');
    expect(el.className).not.toMatch(/red/); // unsure must not use alarm (red) styling
  });
});

describe('FlowReport', () => {
  it('shows failed step and screenshots only for BROKEN', () => {
    render(<FlowReport flow={{ name: 'login', verdict: 'broken', failedStepId: 's6', at: null, shots: ['https://signed/a.png'] }} />);
    expect(screen.getByText(/login/)).toBeTruthy();
    expect(screen.getByText(/s6/)).toBeTruthy();
    expect(screen.getByRole('img')).toBeTruthy();
  });
  it('shows no failure detail for PASS', () => {
    render(<FlowReport flow={{ name: 'login', verdict: 'pass', failedStepId: null, at: null, shots: [] }} />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('FindingsList', () => {
  it('lists sweep findings, with an all-clear message when empty', () => {
    const { rerender } = render(<FindingsList findings={[{ kind: 'dead_link', pageUrl: 'https://a/x', evidence: 'HTTP 404' }]} />);
    expect(screen.getByText(/HTTP 404/)).toBeTruthy();
    rerender(<FindingsList findings={[]} />);
    expect(screen.getByText(/nothing/i)).toBeTruthy();
  });
});
