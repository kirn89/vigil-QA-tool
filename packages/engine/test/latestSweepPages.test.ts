import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, createApp } from '../src/db/appsRepo.js';
import { recordSweep, latestSweepPages } from '../src/db/sweepRepo.js';
import type { SweepResult } from '../src/sweep/crawler.js';

let appId: string;
beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings, journey_candidates cascade');
  const userId = await ensureUser('founder@vigil.test');
  appId = (await createApp({ userId, name: 'demo', productionUrl: 'http://x.test', previewUrl: null, credentials: null })).id;
});

describe('latestSweepPages', () => {
  it('returns the most recent sweep pages with their signals', async () => {
    const result: SweepResult = {
      pages: [{
        url: 'http://x.test/login', httpStatus: 200, loadMs: 12,
        signals: { hasForm: true, inputCount: 2, actionButtonCount: 1, hasPasswordField: true },
      }],
      findings: [],
    };
    await recordSweep(appId, result);
    const pages = await latestSweepPages(appId);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.url).toBe('http://x.test/login');
    expect(pages[0]!.signals.hasForm).toBe(true);
    expect(pages[0]!.signals.inputCount).toBe(2);
  });

  it('excludes pages from older sweeps', async () => {
    const oldResult: SweepResult = {
      pages: [{
        url: 'http://x.test/old', httpStatus: 200, loadMs: 10,
        signals: { hasForm: false, inputCount: 0, actionButtonCount: 0, hasPasswordField: false },
      }],
      findings: [],
    };
    await recordSweep(appId, oldResult);
    await getPool().query("update sweeps set started_at = now() - interval '1 hour' where app_id = $1", [appId]);

    const newResult: SweepResult = {
      pages: [{
        url: 'http://x.test/new', httpStatus: 200, loadMs: 10,
        signals: { hasForm: false, inputCount: 0, actionButtonCount: 0, hasPasswordField: false },
      }],
      findings: [],
    };
    await recordSweep(appId, newResult);

    const pages = await latestSweepPages(appId);
    const urls = pages.map(p => p.url);
    expect(urls).toContain('http://x.test/new');
    expect(urls).not.toContain('http://x.test/old');
  });
});
