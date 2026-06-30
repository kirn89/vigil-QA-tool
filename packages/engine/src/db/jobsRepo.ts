import { getPool } from './pool.js';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type JobEnvironment = 'production' | 'preview';
export interface JobRecord { id: string; appId: string; type: 'check_now'; environment: JobEnvironment; status: JobStatus; error: string | null; }

interface Row { id: string; app_id: string; type: 'check_now'; environment: JobEnvironment; status: JobStatus; error: string | null; }
const map = (r: Row): JobRecord => ({ id: r.id, appId: r.app_id, type: r.type, environment: r.environment, status: r.status, error: r.error });

export async function enqueueJob(appId: string, type: 'check_now', environment: JobEnvironment, requestedBy: string | null = null): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    'insert into jobs (app_id, type, environment, requested_by) values ($1, $2, $3, $4) returning id',
    [appId, type, environment, requestedBy]);
  return rows[0]!.id;
}

/** Atomically claim the oldest queued job, marking it running. Concurrent workers
 *  skip a locked row (FOR UPDATE SKIP LOCKED), so no two claim the same job. */
export async function claimNextJob(): Promise<JobRecord | null> {
  const { rows } = await getPool().query<Row>(
    `update jobs set status = 'running', started_at = now()
     where id = (select id from jobs where status = 'queued' order by requested_at for update skip locked limit 1)
     returning id, app_id, type, environment, status, error`);
  return rows[0] ? map(rows[0]) : null;
}

export async function finishJob(id: string, ok: boolean, error: string | null = null): Promise<void> {
  await getPool().query(
    "update jobs set status = $2, error = $3, finished_at = now() where id = $1",
    [id, ok ? 'done' : 'failed', ok ? null : error]);
}

export async function hasActiveJob(appId: string): Promise<boolean> {
  const { rows } = await getPool().query<{ n: number }>(
    "select count(*)::int n from jobs where app_id = $1 and status in ('queued','running')", [appId]);
  return rows[0]!.n > 0;
}
