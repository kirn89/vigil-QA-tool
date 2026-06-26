import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, createApp } from '../src/db/appsRepo.js';
import {
  upsertCandidates, listCandidates, getCandidate, setCandidateStatus, countAuthoredCandidates,
} from '../src/db/candidatesRepo.js';

let appId: string;
beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings, journey_candidates cascade');
  const userId = await ensureUser('founder@vigil.test');
  appId = (await createApp({ userId, name: 'demo', productionUrl: 'http://x.test', previewUrl: null, credentials: null })).id;
});

describe('candidatesRepo', () => {
  it('upserts and lists candidates; re-upsert does not clobber status', async () => {
    await upsertCandidates(appId, [
      { name: 'Login', entryUrl: 'http://x.test/login', recommended: true, feasibilityHint: 'needs a test login' },
      { name: 'Search', entryUrl: 'http://x.test/search', recommended: false },
    ]);
    let all = await listCandidates(appId);
    expect(all.map((c) => c.name).sort()).toEqual(['Login', 'Search']);
    const login = all.find((c) => c.name === 'Login')!;
    expect(login.recommended).toBe(true);
    expect(login.feasibilityHint).toBe('needs a test login');
    expect(login.status).toBe('open');

    await setCandidateStatus(appId, login.id, 'authored');
    await upsertCandidates(appId, [{ name: 'Login', entryUrl: 'http://x.test/login', recommended: true }]);
    all = await listCandidates(appId);
    expect(all.find((c) => c.name === 'Login')!.status).toBe('authored'); // not reset to open
  });

  it('getCandidate returns one or null; setCandidateStatus stores a hint', async () => {
    await upsertCandidates(appId, [{ name: 'Checkout', entryUrl: 'http://x.test/checkout', recommended: true }]);
    const id = (await listCandidates(appId))[0]!.id;
    await setCandidateStatus(appId, id, 'needs_info', 'hits payment');
    const got = await getCandidate(appId, id);
    expect(got!.status).toBe('needs_info');
    expect(got!.feasibilityHint).toBe('hits payment');
    expect(await getCandidate(appId, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('getCandidate returns null for a malformed (non-UUID) id instead of throwing', async () => {
    expect(await getCandidate(appId, 'not-a-uuid')).toBeNull();
  });

  it('countAuthoredCandidates counts only authored', async () => {
    await upsertCandidates(appId, [
      { name: 'A', entryUrl: 'http://x.test/a', recommended: false },
      { name: 'B', entryUrl: 'http://x.test/b', recommended: false },
    ]);
    const [a] = await listCandidates(appId);
    await setCandidateStatus(appId, a!.id, 'authored');
    expect(await countAuthoredCandidates(appId)).toBe(1);
  });
});
