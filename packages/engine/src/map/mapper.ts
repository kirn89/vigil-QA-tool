import { goldenPathSchema, type GoldenPath } from '../flows/goldenPath.js';
import { MAP_TOOLS } from './toolSchemas.js';
import type { ContentBlock, LLMClient, LLMMessage } from './llmClient.js';
import type { MapSession, SnapshotEntry } from './browserTools.js';

const MAX_FLOWS = 8;

const SYSTEM = `You are Vigil's app mapper. You explore a web app through a browser and identify ALL of its critical user journeys — every distinct thing a user comes to the app to do (sign up, log in, complete onboarding, the core action(s) like create / search / upload / ask / post, checkout, contact). If a journey breaks, the business is hurt. Your job is to find them COMPREHENSIVELY, not just the obvious one.

Process:
1. Start logged out. navigate("/"), snapshot, and follow the main entry points (nav links, primary buttons) to learn what the app actually does.
2. If test credentials are provided, log in (fill the placeholders {{email}} and {{password}} as the login values) and thoroughly explore the logged-in app — visit each distinct section/page you can reach.
3. Enumerate every distinct critical journey (aim for 3–8; login is usually one of them, but it is NEVER the only one). DO NOT stop after the first flow — keep exploring until you have seen the app's main features.
4. For EACH journey, actually PERFORM it in the browser first (navigate, then click/fill/select through the real steps), observing the real page states as you go. Then write its golden path from what you actually did and saw — ordered steps using the DURABLE SELECTORS from snapshots (e.g. #email).
5. Assertions are grounded, not guessed. An expect_text or expect_url must come AFTER the step that produces that state, never before it. Only assert text you ACTUALLY observed on that resulting page, and a url pattern you ACTUALLY landed on. End each journey with such an assertion proving it worked.
6. Never perform destructive or outward-facing actions: logout, delete, sending messages / proposals / posts to other people, real payments. Stop a journey at that boundary and assert the page state instead.
7. When you have explored everything, call propose_flows ONCE with ALL journeys. If a proposal is rejected, read the reason and resubmit a corrected version.

Keep each flow <= 30 steps. Cover every distinct critical journey you can reach; skip only truly trivial interactions (expanding an FAQ accordion, opening a footer link).`;

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
    // Shallow-copy so a recording client (FakeLLMClient) captures a per-call snapshot, not the live array we keep mutating.
    const resp = await client.createMessage({ system: SYSTEM, tools: MAP_TOOLS, messages: [...messages] });
    messages.push({ role: 'assistant', content: resp.content });
    if (resp.stopReason === 'end_turn') break;

    const toolResults: ContentBlock[] = [];
    for (const block of resp.content) {
      if (block.type !== 'tool_use') continue;
      const content = block.name === 'propose_flows'
        ? handleProposals(block.input, proposals)
        : await dispatchBrowserTool(session, block.name, block.input)
            .catch((e: unknown) => `error: ${e instanceof Error ? e.message : String(e)}`);
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
    }
    if (toolResults.length === 0) break;
    messages.push({ role: 'user', content: toolResults });
  }
  return proposals.slice(0, MAX_FLOWS);
}
