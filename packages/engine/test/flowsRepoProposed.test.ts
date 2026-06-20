import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, createApp } from '../src/db/appsRepo.js';
import { addFlow, listConfirmedFlows, listProposedFlows, confirmFlow, deleteProposedFlows } from '../src/db/flowsRepo.js';

let appId: string;
beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings cascade');
  const userId = await ensureUser('founder@vigil.test');
  appId = (await createApp({ userId, name: 'demo', productionUrl: 'http://x.test', previewUrl: null, credentials: null })).id;
});

const flow = (name: string) => ({ name, steps: [{ id: 's1', action: { kind: 'goto', path: '/' } }] });

describe('proposed-flow lifecycle', () => {
  it('lists only proposed flows', async () => {
    await addFlow(appId, flow('login'), 'proposed');
    await addFlow(appId, flow('search'), 'confirmed');
    expect((await listProposedFlows(appId)).map((f) => f.goldenPath.name)).toEqual(['login']);
  });
  it('confirms a proposed flow (it then appears as confirmed, not proposed)', async () => {
    await addFlow(appId, flow('login'), 'proposed', { verified: true, source: 'mapped' });
    await confirmFlow(appId, 'login');
    expect(await listProposedFlows(appId)).toEqual([]);
    expect((await listConfirmedFlows(appId)).map((f) => f.goldenPath.name)).toEqual(['login']);
  });
  it('deleteProposedFlows clears only proposed (keeps confirmed) for re-mapping', async () => {
    await addFlow(appId, flow('a'), 'proposed');
    await addFlow(appId, flow('b'), 'confirmed');
    await deleteProposedFlows(appId);
    expect(await listProposedFlows(appId)).toEqual([]);
    expect((await listConfirmedFlows(appId)).map((f) => f.goldenPath.name)).toEqual(['b']);
  });
});
