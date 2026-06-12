import { getPool } from './pool.js';
import { goldenPathSchema, type GoldenPath } from '../flows/goldenPath.js';

export interface FlowRecord { id: string; appId: string; status: string; version: number; goldenPath: GoldenPath; }

export async function addFlow(appId: string, goldenPath: unknown, status: 'proposed' | 'confirmed' = 'confirmed'): Promise<FlowRecord> {
  const parsed = goldenPathSchema.parse(goldenPath);
  const { rows } = await getPool().query<{ id: string; version: number }>(
    `insert into flows (app_id, name, status, golden_path) values ($1, $2, $3, $4) returning id, version`,
    [appId, parsed.name, status, JSON.stringify(parsed)]);
  return { id: rows[0]!.id, appId, status, version: rows[0]!.version, goldenPath: parsed };
}

export async function listConfirmedFlows(appId: string): Promise<FlowRecord[]> {
  const { rows } = await getPool().query<{ id: string; app_id: string; status: string; version: number; golden_path: unknown }>(
    `select id, app_id, status, version, golden_path from flows
     where app_id = $1 and status = 'confirmed' order by created_at`, [appId]);
  return rows.map((r) => ({
    id: r.id, appId: r.app_id, status: r.status, version: r.version,
    goldenPath: goldenPathSchema.parse(r.golden_path),
  }));
}
