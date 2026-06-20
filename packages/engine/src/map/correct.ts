import { goldenPathSchema, type GoldenPath } from '../flows/goldenPath.js';
import { MapSession } from './browserTools.js';
import { renderSnapshot } from './mapper.js';
import { MAP_TOOLS } from './toolSchemas.js';
import { verifyFlow } from './verify.js';
import type { LLMClient } from './llmClient.js';

const PROPOSE_ONLY = MAP_TOOLS.filter((t) => t.name === 'propose_flows');

const CORRECT_SYSTEM = `You fix ONE broken Vigil golden-path flow. You are given the flow, the exact step that failed when it was replayed in a fresh browser, and the REAL interactive elements on the page where it operates. Produce a corrected version of the SAME journey (same name and intent) using ONLY the durable selectors shown. Ground every assertion in text/urls that actually appear. Use {{email}} / {{password}} for login values. Call propose_flows once with exactly one corrected flow.`;

export interface CorrectOptions {
  baseUrl: string;
  credentials?: { email: string; password: string };
}

/** One LLM round to repair a flow that failed verification. Returns the corrected
 *  GoldenPath, or undefined if the model didn't produce a valid one. */
export async function correctFlow(flow: GoldenPath, failureNote: string, client: LLMClient, opts: CorrectOptions): Promise<GoldenPath | undefined> {
  const gotoPaths = flow.steps.flatMap((s) => (s.action.kind === 'goto' ? [s.action.path] : []));
  const ctxPath = gotoPaths.at(-1) ?? '/';

  const session = new MapSession(opts.baseUrl);
  await session.start();
  let snapshot: string;
  try {
    await session.navigate(ctxPath);
    snapshot = renderSnapshot(await session.snapshot());
  } catch (e) {
    snapshot = `(could not snapshot ${ctxPath}: ${e instanceof Error ? e.message : String(e)})`;
  } finally {
    await session.close();
  }

  const prompt = `This flow failed verification:\n${JSON.stringify(flow, null, 2)}\n\nFailure: ${failureNote}\n\nThe page at "${ctxPath}" actually has these interactive elements:\n${snapshot}\n\nReturn a corrected version of this same journey (keep the name "${flow.name}") using only these real selectors, with assertions grounded in this page.`;

  const resp = await client.createMessage({
    system: CORRECT_SYSTEM,
    tools: PROPOSE_ONLY,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
  });
  for (const block of resp.content) {
    if (block.type === 'tool_use' && block.name === 'propose_flows') {
      const flows = (block.input as { flows?: unknown[] }).flows ?? [];
      const parsed = goldenPathSchema.safeParse(flows[0]);
      if (parsed.success) return parsed.data;
    }
  }
  return undefined;
}

export interface VerifyWithCorrectionResult { flow: GoldenPath; verified: boolean; note?: string; }

export interface VerifyWithCorrectionOptions {
  baseUrl: string;
  credentials?: { email: string; password: string };
  stepTimeoutMs?: number;
}

/** Verify a flow; if it fails, attempt ONE LLM correction and re-verify. */
export async function verifyWithCorrection(flow: GoldenPath, client: LLMClient, opts: VerifyWithCorrectionOptions): Promise<VerifyWithCorrectionResult> {
  const first = await verifyFlow(flow, opts);
  if (first.verified) return { flow, verified: true };

  const corrected = await correctFlow(flow, first.note ?? 'did not complete', client, { baseUrl: opts.baseUrl, credentials: opts.credentials });
  if (!corrected) return { flow, verified: false, note: first.note };

  const second = await verifyFlow(corrected, opts);
  return second.verified
    ? { flow: corrected, verified: true }
    : { flow: corrected, verified: false, note: second.note };
}
