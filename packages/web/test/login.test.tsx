import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('../src/app/login/actions.js', () => ({ signInAction: async () => ({ message: '' }) }));
import LoginPage from '../src/app/login/page.js';

describe('LoginPage', () => {
  it('renders email + password, plus sign-up and forgot-password links', () => {
    render(<LoginPage />);
    expect(screen.getByPlaceholderText(/you@/i)).toBeTruthy();
    expect(screen.getByLabelText(/password/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /create/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /forgot/i })).toBeTruthy();
  });
});
