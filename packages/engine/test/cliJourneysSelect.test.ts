import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, getAppByName } from '../src/db/appsRepo.js';
import { listConfirmedFlows } from '../src/db/flowsRepo.js';
import { upsertCandidates, listCandidates, setCandidateStatus } from '../src/db/candidatesRepo.js';
import { cmdAppAdd, cmdJourneysSelect } from '../src/cli.js';
import { FakeLLMClient, type LLMResponse } from '../src/map/llmClient.js';

const FOUNDER = process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local';
let server: Server; let url: string;
beforeAll(async () => { await migrate(); ({ server, url } = await startFixture()); });
afterAll(async () => { await closePool(); await new Promise<void>((r) => server.close(() => r())); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings, journey_candidates cascade');
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

async function appId(): Promise<string> {
  return (await getAppByName(await ensureUser(FOUNDER), 'demo'))!.id;
}

describe('cmdJourneysSelect', () => {
  it('lazily authors a selected candidate into a watched flow', async () => {
    await cmdAppAdd({ name: 'demo', url, loginEmail: 'demo@example.com', loginPassword: 'demo-pass' });
    const id = await appId();
    await upsertCandidates(id, [{ name: 'login', entryUrl: `${url}/login`, recommended: true }]);
    const candidateId = (await listCandidates(id))[0]!.id;

    // mapApp: propose the login flow, then end_turn. verifyWithCorrection passes (no extra call).
    const script: LLMResponse[] = [
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_flows', input: { flows: [loginFlowJson] } }] },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ];
    const { lines } = await cmdJourneysSelect('demo', [candidateId], { client: new FakeLLMClient(script), maxSteps: 5 });

    expect(lines.join('\n')).toContain('✅');
    expect((await listConfirmedFlows(id)).map((f) => f.goldenPath.name)).toEqual(['login']);
    expect((await listCandidates(id))[0]!.status).toBe('authored');
  });

  it('routes an unbuildable candidate to needs_info (fallback)', async () => {
    await cmdAppAdd({ name: 'demo', url });
    const id = await appId();
    await upsertCandidates(id, [{ name: 'mystery', entryUrl: `${url}/about`, recommended: false }]);
    const candidateId = (await listCandidates(id))[0]!.id;

    // mapApp returns no proposals (end_turn immediately) → authoring fails.
    const script: LLMResponse[] = [{ stopReason: 'end_turn', content: [{ type: 'text', text: 'nothing' }] }];
    const { lines } = await cmdJourneysSelect('demo', [candidateId], { client: new FakeLLMClient(script), maxSteps: 2 });

    expect(lines.join('\n')).toContain('needs info');
    expect((await listCandidates(id))[0]!.status).toBe('needs_info');
  });

  it('skips a candidate that is already authored without calling the LLM or browser', async () => {
    await cmdAppAdd({ name: 'demo', url });
    const id = await appId();
    await upsertCandidates(id, [{ name: 'checkout', entryUrl: `${url}/checkout`, recommended: true }]);
    const candidateId = (await listCandidates(id))[0]!.id;
    await setCandidateStatus(id, candidateId, 'authored');

    // FakeLLMClient([]) throws if any LLM call is made — so if this resolves the skip guard worked.
    const { lines } = await cmdJourneysSelect('demo', [candidateId], { client: new FakeLLMClient([]) });

    expect(lines.join('\n')).toContain('already watched');
    expect((await listCandidates(id))[0]!.status).toBe('authored');
  });

  it('rejects selections that exceed the quota before authoring', async () => {
    await cmdAppAdd({ name: 'demo', url });
    const id = await appId();
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `j${i}`, entryUrl: `${url}/p${i}`, recommended: false }));
    await upsertCandidates(id, [...many, { name: 'extra', entryUrl: `${url}/extra`, recommended: false }]);
    const all = await listCandidates(id);
    for (const c of all.filter((c) => c.name !== 'extra')) await setCandidateStatus(id, c.id, 'authored');
    const extraId = all.find((c) => c.name === 'extra')!.id;

    // client never used: quota check throws before authoring.
    await expect(cmdJourneysSelect('demo', [extraId], { client: new FakeLLMClient([]) })).rejects.toThrow(/quota/i);
  });
});
