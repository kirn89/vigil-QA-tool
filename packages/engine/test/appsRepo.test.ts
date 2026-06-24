import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, createApp, listAllApps } from '../src/db/appsRepo.js';

beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });
beforeEach(async () => { await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings cascade'); });

describe('listAllApps', () => {
  it('returns every app across all users, name + id, ordered by name', async () => {
    const u1 = await ensureUser('a@vigil.test');
    const u2 = await ensureUser('b@vigil.test');
    await createApp({ userId: u1, name: 'zeta', productionUrl: 'http://z.test', previewUrl: null, credentials: null });
    await createApp({ userId: u1, name: 'alpha', productionUrl: 'http://a.test', previewUrl: null, credentials: null });
    await createApp({ userId: u2, name: 'mid', productionUrl: 'http://m.test', previewUrl: null, credentials: null });

    const apps = await listAllApps();
    expect(apps.map((a) => a.name)).toEqual(['alpha', 'mid', 'zeta']);
    expect(apps[0]).toHaveProperty('id');
  });

  it('returns an empty array when there are no apps', async () => {
    expect(await listAllApps()).toEqual([]);
  });
});
