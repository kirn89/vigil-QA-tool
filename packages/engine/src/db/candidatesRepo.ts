import { getPool } from './pool.js';

export type CandidateStatus = 'open' | 'selected' | 'needs_info' | 'authored' | 'dismissed';

export interface CandidateInput { name: string; entryUrl: string; recommended: boolean; feasibilityHint?: string; }

export interface CandidateRecord {
  id: string; appId: string; name: string; entryUrl: string;
  recommended: boolean; feasibilityHint: string | null; status: CandidateStatus;
}

interface Row {
  id: string; app_id: string; name: string; entry_url: string;
  recommended: boolean; feasibility_hint: string | null; status: CandidateStatus;
}

function mapRow(r: Row): CandidateRecord {
  return {
    id: r.id, appId: r.app_id, name: r.name, entryUrl: r.entry_url,
    recommended: r.recommended, feasibilityHint: r.feasibility_hint, status: r.status,
  };
}

const COLS = 'id, app_id, name, entry_url, recommended, feasibility_hint, status';

/** Insert new candidates; an existing (app, name) is left untouched so an
 *  already selected/authored/needs_info candidate is never reset by a re-run. */
export async function upsertCandidates(appId: string, candidates: CandidateInput[]): Promise<void> {
  for (const c of candidates) {
    await getPool().query(
      `insert into journey_candidates (app_id, name, entry_url, recommended, feasibility_hint)
       values ($1, $2, $3, $4, $5)
       on conflict (app_id, name) do nothing`,
      [appId, c.name, c.entryUrl, c.recommended, c.feasibilityHint ?? null]);
  }
}

export async function listCandidates(appId: string): Promise<CandidateRecord[]> {
  const { rows } = await getPool().query<Row>(
    `select ${COLS} from journey_candidates where app_id = $1 order by created_at`, [appId]);
  return rows.map(mapRow);
}

export async function getCandidate(appId: string, id: string): Promise<CandidateRecord | null> {
  const { rows } = await getPool().query<Row>(
    `select ${COLS} from journey_candidates where app_id = $1 and id = $2`, [appId, id]);
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Set status; when `hint` is provided it overwrites feasibility_hint (used to
 *  record why authoring failed), otherwise the existing hint is kept. */
export async function setCandidateStatus(
  appId: string, id: string, status: CandidateStatus, hint?: string,
): Promise<void> {
  await getPool().query(
    `update journey_candidates set status = $3, feasibility_hint = coalesce($4, feasibility_hint)
     where app_id = $1 and id = $2`,
    [appId, id, status, hint ?? null]);
}

export async function countAuthoredCandidates(appId: string): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(
    `select count(*)::int n from journey_candidates where app_id = $1 and status = 'authored'`, [appId]);
  return rows[0]!.n;
}
