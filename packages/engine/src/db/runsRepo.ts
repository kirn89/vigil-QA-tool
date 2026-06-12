import { getPool } from './pool.js';
import type { FlowAttempt } from '../replay/executor.js';
import type { Verdict } from '../verdict/classify.js';

export async function insertRun(input: {
  flowId: string; environment: 'production' | 'preview'; verdict: Verdict;
  failedStepId: string | null; attempts: FlowAttempt[]; durationMs: number;
}): Promise<string> {
  const { rows } = await getPool().query(
    `insert into runs (flow_id, environment, verdict, failed_step_id, attempts, duration_ms)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [input.flowId, input.environment, input.verdict, input.failedStepId,
     JSON.stringify(input.attempts), input.durationMs]);
  return rows[0]!.id;
}

export interface LatestVerdict { flowName: string; verdict: Verdict; failedStepId: string | null; at: Date; }

export async function latestVerdicts(appId: string): Promise<LatestVerdict[]> {
  const { rows } = await getPool().query(
    `select distinct on (f.id) f.name as flow_name, r.verdict, r.failed_step_id, r.created_at
     from flows f join runs r on r.flow_id = f.id
     where f.app_id = $1
     order by f.id, r.created_at desc`, [appId]);
  return rows.map((r) => ({ flowName: r.flow_name, verdict: r.verdict, failedStepId: r.failed_step_id, at: r.created_at }));
}
