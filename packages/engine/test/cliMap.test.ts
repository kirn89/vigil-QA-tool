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
const hallucinatedContact = {
  name: 'contact',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/contact' } },
    { id: 's2', action: { kind: 'fill', selector: '#name', value: 'x', description: 'missing field' } },
  ],
};
const correctedContact = {
  name: 'contact',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/contact' } },
    { id: 's2', action: { kind: 'fill', selector: 'input[name="email"]', value: 'a@b.c', description: 'email' } },
    { id: 's3', action: { kind: 'fill', selector: 'textarea[name="message"]', value: 'hi', description: 'message' } },
    { id: 's4', action: { kind: 'click', selector: 'button[type="submit"]', description: 'send' } },
    { id: 's5', action: { kind: 'expect_text', text: 'Thanks' } },
  ],
};

describe('vigil map self-corrects a failed proposal', () => {
  it('auto-fixes a hallucinated flow so it ends up verified', async () => {
    await cmdAppAdd({ name: 'demo', url, loginEmail: 'demo@example.com', loginPassword: 'demo-pass' });
    const script: LLMResponse[] = [
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_flows', input: { flows: [loginFlowJson, hallucinatedContact] } }] },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'propose_flows', input: { flows: [correctedContact] } }] },
    ];
    await cmdMap('demo', { client: new FakeLLMClient(script), maxSteps: 5 });

    const userId = await ensureUser(process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local');
    const app = (await getAppByName(userId, 'demo'))!;
    const proposed = await listProposedFlows(app.id);
    const login = proposed.find((f) => f.goldenPath.name === 'login')!;
    const contact = proposed.find((f) => f.goldenPath.name === 'contact')!;
    expect(login.verified).toBe(true);
    expect(contact.verified).toBe(true);
    expect(contact.goldenPath.steps).toHaveLength(5);

    await cmdFlowConfirm('demo', 'contact');
    expect((await listConfirmedFlows(app.id)).map((f) => f.goldenPath.name)).toEqual(['contact']);
  });
});
