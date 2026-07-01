import { describe, expect, it } from 'vitest';
import { validatePassword, validateSignup } from '../src/lib/authValidation.js';

describe('validatePassword', () => {
  it('requires at least 8 characters', () => {
    expect(validatePassword('short')).toMatch(/8 characters/);
    expect(validatePassword('longenough')).toBeNull();
  });
});

describe('validateSignup', () => {
  it('requires email, a valid password, and matching confirm', () => {
    expect(validateSignup('', 'longenough', 'longenough')).toMatch(/email/i);
    expect(validateSignup('a@b.co', 'short', 'short')).toMatch(/8 characters/);
    expect(validateSignup('a@b.co', 'longenough', 'different')).toMatch(/match/i);
    expect(validateSignup('a@b.co', 'longenough', 'longenough')).toBeNull();
  });
});
