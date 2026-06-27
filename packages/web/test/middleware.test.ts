import { describe, expect, it } from 'vitest';
import { isProtectedPath } from '../src/lib/supabase/middleware.js';

describe('isProtectedPath', () => {
  it('treats app pages as protected and auth pages as public', () => {
    expect(isProtectedPath('/')).toBe(true);
    expect(isProtectedPath('/apps/123')).toBe(true);
    expect(isProtectedPath('/login')).toBe(false);
    expect(isProtectedPath('/auth/callback')).toBe(false);
  });
});
