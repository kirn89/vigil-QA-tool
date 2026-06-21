import OpenAI from 'openai';
import { env } from '../env.js';
import { withRetry } from './retry.js';
import type { ToolDef } from './toolSchemas.js';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface LLMMessage { role: 'user' | 'assistant'; content: ContentBlock[]; }
export interface LLMRequest { system: string; tools: ToolDef[]; messages: LLMMessage[]; }
export interface LLMResponse { stopReason: string; content: ContentBlock[]; }

export interface LLMClient {
  createMessage(req: LLMRequest): Promise<LLMResponse>;
}

/** Deterministic stand-in for tests: returns scripted responses, records requests. */
export class FakeLLMClient implements LLMClient {
  public readonly requests: LLMRequest[] = [];
  private i = 0;
  constructor(private readonly script: LLMResponse[]) {}
  async createMessage(req: LLMRequest): Promise<LLMResponse> {
    this.requests.push(req);
    if (this.i >= this.script.length) throw new Error('FakeLLMClient script exhausted');
    return this.script[this.i++]!;
  }
}

function safeParseArgs(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}

/** Real client: a Claude (Sonnet-class) model reached through OpenRouter's OpenAI-
 *  compatible endpoint. Adapts our neutral ContentBlock shape to/from OpenAI chat +
 *  tool-calls. Model is env-configurable; default is a Sonnet slug on OpenRouter. */
export class OpenRouterClient implements LLMClient {
  private readonly model = process.env.VIGIL_MAP_MODEL ?? 'anthropic/claude-sonnet-4.5';
  private readonly openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: env('OPENROUTER_API_KEY'),
    maxRetries: 3, // SDK-level retries for connection errors / 429 / 5xx
  });

  async createMessage(req: LLMRequest): Promise<LLMResponse> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: req.system }];
    for (const m of req.messages) {
      if (m.role === 'assistant') {
        const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
        const toolCalls = m.content
          .filter((b) => b.type === 'tool_use')
          .map((b) => {
            const tu = b as { id: string; name: string; input: unknown };
            return { id: tu.id, type: 'function' as const, function: { name: tu.name, arguments: JSON.stringify(tu.input ?? {}) } };
          });
        messages.push({ role: 'assistant', content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      } else {
        for (const b of m.content) {
          if (b.type === 'text') messages.push({ role: 'user', content: b.text });
          else if (b.type === 'tool_result') messages.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.content });
        }
      }
    }
    const tools = req.tools.map((t: ToolDef) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.input_schema as Record<string, unknown> },
    }));

    const resp = await withRetry(() => this.openai.chat.completions.create({ model: this.model, max_tokens: 8000, messages, tools }));
    const msg = resp.choices[0]?.message;
    // SDK v6+ types tool_calls as ChatCompletionMessageFunctionToolCall | ChatCompletionMessageCustomToolCall.
    // Narrow to 'function' type before accessing .function to satisfy the union.
    if (msg?.tool_calls?.length) {
      const content: ContentBlock[] = msg.tool_calls
        .filter((tc) => tc.type === 'function')
        .map((tc) => {
          // After the filter guard, tc is ChatCompletionMessageFunctionToolCall
          const ftc = tc as { id: string; type: 'function'; function: { name: string; arguments: string } };
          return { type: 'tool_use' as const, id: ftc.id, name: ftc.function.name, input: safeParseArgs(ftc.function.arguments) };
        });
      if (content.length > 0) return { stopReason: 'tool_use', content };
    }
    return { stopReason: 'end_turn', content: [{ type: 'text', text: msg?.content ?? '' }] };
  }
}
