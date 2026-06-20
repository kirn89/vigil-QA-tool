import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, getAppByName } from '../src/db/appsRepo.js';
import { listProposedFlows, listConfirmedFlows } from '../src/db/flowsRepo.js';
import { cmdAppAdd, cmdFlowDescribe, cmdFlowAdd } from '../src/cli.js';
import { FakeLLMClient, type LLMResponse } from '../src/map/llmClient.js';

let server: Server;
let url: string;
let dir: string;
beforeAll(async () => { await migrate(); ({ server, url } = await startFixture()); dir = await mkdtemp(join(tmpdir(), 'vigil-desc-')); });
afterAll(async () => { await closePool(); await new Promise<void>((r) => server.close(() => r())); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings cascade');
  await fetch(`${url}/__reset`, { method: 'POST' });
});

const aboutFlow = {
  name: 'View About',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/about' } },
    { id: 's2', action: { kind: 'expect_text', text: 'About' } },
  ],
};

describe('human journey-add', () => {
  it('flow:describe maps the requested journey and verifies it (source=described)', async () => {
    await cmdAppAdd({ name: 'demo', url });
    const script: LLMResponse[] = [
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_flows', input: { flows: [aboutFlow] } }] },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ];
    await cmdFlowDescribe('demo', 'view the about page', { client: new FakeLLMClient(script), maxSteps: 5 });
    const userId = await ensureUser(process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local');
    const app = (await getAppByName(userId, 'demo'))!;
    const proposed = await listProposedFlows(app.id);
    expect(proposed).toHaveLength(1);
    expect(proposed[0]!.source).toBe('described');
    expect(proposed[0]!.verified).toBe(true);
  });

  it('flow:add verifies a hand-written flow: a good one is confirmed, a broken one is left unverified-proposed', async () => {
    await cmdAppAdd({ name: 'demo', url });
    const userId = await ensureUser(process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local');
    const app = (await getAppByName(userId, 'demo'))!;

    const goodFile = join(dir, 'about.json');
    await writeFile(goodFile, JSON.stringify(aboutFlow));
    await cmdFlowAdd('demo', goodFile);
    expect((await listConfirmedFlows(app.id)).map((f) => f.goldenPath.name)).toEqual(['View About']);

    const badFile = join(dir, 'bad.json');
    await writeFile(badFile, JSON.stringify({ name: 'Bad', steps: [{ id: 's1', action: { kind: 'goto', path: '/about' } }, { id: 's2', action: { kind: 'expect_text', text: 'This text is not on the page' } }] }));
    await cmdFlowAdd('demo', badFile);
    const bad = (await listProposedFlows(app.id)).find((f) => f.goldenPath.name === 'Bad')!;
    expect(bad.verified).toBe(false);
    expect((await listConfirmedFlows(app.id)).map((f) => f.goldenPath.name)).toEqual(['View About']);
  });
});
