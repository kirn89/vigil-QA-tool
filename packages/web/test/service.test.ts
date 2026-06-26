import { afterEach, describe, expect, it, vi } from 'vitest';

describe('createServiceClient', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('constructs a client from the service-role env (no session persistence)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'service-key-123');
    const { createServiceClient } = await import('../src/lib/supabase/service.js');
    const client = createServiceClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
    expect(typeof client.storage.from).toBe('function');
  });

  it('throws a clear error when the service key is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_KEY', '');
    const { createServiceClient } = await import('../src/lib/supabase/service.js');
    expect(() => createServiceClient()).toThrow(/SUPABASE_SERVICE_KEY/);
  });
});
