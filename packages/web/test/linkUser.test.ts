import { describe, expect, it, vi } from 'vitest';
import { linkUser } from '../src/lib/linkUser.js';

describe('linkUser', () => {
  it('runs claim with the auth id + email (via injected claim, no real DB)', async () => {
    const claim = vi.fn().mockResolvedValue(undefined);
    await linkUser('auth-1', 'Founder@Vigil.test', { claim });
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim.mock.calls[0][1]).toBe('auth-1');
    expect(claim.mock.calls[0][2]).toBe('Founder@Vigil.test');
  });
});
