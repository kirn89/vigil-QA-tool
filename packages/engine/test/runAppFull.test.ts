import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, createApp } from '../src/db/appsRepo.js';
import { addFlow } from '../src/db/flowsRepo.js';
import { runAppFull } from '../src/cli.js';

beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings, journey_candidates, jobs cascade');
});

const flow = (name: string) => ({ name, steps: [{ id: 's1', action: { kind: 'goto', path: '/' } }] });

describe('runAppFull', () => {
  it('runs check + sweep with the given environment when confirmed flows exist', async () => {
    const userId = await ensureUser(process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local');
    const app = await createApp({ userId, name: 'demo', productionUrl: 'http://x.test', previewUrl: 'http://p.test', credentials: null });
    await addFlow(app.id, flow('login'), 'confirmed', { verified: true });
    const calls: string[] = [];
    await runAppFull('demo', 'preview', {
      check: async (n, env) => { calls.push(`check:${n}:${env}`); },
      sweep: async (n, env) => { calls.push(`sweep:${n}:${env}`); },
    });
    expect(calls).toEqual(['check:demo:preview', 'sweep:demo:preview']);
  });

  it('skips the check (no throw) when there are no confirmed flows, but still sweeps', async () => {
    const userId = await ensureUser(process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local');
    await createApp({ userId, name: 'fresh', productionUrl: 'http://x.test', previewUrl: null, credentials: null });
    const calls: string[] = [];
    await runAppFull('fresh', 'production', {
      check: async () => { calls.push('check'); },
      sweep: async (n, env) => { calls.push(`sweep:${n}:${env}`); },
    });
    expect(calls).toEqual(['sweep:fresh:production']); // no check
  });

  it('still sweeps when the check throws, then rethrows so the worker sees the failure', async () => {
    const userId = await ensureUser(process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local');
    const app = await createApp({ userId, name: 'broken', productionUrl: 'http://x.test', previewUrl: null, credentials: null });
    await addFlow(app.id, flow('login'), 'confirmed', { verified: true });
    const calls: string[] = [];
    await expect(runAppFull('broken', 'production', {
      check: async () => { calls.push('check'); throw new Error('check crashed'); },
      sweep: async () => { calls.push('sweep'); },
    })).rejects.toThrow('check crashed');
    expect(calls).toEqual(['check', 'sweep']); // sweep ran despite the check failure
  });
});
