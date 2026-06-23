import { describe, expect, it } from 'vitest';
import { isUnsafeLabel } from '../src/sweep/navSafety.js';

describe('isUnsafeLabel', () => {
  it('flags destructive / outward-facing control labels', () => {
    for (const l of [
      'Delete account', 'Send message', 'Send proposal', 'Pay now', 'Submit',
      'Log out', 'Sign out', 'Buy', 'Confirm order', 'Remove', 'Cancel subscription',
      'Unsubscribe', 'Withdraw', 'Archive',
    ]) {
      expect(isUnsafeLabel(l), l).toBe(true);
    }
  });

  it('allows navigation-like labels', () => {
    for (const l of [
      'Open inbox', 'View matches', 'Dashboard', 'Next', 'Settings', 'Profile',
      'Browse', 'Search', 'My documents', 'Back to home', 'Sender details',
    ]) {
      expect(isUnsafeLabel(l), l).toBe(false);
    }
  });

  it('matches whole words, not substrings, and ignores case', () => {
    expect(isUnsafeLabel('PAY')).toBe(true);
    expect(isUnsafeLabel('Paywall info')).toBe(false); // "pay" is not a whole word here
    expect(isUnsafeLabel('Senders')).toBe(false);      // "send" is not a whole word here
    expect(isUnsafeLabel('')).toBe(false);
  });
});
