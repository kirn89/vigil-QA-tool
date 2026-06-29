import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VerdictBadge } from '../src/components/VerdictBadge.js';
import { EmptyState } from '../src/components/EmptyState.js';
import { ScreenshotStrip } from '../src/components/ScreenshotStrip.js';

describe('VerdictBadge', () => {
  it('renders the calm label and amber (not red) classes for unsure', () => {
    const { rerender } = render(<VerdictBadge verdict="broken" />);
    expect(screen.getByText('Broken')).toBeTruthy();
    rerender(<VerdictBadge verdict="unsure" />);
    const el = screen.getByText('Needs a look');
    expect(el.className).toMatch(/warn/);
    expect(el.className).not.toMatch(/broken/);
  });
});

describe('EmptyState', () => {
  it('renders a title and optional CTA children', () => {
    render(<EmptyState icon="ti-apps" title="No apps yet"><a href="/connect">Connect</a></EmptyState>);
    expect(screen.getByText('No apps yet')).toBeTruthy();
    expect(screen.getByText('Connect')).toBeTruthy();
  });
});

describe('ScreenshotStrip', () => {
  it('renders a thumbnail per shot, nothing when empty', () => {
    const { container, rerender } = render(<ScreenshotStrip shots={['https://s/a.png', 'https://s/b.png']} />);
    expect(screen.getAllByRole('img')).toHaveLength(2);
    rerender(<ScreenshotStrip shots={[]} />);
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });
});
