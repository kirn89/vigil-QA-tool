import { createHash } from 'node:crypto';
import { getPool } from './pool.js';
import type { FindingKind, SweepFinding, SweepResult } from '../sweep/crawler.js';

const SLOW_FLOOR_MS = 3_000;
const SLOW_FACTOR = 3;
const HISTORY_SWEEPS = 7;

function fingerprint(f: SweepFinding): string {
  // Normalize evidence so the same logical finding hashes identically across sweeps
  const evidenceKey = f.kind === 'slow' ? '' : f.evidence.slice(0, 200);
  return createHash('sha256').update(`${f.kind}|${f.pageUrl}|${evidenceKey}`).digest('hex');
}

// Returns the upper-middle element for even-length arrays (slightly conservative — raises the slow threshold)
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Computes `slow` findings for this sweep from page history, then upserts all findings:
 *  seen → consecutive_count + 1; not seen → resolved (streak resets via status flip). */
export async function recordSweep(appId: string, result: SweepResult): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    'insert into sweeps (app_id, pages_visited) values ($1, $2) returning id',
    [appId, result.pages.length]);
  const sweepId = rows[0]!.id;

  for (const p of result.pages) {
    await pool.query(
      'insert into sweep_pages (sweep_id, url, http_status, load_ms) values ($1, $2, $3, $4) on conflict do nothing',
      [sweepId, p.url, p.httpStatus, p.loadMs]);
  }

  // Derive slow findings against each page's own history (excluding this sweep)
  const findings: SweepFinding[] = [...result.findings];
  for (const p of result.pages) {
    if (p.httpStatus === 0 || p.httpStatus >= 400) continue;
    const { rows: hist } = await pool.query<{ load_ms: number }>(
      `select sp.load_ms from sweep_pages sp
       join sweeps s on s.id = sp.sweep_id
       where s.app_id = $1 and sp.url = $2 and sp.sweep_id <> $3
       order by s.started_at desc limit $4`,
      [appId, p.url, sweepId, HISTORY_SWEEPS]);
    if (hist.length < 3) continue; // not enough history to judge
    const med = median(hist.map((h) => h.load_ms));
    if (p.loadMs >= SLOW_FLOOR_MS && med > 0 && p.loadMs >= SLOW_FACTOR * med) {
      findings.push({ pageUrl: p.url, kind: 'slow', evidence: `loaded in ${p.loadMs}ms vs median ${med}ms` });
    }
  }

  const seen: string[] = [];
  for (const f of findings) {
    const fp = fingerprint(f);
    seen.push(fp);
    await pool.query(
      `insert into sweep_findings (app_id, page_url, kind, evidence, fingerprint)
       values ($1, $2, $3, $4, $5)
       on conflict (app_id, fingerprint) do update set
         consecutive_count = case when sweep_findings.status = 'open' then sweep_findings.consecutive_count + 1 else 1 end,
         evidence = excluded.evidence,
         status = 'open',
         last_seen = now()`,
      [appId, f.pageUrl, f.kind, f.evidence, fp]);
  }

  // Anything open that wasn't seen this sweep is resolved (and its streak dies)
  if (seen.length > 0) {
    await pool.query(
      `update sweep_findings set status = 'resolved' where app_id = $1 and status = 'open' and not (fingerprint = any($2))`,
      [appId, seen]);
  } else {
    await pool.query(`update sweep_findings set status = 'resolved' where app_id = $1 and status = 'open'`, [appId]);
  }

  return sweepId;
}

export interface ConfirmedFinding { pageUrl: string; kind: FindingKind; evidence: string; firstSeen: Date; }

/** Spec §6: only findings present in ≥2 consecutive sweeps are user-visible. */
export async function confirmedFindings(appId: string): Promise<ConfirmedFinding[]> {
  const { rows } = await getPool().query<{ page_url: string; kind: FindingKind; evidence: string; first_seen: Date }>(
    `select page_url, kind, evidence, first_seen from sweep_findings
     where app_id = $1 and status = 'open' and consecutive_count >= 2
     order by first_seen`, [appId]);
  return rows.map((r) => ({ pageUrl: r.page_url, kind: r.kind, evidence: r.evidence, firstSeen: r.first_seen }));
}
