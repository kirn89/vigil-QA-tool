import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, getAppByName } from '../src/db/appsRepo.js';
import { listProposedFlows, listConfirmedFlows } from '../src/db/flowsRepo.js';
import { cmdAppAdd, cmdMap, cmdFlowConfirm } from '../src/cli.js';
import { FakeLLMClient, type LLMResponse } from '../src/map/llmClient.js';

let server: Server;
let url: string;
beforeAll(async () => { await migrate(); ({ server, url } = await startFixture()); });
afterAll(async () => { await closePool(); await new Promise<void>((r) => server.close(() => r())); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings cascade');
  await fetch(`${url}/__reset`, { method: 'POST' });
});

const loginFlowJson = {
  name: 'login',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/login' } },
    { id: 's2', action: { kind: 'fill', selector: '#email', value: '{{email}}', description: 'email' } },
    { id: 's3', action: { kind: 'fill', selector: '#password', value: '{{password}}', description: 'password' } },
    { id: 's4', action: { kind: 'click', selector: 'button[type="submit"]', description: 'Sign in' } },
    { id: 's5', action: { kind: 'expect_url', pattern: '/dashboard$' } },
  ],
};
const hallucinatedJson = {
  name: 'broken-contact',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/contact' } },
    { id: 's2', action: { kind: 'fill', selector: '#nope', value: 'x', description: 'missing field' } },
  ],
};

describe('vigil map verifies proposals', () => {
  it('marks a grounded flow verified and a hallucinated one unverified; confirm respects the gate', async () => {
    await cmdAppAdd({ name: 'demo', url, loginEmail: 'demo@example.com', loginPassword: 'demo-pass' });
    const script: LLMResponse[] = [
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_flows', input: { flows: [loginFlowJson, hallucinatedJson] } }] },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ];
    await cmdMap('demo', { client: new FakeLLMClient(script), maxSteps: 5 });

    const userId = await ensureUser(process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local');
    const app = (await getAppByName(userId, 'demo'))!;
    const proposed = await listProposedFlows(app.id);
    const login = proposed.find((f) => f.goldenPath.name === 'login')!;
    const broken = proposed.find((f) => f.goldenPath.name === 'broken-contact')!;
    expect(login.verified).toBe(true);
    expect(login.source).toBe('mapped');
    expect(broken.verified).toBe(false);
    expect(broken.verificationNote).toMatch(/s2/);

    await cmdFlowConfirm('demo', 'login');
    expect((await listConfirmedFlows(app.id)).map((f) => f.goldenPath.name)).toEqual(['login']);
    await cmdFlowConfirm('demo', 'broken-contact');
    expect((await listConfirmedFlows(app.id)).map((f) => f.goldenPath.name)).toEqual(['login']);
    await cmdFlowConfirm('demo', 'broken-contact', { force: true });
    expect((await listConfirmedFlows(app.id)).map((f) => f.goldenPath.name).sort()).toEqual(['broken-contact', 'login']);
  });
});
