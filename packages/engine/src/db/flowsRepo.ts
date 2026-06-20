import { getPool } from './pool.js';
import { goldenPathSchema, type GoldenPath } from '../flows/goldenPath.js';

export interface FlowRecord {
  id: string; appId: string; status: string; version: number; goldenPath: GoldenPath;
  verified: boolean; verificationNote: string | null; source: string;
}

export interface AddFlowOptions { verified?: boolean; verificationNote?: string | null; source?: 'mapped' | 'described' | 'manual'; }

export async function addFlow(
  appId: string, goldenPath: unknown, status: 'proposed' | 'confirmed' = 'confirmed', opts: AddFlowOptions = {},
): Promise<FlowRecord> {
  const parsed = goldenPathSchema.parse(goldenPath);
  const verified = opts.verified ?? false;
  const note = opts.verificationNote ?? null;
  const source = opts.source ?? 'manual';
  const { rows } = await getPool().query<{ id: string; version: number }>(
    `insert into flows (app_id, name, status, golden_path, verified, verification_note, source)
     values ($1, $2, $3, $4, $5, $6, $7) returning id, version`,
    [appId, parsed.name, status, JSON.stringify(parsed), verified, note, source]);
  return { id: rows[0]!.id, appId, status, version: rows[0]!.version, goldenPath: parsed, verified, verificationNote: note, source };
}

export async function listConfirmedFlows(appId: string): Promise<FlowRecord[]> {
  const { rows } = await getPool().query<{ id: string; app_id: string; status: string; version: number; golden_path: unknown; verified: boolean; verification_note: string | null; source: string }>(
    `select id, app_id, status, version, golden_path, verified, verification_note, source from flows
     where app_id = $1 and status = 'confirmed' order by created_at`, [appId]);
  return rows.map((r) => ({
    id: r.id, appId: r.app_id, status: r.status, version: r.version,
    goldenPath: goldenPathSchema.parse(r.golden_path),
    verified: r.verified, verificationNote: r.verification_note, source: r.source,
  }));
}

export async function listProposedFlows(appId: string): Promise<FlowRecord[]> {
  const { rows } = await getPool().query<{ id: string; app_id: string; status: string; version: number; golden_path: unknown; verified: boolean; verification_note: string | null; source: string }>(
    `select id, app_id, status, version, golden_path, verified, verification_note, source from flows
     where app_id = $1 and status = 'proposed' order by created_at`, [appId]);
  return rows.map((r) => ({
    id: r.id, appId: r.app_id, status: r.status, version: r.version,
    goldenPath: goldenPathSchema.parse(r.golden_path),
    verified: r.verified, verificationNote: r.verification_note, source: r.source,
  }));
}

export interface ConfirmResult { ok: boolean; reason?: string; }

export async function confirmFlow(appId: string, name: string, opts: { force?: boolean } = {}): Promise<ConfirmResult> {
  const { rows } = await getPool().query<{ verified: boolean }>(
    `select verified from flows where app_id = $1 and name = $2 and status = 'proposed'`, [appId, name]);
  if (rows.length === 0) return { ok: false, reason: 'no such proposed flow' };
  if (!rows[0]!.verified && !opts.force) return { ok: false, reason: 'unverified — re-map/fix it or confirm with --force' };
  await getPool().query(`update flows set status = 'confirmed' where app_id = $1 and name = $2 and status = 'proposed'`, [appId, name]);
  return { ok: true };
}

export async function deleteProposedFlows(appId: string): Promise<void> {
  await getPool().query(`delete from flows where app_id = $1 and status = 'proposed'`, [appId]);
}
