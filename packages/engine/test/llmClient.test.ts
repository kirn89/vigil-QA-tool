import { describe, expect, it } from 'vitest';
import { FakeLLMClient, type LLMResponse } from '../src/map/llmClient.js';

describe('FakeLLMClient', () => {
  it('returns scripted responses in order and records requests', async () => {
    const script: LLMResponse[] = [
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'navigate', input: { path: '/' } }] },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
    ];
    const fake = new FakeLLMClient(script);
    const r1 = await fake.createMessage({ system: 's', tools: [], messages: [] });
    const r2 = await fake.createMessage({ system: 's', tools: [], messages: [] });
    expect(r1.stopReason).toBe('tool_use');
    expect(r2.stopReason).toBe('end_turn');
    expect(fake.requests).toHaveLength(2);
  });
  it('throws if the script is exhausted (prevents runaway loops in tests)', async () => {
    const fake = new FakeLLMClient([]);
    await expect(fake.createMessage({ system: '', tools: [], messages: [] })).rejects.toThrow(/script exhausted/i);
  });
});
