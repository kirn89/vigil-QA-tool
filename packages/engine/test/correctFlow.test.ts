import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { goldenPathSchema } from '../src/flows/goldenPath.js';
import { FakeLLMClient, type LLMResponse } from '../src/map/llmClient.js';
import { correctFlow, verifyWithCorrection } from '../src/map/correct.js';

let server: Server;
let url: string;
beforeAll(async () => ({ server, url } = await startFixture()));
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(async () => { await fetch(`${url}/__reset`, { method: 'POST' }); });

const broken = goldenPathSchema.parse({
  name: 'contact',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/contact' } },
    { id: 's2', action: { kind: 'fill', selector: '#name', value: 'x', description: 'nonexistent' } },
  ],
});
const correctedJson = {
  name: 'contact',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/contact' } },
    { id: 's2', action: { kind: 'fill', selector: 'input[name="email"]', value: 'a@b.c', description: 'email' } },
    { id: 's3', action: { kind: 'fill', selector: 'textarea[name="message"]', value: 'hi', description: 'message' } },
    { id: 's4', action: { kind: 'click', selector: 'button[type="submit"]', description: 'send' } },
    { id: 's5', action: { kind: 'expect_text', text: 'Thanks' } },
  ],
};

describe('correctFlow', () => {
  it('navigates to the failing page, shows the model the real elements, returns the corrected flow', async () => {
    const fake = new FakeLLMClient([
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'propose_flows', input: { flows: [correctedJson] } }] },
    ]);
    const out = await correctFlow(broken, 'step s2: locator.fill timeout', fake, { baseUrl: url });
    expect(out?.name).toBe('contact');
    expect(out?.steps).toHaveLength(5);
    const req = fake.requests[0]!;
    const userText = (req.messages[0]!.content[0] as { text: string }).text;
    expect(userText).toMatch(/s2/);
    expect(userText).toMatch(/name="email"|name="message"/);
  });
});

describe('verifyWithCorrection', () => {
  it('returns verified when a first-fail flow is auto-corrected to a passing one', async () => {
    const fake = new FakeLLMClient([
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'propose_flows', input: { flows: [correctedJson] } }] },
    ]);
    const res = await verifyWithCorrection(broken, fake, { baseUrl: url, stepTimeoutMs: 6000 });
    expect(res.verified).toBe(true);
    expect(res.flow.steps).toHaveLength(5);
    expect(res.note).toBeUndefined();
  });

  it('returns verified with no LLM call when the flow already passes', async () => {
    const good = goldenPathSchema.parse({
      name: 'about', steps: [
        { id: 's1', action: { kind: 'goto', path: '/about' } },
        { id: 's2', action: { kind: 'expect_text', text: 'About' } },
      ],
    });
    const fake = new FakeLLMClient([]);
    const res = await verifyWithCorrection(good, fake, { baseUrl: url, stepTimeoutMs: 6000 });
    expect(res.verified).toBe(true);
    expect(fake.requests).toHaveLength(0);
  });

  it('stays unverified when correction also fails', async () => {
    const stillBroken = { ...correctedJson, steps: [ { id: 's1', action: { kind: 'goto', path: '/contact' } }, { id: 's2', action: { kind: 'expect_text', text: 'NOT ON PAGE' } } ] };
    const fake = new FakeLLMClient([
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'propose_flows', input: { flows: [stillBroken] } }] },
    ]);
    const res = await verifyWithCorrection(broken, fake, { baseUrl: url, stepTimeoutMs: 4000 });
    expect(res.verified).toBe(false);
    expect(res.note).toBeTruthy();
  });
});
