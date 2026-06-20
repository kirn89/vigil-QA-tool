import { goldenPathSchema, type GoldenPath } from '../flows/goldenPath.js';
import { MAP_TOOLS } from './toolSchemas.js';
import type { ContentBlock, LLMClient, LLMMessage } from './llmClient.js';
import type { MapSession, SnapshotEntry } from './browserTools.js';

const MAX_FLOWS = 8;

const SYSTEM = `You are Vigil's app mapper. You explore a web app through a browser and identify its critical user journeys (the flows that, if broken, hurt the business: signup, login, the core action, checkout, contact).

Process:
1. Start logged out. navigate("/"), snapshot, and explore the main entry points.
2. If test credentials are provided, log in (use the placeholders {{email}} and {{password}} as the values you fill) and explore the logged-in app.
3. Identify up to 8 critical journeys. For each, write a golden path: an ordered list of steps using the DURABLE SELECTORS shown in snapshots (e.g. #email), ending with expect_url and/or expect_text on stable content that proves the journey worked.
4. Never attempt destructive actions (logout, delete, sending messages to real people, real payments). Stop a journey at that boundary and assert the page state instead.
5. When done, call propose_flows ONCE with all flows. If a proposal is rejected, read the reason and resubmit a corrected version.

Keep flows short (<= 30 steps). Prefer the few journeys that matter over many trivial ones.`;

function kickoff(credentials?: { email: string; password: string }): string {
  return credentials
    ? 'Explore this app. Test credentials are available — fill {{email}} and {{password}} as the login values (do not invent real values).'
    : 'Explore this app. No login credentials are available — map what you can reach logged out.';
}

function renderSnapshot(entries: SnapshotEntry[]): string {
  if (entries.length === 0) return '(no interactive elements)';
  return entries.map((e) => `[${e.ref}] ${e.role} "${e.name}" -> ${e.selector}`).join('\n');
}

async function dispatchBrowserTool(session: MapSession, name: string, input: unknown): Promise<string> {
  const a = input as Record<string, string>;
  switch (name) {
    case 'navigate': return session.navigate(a.path ?? '/');
    case 'read_state': return session.readState();
    case 'snapshot': return renderSnapshot(await session.snapshot());
    case 'click': return session.click(a.ref ?? '');
    case 'fill': return session.fill(a.ref ?? '', a.value ?? '');
    case 'select': return session.select(a.ref ?? '', a.value ?? '');
    default: return `error: unknown tool "${name}"`;
  }
}

/** Validate proposed flows against the real schema; collect valid ones (capped),
 *  return a human-readable result the model can act on. */
function handleProposals(input: unknown, collected: GoldenPath[]): string {
  const flows = (input as { flows?: unknown[] }).flows ?? [];
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const raw of flows) {
    if (collected.length >= MAX_FLOWS) break;
    const parsed = goldenPathSchema.safeParse(raw);
    if (parsed.success) { collected.push(parsed.data); accepted.push(parsed.data.name); }
    else rejected.push(`${(raw as { name?: string }).name ?? '?'}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  }
  const parts = [`accepted ${accepted.length} flow(s)${accepted.length ? `: ${accepted.join(', ')}` : ''}`];
  if (rejected.length) parts.push(`rejected ${rejected.length}: ${rejected.join('; ')}`);
  return parts.join('. ');
}

export interface MapOptions {
  credentials?: { email: string; password: string };
  maxSteps?: number;
}

export async function mapApp(session: MapSession, client: LLMClient, opts: MapOptions = {}): Promise<GoldenPath[]> {
  const maxSteps = opts.maxSteps ?? 40;
  const proposals: GoldenPath[] = [];
  const messages: LLMMessage[] = [{ role: 'user', content: [{ type: 'text', text: kickoff(opts.credentials) }] }];

  for (let step = 0; step < maxSteps; step++) {
    const resp = await client.createMessage({ system: SYSTEM, tools: MAP_TOOLS, messages: [...messages] });
    messages.push({ role: 'assistant', content: resp.content });
    if (resp.stopReason === 'end_turn') break;

    const toolResults: ContentBlock[] = [];
    for (const block of resp.content) {
      if (block.type !== 'tool_use') continue;
      const content = block.name === 'propose_flows'
        ? handleProposals(block.input, proposals)
        : await dispatchBrowserTool(session, block.name, block.input);
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
    }
    if (toolResults.length === 0) break;
    messages.push({ role: 'user', content: toolResults });
  }
  return proposals.slice(0, MAX_FLOWS);
}
