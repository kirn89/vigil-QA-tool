import { z } from 'zod';
import type { LLMClient } from '../map/llmClient.js';
import type { ToolDef } from '../map/toolSchemas.js';
import type { PageSignals } from '../sweep/crawler.js';

export interface ClassifierPage { url: string; signals: PageSignals; }
export interface JourneyCandidate {
  name: string; entryUrl: string; depth: 'deep' | 'shallow'; recommended: boolean; feasibilityHint?: string;
}

const candidateSchema = z.object({
  name: z.string().min(1),
  entryUrl: z.string().min(1),
  depth: z.enum(['deep', 'shallow']),
  recommended: z.boolean().default(false),
  feasibilityHint: z.string().optional(),
});

export const CLASSIFY_TOOL: ToolDef = {
  name: 'classify_journeys',
  description: 'Report the user journeys you identified from the crawled pages. Call exactly once with all journeys.',
  input_schema: {
    type: 'object',
    properties: {
      journeys: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Short plain-English journey name, e.g. "Checkout"' },
            entryUrl: { type: 'string', description: 'One of the page urls from the list where the journey starts' },
            depth: { type: 'string', enum: ['deep', 'shallow'], description: 'deep = interactive multi-step task worth watching; shallow = static/info page' },
            recommended: { type: 'boolean', description: 'Whether you recommend watching this deeply' },
            feasibilityHint: { type: 'string', description: 'Optional note if authoring would need something special, e.g. "needs a test login", "hits payment"' },
          },
          required: ['name', 'entryUrl', 'depth', 'recommended'],
        },
      },
    },
    required: ['journeys'],
  },
};

const SYSTEM = `You are Vigil's journey classifier. You receive a list of pages a read-only crawler found in a web app, each annotated with interaction signals (forms, inputs, password fields, buttons).

Decide which pages represent a DEEP user journey — a meaningful, interactive, business-critical task worth watching closely every night (login, signup, onboarding, the core action like create/search/upload/post, checkout, settings) — versus a SHALLOW page (static/marketing/info with little interaction).

For each distinct journey give: a short plain-English name, the entryUrl (one of the provided page urls), depth ('deep' or 'shallow'), whether you recommend watching it, and an optional feasibilityHint if authoring its steps would need something special (e.g. "needs a test login", "hits payment").

Use the interaction signals as evidence: forms/inputs/password fields/buttons suggest deep; little interaction suggests shallow. Do NOT invent pages that are not in the list. Call classify_journeys exactly once with all journeys.`;

function renderPages(pages: ClassifierPage[]): string {
  return pages
    .map((p) => `${p.url} — form:${p.signals.hasForm} inputs:${p.signals.inputCount} password:${p.signals.hasPasswordField} buttons:${p.signals.actionButtonCount}`)
    .join('\n');
}

/** One LLM pass over the latest sweep. Returns only the deep candidates; the LLM
 *  classifies and recommends but never decides the watched set (the user does). */
export async function classifyJourneys(pages: ClassifierPage[], client: LLMClient): Promise<JourneyCandidate[]> {
  if (pages.length === 0) return [];
  const resp = await client.createMessage({
    system: SYSTEM,
    tools: [CLASSIFY_TOOL],
    messages: [{ role: 'user', content: [{ type: 'text', text: `Pages found:\n${renderPages(pages)}` }] }],
  });

  let input: unknown;
  for (const b of resp.content) {
    if (b.type === 'tool_use' && b.name === 'classify_journeys') input = b.input;
  }
  if (input === undefined) return [];

  const raw = (input as { journeys?: unknown }).journeys;
  const journeys = Array.isArray(raw) ? raw : [];
  const out: JourneyCandidate[] = [];
  for (const raw of journeys) {
    const parsed = candidateSchema.safeParse(raw);
    if (parsed.success && parsed.data.depth === 'deep') {
      out.push({
        name: parsed.data.name,
        entryUrl: parsed.data.entryUrl,
        depth: 'deep',
        recommended: parsed.data.recommended,
        feasibilityHint: parsed.data.feasibilityHint,
      });
    }
  }
  return out;
}
