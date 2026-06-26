import { describe, expect, it } from 'vitest';
import { classifyJourneys } from '../src/journeys/classify.js';
import { FakeLLMClient, type LLMResponse } from '../src/map/llmClient.js';
import type { PageSignals } from '../src/sweep/crawler.js';

const sig = (over: Partial<PageSignals> = {}): PageSignals =>
  ({ hasForm: false, inputCount: 0, actionButtonCount: 0, hasPasswordField: false, ...over });

describe('classifyJourneys', () => {
  it('returns only deep candidates, preserving recommended + hint', async () => {
    const script: LLMResponse[] = [{
      stopReason: 'tool_use',
      content: [{
        type: 'tool_use', id: 't1', name: 'classify_journeys',
        input: { journeys: [
          { name: 'Login', entryUrl: 'http://x/login', depth: 'deep', recommended: true, feasibilityHint: 'needs a test login' },
          { name: 'About', entryUrl: 'http://x/about', depth: 'shallow', recommended: false },
        ] },
      }],
    }];
    const client = new FakeLLMClient(script);
    const out = await classifyJourneys([
      { url: 'http://x/login', signals: sig({ hasForm: true, inputCount: 2, hasPasswordField: true, actionButtonCount: 1 }) },
      { url: 'http://x/about', signals: sig() },
    ], client);

    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('Login');
    expect(out[0]!.recommended).toBe(true);
    expect(out[0]!.feasibilityHint).toBe('needs a test login');
    expect(client.requests[0]!.messages[0]!.content[0]).toMatchObject({ type: 'text' });
  });

  it('returns [] for no pages without calling the LLM', async () => {
    const client = new FakeLLMClient([]); // would throw if called
    expect(await classifyJourneys([], client)).toEqual([]);
  });
});
