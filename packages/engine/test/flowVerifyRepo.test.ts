import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, createApp } from '../src/db/appsRepo.js';
import { addFlow, listProposedFlows, listConfirmedFlows, confirmFlow } from '../src/db/flowsRepo.js';

let appId: string;
beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings cascade');
  const userId = await ensureUser('founder@vigil.test');
  appId = (await createApp({ userId, name: 'demo', productionUrl: 'http://x.test', previewUrl: null, credentials: null })).id;
});

const flow = (name: string) => ({ name, steps: [{ id: 's1', action: { kind: 'goto', path: '/' } }] });

describe('flow verification fields', () => {
  it('persists verified/verificationNote/source and reads them back', async () => {
    await addFlow(appId, flow('a'), 'proposed', { verified: true, source: 'mapped' });
    await addFlow(appId, flow('b'), 'proposed', { verified: false, verificationNote: 'step s2: no match', source: 'described' });
    const proposed = await listProposedFlows(appId);
    const a = proposed.find((f) => f.goldenPath.name === 'a')!;
    const b = proposed.find((f) => f.goldenPath.name === 'b')!;
    expect(a.verified).toBe(true);
    expect(a.source).toBe('mapped');
    expect(b.verified).toBe(false);
    expect(b.verificationNote).toBe('step s2: no match');
    expect(b.source).toBe('described');
  });

  it('defaults verified=false and source=manual when not given', async () => {
    await addFlow(appId, flow('c'), 'proposed');
    const c = (await listProposedFlows(appId)).find((f) => f.goldenPath.name === 'c')!;
    expect(c.verified).toBe(false);
    expect(c.source).toBe('manual');
  });

  it('confirmFlow refuses to confirm an unverified flow without force', async () => {
    await addFlow(appId, flow('d'), 'proposed', { verified: false, source: 'mapped' });
    const res = await confirmFlow(appId, 'd');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/unverified/i);
    expect(await listConfirmedFlows(appId)).toEqual([]);
  });

  it('confirmFlow confirms a verified flow, or an unverified one with force', async () => {
    await addFlow(appId, flow('e'), 'proposed', { verified: true, source: 'mapped' });
    expect((await confirmFlow(appId, 'e')).ok).toBe(true);
    await addFlow(appId, flow('f'), 'proposed', { verified: false, source: 'mapped' });
    expect((await confirmFlow(appId, 'f', { force: true })).ok).toBe(true);
    expect((await listConfirmedFlows(appId)).map((x) => x.goldenPath.name).sort()).toEqual(['e', 'f']);
  });
});
