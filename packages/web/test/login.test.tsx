import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../src/app/login/actions.js', () => ({ sendMagicLink: async () => ({ message: '' }) }));
import LoginPage from '../src/app/login/page.js';

describe('LoginPage', () => {
  it('renders the sign-in heading, email field, and submit', () => {
    render(<LoginPage />);
    expect(screen.getByText(/sign in to vigil/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/you@/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign-in link/i })).toBeTruthy();
  });
});
