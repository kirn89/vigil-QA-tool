import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPoolConfig } from '../src/db/pool.js';

describe('buildPoolConfig', () => {
  // Isolate DATABASE_SSL from the ambient environment: buildPoolConfig falls back
  // to process.env.DATABASE_SSL when no ssl arg is given, so a dev .env with
  // DATABASE_SSL=true (e.g. for Supabase) would otherwise break the "default" case.
  const savedSsl = process.env.DATABASE_SSL;
  beforeEach(() => { delete process.env.DATABASE_SSL; });
  afterEach(() => {
    if (savedSsl === undefined) delete process.env.DATABASE_SSL;
    else process.env.DATABASE_SSL = savedSsl;
  });

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
