import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { encryptJson, decryptJson } from '../src/db/crypto.js';
import { ensureUser } from '../src/db/appsRepo.js';
import * as apps from '../src/db/appsRepo.js';
import * as flows from '../src/db/flowsRepo.js';
import * as runs from '../src/db/runsRepo.js';

beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings cascade');
});

const flowJson = {
  name: 'login', requiresLogin: false,
  steps: [{ id: 's1', action: { kind: 'goto', path: '/login' } }],
};

describe('crypto', () => {
  it('round-trips credentials', () => {
    const creds = { email: 'a@b.c', password: 'hunter2' };
    expect(decryptJson(encryptJson(creds))).toEqual(creds);
  });
  it('produces different ciphertexts per call (fresh IV)', () => {
    expect(encryptJson({ a: 1 })).not.toBe(encryptJson({ a: 1 }));
  });
});

describe('repositories', () => {
  it('creates an app with encrypted credentials and reads them back', async () => {
    const userId = await ensureUser('founder@vigil.test');
    const app = await apps.createApp({
      userId, name: 'demo', productionUrl: 'http://x.test',
      previewUrl: null, credentials: { email: 'demo@example.com', password: 'demo-pass' },
    });
    const fetched = await apps.getAppByName(userId, 'demo');
    expect(fetched?.id).toBe(app.id);
    expect(fetched?.credentials).toEqual({ email: 'demo@example.com', password: 'demo-pass' });
  });

  it('stores flows and lists only confirmed ones', async () => {
    const userId = await ensureUser('founder@vigil.test');
    const app = await apps.createApp({ userId, name: 'demo', productionUrl: 'http://x.test', previewUrl: null, credentials: null });
    await flows.addFlow(app.id, flowJson, 'confirmed');
    await flows.addFlow(app.id, { ...flowJson, name: 'maybe' }, 'proposed');
    const confirmed = await flows.listConfirmedFlows(app.id);
    expect(confirmed.map((f) => f.goldenPath.name)).toEqual(['login']);
  });

  it('records runs and returns the latest verdict per flow', async () => {
    const userId = await ensureUser('founder@vigil.test');
    const app = await apps.createApp({ userId, name: 'demo', productionUrl: 'http://x.test', previewUrl: null, credentials: null });
    const flow = await flows.addFlow(app.id, flowJson, 'confirmed');
    await runs.insertRun({ flowId: flow.id, environment: 'production', verdict: 'pass', failedStepId: null, attempts: [], durationMs: 1200 });
    await runs.insertRun({ flowId: flow.id, environment: 'production', verdict: 'broken', failedStepId: 's1', attempts: [], durationMs: 900 });
    const latest = await runs.latestVerdicts(app.id);
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ flowName: 'login', verdict: 'broken', failedStepId: 's1' });
  });
});
