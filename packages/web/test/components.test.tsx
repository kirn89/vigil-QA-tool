import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VerdictBadge } from '../src/components/VerdictBadge.js';

describe('VerdictBadge', () => {
  it('renders plain-English labels and a non-alarmist style for unsure', () => {
    const { rerender } = render(<VerdictBadge verdict="broken" />);
    expect(screen.getByText('Broken')).toBeTruthy();
    rerender(<VerdictBadge verdict="unsure" />);
    const el = screen.getByText('Needs a look');
    expect(el.className).not.toMatch(/red/); // unsure must not use alarm (red) styling
    expect(el.className).toMatch(/amber/);   // unsure uses calm amber
  });
});
