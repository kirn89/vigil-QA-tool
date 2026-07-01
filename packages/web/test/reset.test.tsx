import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('../src/app/auth/reset/actions.js', () => ({ updatePasswordAction: async () => ({ message: '' }) }));
import ResetPage from '../src/app/auth/reset/page.js';

describe('ResetPage', () => {
  it('renders a new-password + confirm form and an update button', () => {
    render(<ResetPage />);
    expect(screen.getByLabelText(/new password/i)).toBeTruthy();
    expect(screen.getByLabelText(/confirm/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /update password/i })).toBeTruthy();
  });
});
