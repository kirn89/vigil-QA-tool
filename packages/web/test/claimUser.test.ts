import { describe, expect, it } from 'vitest';
import { claimUser, type ClaimDb } from '../src/lib/claimUser.js';

function fakeDb() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db: ClaimDb & { calls: typeof calls; updateRowCount: number } = {
    calls, updateRowCount: 1,
    async query(sql: string, params: unknown[]) {
      calls.push({ sql, params });
      // First call is the UPDATE (claim); return configured rowCount. Insert returns 1.
      if (/^update/i.test(sql.trim())) return { rowCount: db.updateRowCount };
      return { rowCount: 1 };
    },
  };
  return db;
}

describe('claimUser', () => {
  it('claims an existing row by email (UPDATE sets auth_id)', async () => {
    const db = fakeDb();
    await claimUser(db, 'auth-1', 'Founder@Vigil.test');
    const update = db.calls[0]!;
    expect(update.sql).toMatch(/update users set auth_id/i);
    expect(update.params).toEqual(['auth-1', 'founder@vigil.test']); // email lowercased
    expect(db.calls).toHaveLength(1); // no insert needed when a row was claimed
  });

  it('inserts a new linked row when no email match exists', async () => {
    const db = fakeDb();
    db.updateRowCount = 0; // nothing claimed
    await claimUser(db, 'auth-2', 'new@vigil.test');
    expect(db.calls).toHaveLength(2);
    expect(db.calls[1]!.sql).toMatch(/insert into users/i);
    expect(db.calls[1]!.params).toEqual(['new@vigil.test', 'auth-2']);
  });
});
