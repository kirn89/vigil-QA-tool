import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('../src/app/signup/actions.js', () => ({ signUpAction: async () => ({ message: '' }) }));
import SignupPage from '../src/app/signup/page.js';

describe('SignupPage', () => {
  it('renders email, password, confirm fields and a create-account button', () => {
    render(<SignupPage />);
    expect(screen.getByPlaceholderText(/you@/i)).toBeTruthy();
    expect(screen.getByLabelText(/^password/i)).toBeTruthy();
    expect(screen.getByLabelText(/confirm/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /create account/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /sign in/i })).toBeTruthy();
  });
});
