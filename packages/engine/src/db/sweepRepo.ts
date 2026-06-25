import { createHash } from 'node:crypto';
import { getPool } from './pool.js';
import type { FindingKind, PageSignals, SweepFinding, SweepResult } from '../sweep/crawler.js';

const SLOW_FLOOR_MS = 3_000;
const SLOW_FACTOR = 3;
const HISTORY_SWEEPS = 7;

/** Strip volatile bits from finding evidence so the SAME logical error hashes
 *  identically across sweeps. Vibe-coded SPAs (Next.js/v0) re-hash their webpack
 *  chunk filenames and shift line:col on every deploy, so an un-normalized
 *  fingerprint changes each sweep and the two-sweep confirmation gate never fires
 *  for a persistent error. We keep the human-readable message (which actually
 *  differentiates errors) and drop only the rotating chunk hash + line:col. The
 *  full, un-normalized evidence is still stored for the user to see. */
function normalizeEvidence(evidence: string): string {
  return evidence
    .replace(/chunks\/[^/\s:]+\.js/gi, 'chunks/_.js') // hashed webpack chunk filename
    .replace(/:\d+:\d+/g, '')                          // stack-frame line:col
    .trim()
    .slice(0, 200);
}

function fingerprint(f: SweepFinding): string {
  // Normalize evidence so the same logical finding hashes identically across sweeps
  const evidenceKey = f.kind === 'slow' ? '' : normalizeEvidence(f.evidence);
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
      'insert into sweep_pages (sweep_id, url, http_status, load_ms, signals) values ($1, $2, $3, $4, $5) on conflict do nothing',
      [sweepId, p.url, p.httpStatus, p.loadMs, JSON.stringify(p.signals ?? {})]);
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

  // Dedupe by fingerprint: a finding repeated within ONE sweep must count once,
  // or the on-conflict increment would fake a two-sweep confirmation (spec §6)
  const unique = new Map<string, SweepFinding>();
  for (const f of findings) unique.set(fingerprint(f), f);

  const seen: string[] = [];
  for (const [fp, f] of unique) {
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

export interface ClassifiablePage { url: string; httpStatus: number; signals: PageSignals; }

/** Pages from the app's most recent sweep, with interaction signals normalized
 *  to a full PageSignals (older rows stored '{}'). Used by the journey classifier. */
export async function latestSweepPages(appId: string): Promise<ClassifiablePage[]> {
  const { rows } = await getPool().query<{ url: string; http_status: number; signals: Partial<PageSignals> }>(
    `select sp.url, sp.http_status, sp.signals from sweep_pages sp
     join sweeps s on s.id = sp.sweep_id
     where s.app_id = $1 and s.id = (select id from sweeps where app_id = $1 order by started_at desc limit 1)`,
    [appId]);
  return rows.map((r) => ({
    url: r.url,
    httpStatus: r.http_status,
    signals: {
      hasForm: !!r.signals.hasForm,
      inputCount: r.signals.inputCount ?? 0,
      actionButtonCount: r.signals.actionButtonCount ?? 0,
      hasPasswordField: !!r.signals.hasPasswordField,
    },
  }));
}
