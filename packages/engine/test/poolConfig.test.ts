import { describe, expect, it } from 'vitest';
import { buildPoolConfig } from '../src/db/pool.js';

describe('buildPoolConfig', () => {
  it('returns no ssl by default (local embedded Postgres needs none)', () => {
    const cfg = buildPoolConfig({ connectionString: 'postgres://localhost:54329/x', ssl: undefined });
    expect(cfg.connectionString).toBe('postgres://localhost:54329/x');
    expect(cfg.ssl).toBeUndefined();
  });

  it('enables ssl when the flag is "true" or "require" (Supabase requires TLS)', () => {
    for (const flag of ['true', 'require', 'TRUE', 'Require']) {
      const cfg = buildPoolConfig({ connectionString: 'postgres://db.supabase.co/x', ssl: flag });
      expect(cfg.ssl, flag).toEqual({ rejectUnauthorized: false });
    }
  });

  it('treats any other flag value as ssl off', () => {
    for (const flag of ['', 'false', 'no', '0']) {
      expect(buildPoolConfig({ connectionString: 'x', ssl: flag }).ssl, flag).toBeUndefined();
    }
  });
});
