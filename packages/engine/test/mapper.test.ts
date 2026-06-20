import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { MapSession } from '../src/map/browserTools.js';
import { FakeLLMClient, type LLMResponse } from '../src/map/llmClient.js';
import { mapApp } from '../src/map/mapper.js';

let server: Server;
let url: string;

beforeAll(async () => ({ server, url } = await startFixture()));
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(async () => { await fetch(`${url}/__reset`, { method: 'POST' }); });

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
const toolUse = (id: string, name: string, input: unknown): LLMResponse => ({ stopReason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });

async function withSession<T>(fn: (s: MapSession) => Promise<T>): Promise<T> {
  const s = new MapSession(url);
  await s.start();
  try { return await fn(s); } finally { await s.close(); }
}

describe('mapApp', () => {
  it('drives real browser tools from scripted model turns and returns a validated proposal', async () => {
    const script: LLMResponse[] = [
      toolUse('t1', 'navigate', { path: '/login' }),
      toolUse('t2', 'snapshot', {}),
      toolUse('t3', 'propose_flows', { flows: [loginFlowJson] }),
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ];
    const proposals = await withSession((s) => mapApp(s, new FakeLLMClient(script), { maxSteps: 10 }));
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.name).toBe('login');
    expect(proposals[0]!.steps).toHaveLength(5);
  });

  it('rejects an invalid proposal, surfaces the error, and accepts the corrected retry', async () => {
    const bad = { name: 'broken', steps: [{ id: 'x', action: { kind: 'teleport' } }] };
    const script: LLMResponse[] = [
      toolUse('t1', 'propose_flows', { flows: [bad] }),
      toolUse('t2', 'propose_flows', { flows: [loginFlowJson] }),
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ];
    const fake = new FakeLLMClient(script);
    const proposals = await withSession((s) => mapApp(s, fake, { maxSteps: 10 }));
    expect(proposals.map((p) => p.name)).toEqual(['login']);
    const secondReq = fake.requests[1]!;
    const toolResult = secondReq.messages.at(-1)!.content[0]!;
    expect(toolResult.type).toBe('tool_result');
    expect((toolResult as { content: string }).content).toMatch(/reject/i);
  });

  it('caps proposals at 8 and stops at maxSteps without ending', async () => {
    const flows = Array.from({ length: 12 }, (_, i) => ({ ...loginFlowJson, name: `flow${i}` }));
    const script: LLMResponse[] = [toolUse('t1', 'propose_flows', { flows }), { stopReason: 'end_turn', content: [] }];
    const proposals = await withSession((s) => mapApp(s, new FakeLLMClient(script), { maxSteps: 10 }));
    expect(proposals).toHaveLength(8);
  });
});
