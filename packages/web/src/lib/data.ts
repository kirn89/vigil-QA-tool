import type { FlowAttempt, FindingKind } from '@vigil/engine';
import { createClient } from './supabase/server.js';
import { createServiceClient } from './supabase/service.js';
import { signedUrlFor } from './screenshots.js';

type V = 'pass' | 'broken' | 'unsure';

export interface FlowDetailVM {
  flow: { id: string; name: string };
  appId: string;
  runs: { verdict: V; failedStepId: string | null; at: string }[];
  steps: { id: string; kind: string; detail: string }[];
}
export interface AppSummary { id: string; name: string; worst: V | null; lastChecked: string | null }
export interface FlowReportVM { id: string; name: string; verdict: V | null; failedStepId: string | null; at: string | null; shots: string[] }
export interface FindingVM { kind: FindingKind; pageUrl: string; evidence: string }
export interface AppReportVM { app: { id: string; name: string }; flows: FlowReportVM[]; findings: FindingVM[] }

const RANK: Record<V, number> = { broken: 3, unsure: 2, pass: 1 };
function worstOf(verdicts: (V | null)[]): V | null {
  let worst: V | null = null;
  for (const v of verdicts) if (v && (!worst || RANK[v] > RANK[worst])) worst = v;
  return worst;
}

/** Apps for the signed-in user (RLS-scoped), each with its worst current flow verdict. */
export async function listApps(): Promise<AppSummary[]> {
  const sb = await createClient();
  const { data: apps } = await sb.from('apps').select('id,name').order('name');
  const out: AppSummary[] = [];
  for (const a of apps ?? []) {
    const { data: flows } = await sb.from('flows').select('id').eq('app_id', a.id).eq('status', 'confirmed');
    const verdicts: (V | null)[] = [];
    let lastChecked: string | null = null;
    for (const f of flows ?? []) {
      const { data: run } = await sb.from('runs').select('verdict,created_at').eq('flow_id', f.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      verdicts.push((run?.verdict as V | undefined) ?? null);
      if (run?.created_at && (!lastChecked || run.created_at > lastChecked)) lastChecked = run.created_at;
    }
    out.push({ id: a.id, name: a.name, worst: worstOf(verdicts), lastChecked });
  }
  return out;
}

/** Full report for one app: confirmed flows + latest verdict + failure screenshots,
 *  plus confirmed (>=2 consecutive) sweep findings. All RLS-scoped. */
export async function getAppReport(appId: string): Promise<AppReportVM | null> {
  const sb = await createClient();
  const { data: app } = await sb.from('apps').select('id,name').eq('id', appId).maybeSingle();
  if (!app) return null;

  let storage: ReturnType<typeof createServiceClient>['storage'] | undefined;
  const { data: flows } = await sb.from('flows').select('id,name').eq('app_id', appId).eq('status', 'confirmed').order('name');
  const flowVMs: FlowReportVM[] = [];
  for (const f of flows ?? []) {
    const { data: run } = await sb.from('runs')
      .select('verdict,failed_step_id,attempts,created_at')
      .eq('flow_id', f.id).order('created_at', { ascending: false }).limit(1).maybeSingle();

    let shots: string[] = [];
    if (run?.verdict === 'broken' && Array.isArray(run.attempts)) {
      const attempts = run.attempts as FlowAttempt[];
      const last = attempts[attempts.length - 1];
      const locators = (last?.steps ?? []).map((s) => s.screenshot).filter((x): x is string => !!x);
      storage ??= createServiceClient().storage;
      const signed = await Promise.all(locators.map((loc) => signedUrlFor(storage!, loc)));
      shots = signed.filter((u): u is string => !!u);
    }
    flowVMs.push({
      id: f.id,
      name: f.name,
      verdict: (run?.verdict as V | undefined) ?? null,
      failedStepId: run?.failed_step_id ?? null,
      at: run?.created_at ?? null,
      shots,
    });
  }

  const { data: findings } = await sb.from('sweep_findings')
    .select('kind,page_url,evidence')
    .eq('app_id', appId).eq('status', 'open').gte('consecutive_count', 2).order('first_seen');

  return {
    app: { id: app.id, name: app.name },
    flows: flowVMs,
    findings: (findings ?? []).map((r) => ({ kind: r.kind as FindingKind, pageUrl: r.page_url, evidence: r.evidence })),
  };
}

export async function latestJob(appId: string): Promise<{ id: string; status: 'queued'|'running'|'done'|'failed'; environment: 'production'|'preview' } | null> {
  const sb = await createClient();
  const { data } = await sb.from('jobs')
    .select('id,status,environment').eq('app_id', appId)
    .order('requested_at', { ascending: false }).limit(1).maybeSingle();
  return data ? { id: data.id, status: data.status, environment: data.environment } : null;
}

export async function getFlowDetail(appId: string, flowId: string): Promise<FlowDetailVM | null> {
  const sb = await createClient();
  const { data: flow } = await sb.from('flows').select('id,name,golden_path').eq('id', flowId).eq('app_id', appId).maybeSingle();
  if (!flow) return null;
  const { data: runs } = await sb.from('runs')
    .select('verdict,failed_step_id,created_at').eq('flow_id', flowId)
    .order('created_at', { ascending: false }).limit(20);
  const gp = flow.golden_path as { steps?: { id: string; action: Record<string, unknown> }[] } | null;
  const steps = (gp?.steps ?? []).map((s) => ({
    id: s.id,
    kind: String(s.action.kind ?? ''),
    detail: String(s.action.path ?? s.action.selector ?? s.action.pattern ?? s.action.text ?? ''),
  }));
  return {
    flow: { id: flow.id, name: flow.name },
    appId,
    runs: (runs ?? []).map((r) => ({ verdict: r.verdict as V, failedStepId: r.failed_step_id ?? null, at: r.created_at })),
    steps,
  };
}
