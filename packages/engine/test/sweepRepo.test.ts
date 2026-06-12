import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, createApp } from '../src/db/appsRepo.js';
import { recordSweep, confirmedFindings } from '../src/db/sweepRepo.js';
import type { SweepResult } from '../src/sweep/crawler.js';

let appId: string;

beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings cascade');
  const userId = await ensureUser('founder@vigil.test');
  appId = (await createApp({ userId, name: 'demo', productionUrl: 'http://x.test', previewUrl: null, credentials: null })).id;
});

const clean: SweepResult = { pages: [{ url: 'http://x.test/', httpStatus: 200, loadMs: 500 }], findings: [] };
const withDeadLink: SweepResult = {
  pages: clean.pages,
  findings: [{ pageUrl: 'http://x.test/gone', kind: 'dead_link', evidence: 'HTTP 404' }],
};

describe('sweep persistence', () => {
  it('does not confirm a finding seen only once', async () => {
    await recordSweep(appId, withDeadLink);
    expect(await confirmedFindings(appId)).toEqual([]);
  });

  it('confirms a finding seen in two consecutive sweeps', async () => {
    await recordSweep(appId, withDeadLink);
    await recordSweep(appId, withDeadLink);
    const confirmed = await confirmedFindings(appId);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]).toMatchObject({ kind: 'dead_link', pageUrl: 'http://x.test/gone' });
  });

  it('resets the streak when a finding disappears (blip suppression)', async () => {
    await recordSweep(appId, withDeadLink);
    await recordSweep(appId, clean);       // gone → resolved
    await recordSweep(appId, withDeadLink); // back → streak restarts at 1
    expect(await confirmedFindings(appId)).toEqual([]);
  });

  it('flags a slow page only against its own history (3x median, 3s floor)', async () => {
    const fast = (ms: number): SweepResult => ({ pages: [{ url: 'http://x.test/p', httpStatus: 200, loadMs: ms }], findings: [] });
    await recordSweep(appId, fast(1000));
    await recordSweep(appId, fast(1100));
    await recordSweep(appId, fast(900));
    // 4s > 3s floor and ~4x median(1000) → slow finding recorded (streak 1, not yet confirmed)
    await recordSweep(appId, fast(4000));
    await recordSweep(appId, fast(4200)); // second consecutive slow → confirmed
    const confirmed = await confirmedFindings(appId);
    expect(confirmed.some((f) => f.kind === 'slow')).toBe(true);
  });

  it('never flags slow under the 3 second floor even if relatively slower', async () => {
    const fast = (ms: number): SweepResult => ({ pages: [{ url: 'http://x.test/p', httpStatus: 200, loadMs: ms }], findings: [] });
    await recordSweep(appId, fast(200));
    await recordSweep(appId, fast(200));
    await recordSweep(appId, fast(200));
    await recordSweep(appId, fast(2500)); // 12x median but under floor
    await recordSweep(appId, fast(2500));
    expect((await confirmedFindings(appId)).filter((f) => f.kind === 'slow')).toEqual([]);
  });

  it('reappeared finding becomes confirmed after 2 consecutive post-blip sweeps', async () => {
    await recordSweep(appId, withDeadLink); // count=1, open
    await recordSweep(appId, clean);        // resolved
    await recordSweep(appId, withDeadLink); // count=1, open (restart)
    await recordSweep(appId, withDeadLink); // count=2, open → confirmed
    expect(await confirmedFindings(appId)).toHaveLength(1);
  });

  it('duplicate findings within one sweep do not fake a two-sweep confirmation', async () => {
    const dup: SweepResult = {
      pages: clean.pages,
      findings: [
        { pageUrl: 'http://x.test/gone', kind: 'dead_link', evidence: 'HTTP 404' },
        { pageUrl: 'http://x.test/gone', kind: 'dead_link', evidence: 'HTTP 404' },
      ],
    };
    await recordSweep(appId, dup);
    expect(await confirmedFindings(appId)).toEqual([]);
  });
});
