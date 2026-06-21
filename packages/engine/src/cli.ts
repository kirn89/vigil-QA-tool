import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureUser, createApp, getAppByName, type AppRecord } from './db/appsRepo.js';
import { addFlow, listConfirmedFlows, listProposedFlows, confirmFlow, deleteProposedFlows } from './db/flowsRepo.js';
import { goldenPathSchema } from './flows/goldenPath.js';
import { MapSession } from './map/browserTools.js';
import { mapApp } from './map/mapper.js';
import { verifyFlow } from './map/verify.js';
import { verifyWithCorrection } from './map/correct.js';
import { OpenRouterClient, type LLMClient } from './map/llmClient.js';
import { insertRun, latestVerdicts } from './db/runsRepo.js';
import { recordSweep, confirmedFindings } from './db/sweepRepo.js';
import { replayFlow } from './replay/executor.js';
import { runWithRetries } from './verdict/runWithRetries.js';
import { sweepSite } from './sweep/crawler.js';
import { closePool } from './db/pool.js';

const FOUNDER_EMAIL = process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local';

async function requireApp(name: string): Promise<AppRecord> {
  const userId = await ensureUser(FOUNDER_EMAIL);
  const app = await getAppByName(userId, name);
  if (!app) throw new Error(`No app named "${name}". Add it with: vigil app:add`);
  return app;
}

export async function cmdAppAdd(opts: {
  name: string; url: string; previewUrl?: string;
  loginEmail?: string; loginPassword?: string;
}): Promise<void> {
  const userId = await ensureUser(FOUNDER_EMAIL);
  const credentials = opts.loginEmail && opts.loginPassword
    ? { email: opts.loginEmail, password: opts.loginPassword }
    : null;
  await createApp({
    userId, name: opts.name, productionUrl: opts.url,
    previewUrl: opts.previewUrl ?? null, credentials,
  });
  console.log(`Added app "${opts.name}" → ${opts.url}`);
}

export async function cmdFlowAdd(appName: string, file: string): Promise<void> {
  const app = await requireApp(appName);
  const json = JSON.parse(await readFile(file, 'utf8'));
  const parsed = goldenPathSchema.parse(json);
  const { verified, note } = await verifyFlow(parsed, { baseUrl: app.productionUrl, credentials: app.credentials ?? undefined });
  if (verified) {
    await addFlow(app.id, parsed, 'confirmed', { verified: true, source: 'manual' });
    console.log(`Added & verified "${parsed.name}" (${parsed.steps.length} steps) — now watched.`);
  } else {
    await addFlow(app.id, parsed, 'proposed', { verified: false, verificationNote: note ?? null, source: 'manual' });
    console.log(`Added "${parsed.name}" as UNVERIFIED (${note}). Fix it, or confirm with --force if you're sure.`);
  }
}

export interface MapCliOptions { client?: LLMClient; maxSteps?: number; stepTimeoutMs?: number; }

export async function cmdFlowDescribe(appName: string, description: string, opts: MapCliOptions = {}): Promise<{ lines: string[] }> {
  const app = await requireApp(appName);
  const client = opts.client ?? new OpenRouterClient();
  const session = new MapSession(app.productionUrl);
  await session.start();
  let proposals;
  try {
    proposals = await mapApp(session, client, { credentials: app.credentials ?? undefined, maxSteps: opts.maxSteps, targetJourney: description });
  } finally {
    await session.close();
  }
  const lines: string[] = [`Described "${description}" → ${proposals.length} flow(s):`];
  for (const gp of proposals) {
    const { flow: finalFlow, verified, note } = await verifyWithCorrection(gp, client, {
      baseUrl: app.productionUrl, credentials: app.credentials ?? undefined, stepTimeoutMs: opts.stepTimeoutMs,
    });
    try {
      await addFlow(app.id, finalFlow, 'proposed', { verified, verificationNote: note ?? null, source: 'described' });
      lines.push(`  • ${finalFlow.name} — ${verified ? '✅ verified' : `⚠️ unverified (${note})`}`);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') lines.push(`  • ${finalFlow.name} — skipped (already exists)`);
      else throw e;
    }
  }
  for (const l of lines) console.log(l);
  return { lines };
}

export interface CheckOptions { preview?: boolean; retries?: number; stepTimeoutMs?: number; }

export async function cmdCheck(appName: string, opts: CheckOptions = {}): Promise<{ exitCode: number; lines: string[] }> {
  const app = await requireApp(appName);
  const baseUrl = opts.preview ? app.previewUrl : app.productionUrl;
  if (!baseUrl) throw new Error(`App "${appName}" has no ${opts.preview ? 'preview' : 'production'} URL`);
  const flows = await listConfirmedFlows(app.id);
  if (flows.length === 0) throw new Error(`App "${appName}" has no confirmed flows. Add one with: vigil flow:add`);

  const lines: string[] = [];
  let anyBroken = false;
  for (const flow of flows) {
    const started = Date.now();
    const runId = `${Date.now()}-${flow.goldenPath.name}`;
    const verdict = await runWithRetries(
      (attemptIndex) => replayFlow(flow.goldenPath, {
        baseUrl, credentials: app.credentials ?? undefined,
        artifactsDir: join('artifacts', runId), runId: `${runId}-a${attemptIndex}`,
        stepTimeoutMs: opts.stepTimeoutMs,
      }),
      { maxAttempts: opts.retries ?? 3, backoffMs: 2_000 },
    );
    await insertRun({
      flowId: flow.id, environment: opts.preview ? 'preview' : 'production',
      verdict: verdict.verdict, failedStepId: verdict.failedStepId ?? null,
      attempts: verdict.attempts, durationMs: Date.now() - started,
    });
    const mark = verdict.verdict === 'pass' ? '✅ PASS' : verdict.verdict === 'broken' ? '❌ BROKEN' : '⚠️ UNSURE';
    if (verdict.verdict === 'broken') anyBroken = true;
    lines.push(`${mark}  ${flow.goldenPath.name}${verdict.failedStepId ? `  (failed at step ${verdict.failedStepId})` : ''}`);
  }
  for (const l of lines) console.log(l);
  return { exitCode: anyBroken ? 1 : 0, lines };
}

export async function cmdSweep(appName: string): Promise<void> {
  const app = await requireApp(appName);
  const flows = await listConfirmedFlows(app.id);
  const loginFlow = flows.find((f) => f.goldenPath.name.toLowerCase() === 'login')?.goldenPath;
  const result = await sweepSite({
    baseUrl: app.productionUrl, maxPages: 200,
    loginFlow, credentials: app.credentials ?? undefined,
  });
  await recordSweep(app.id, result);
  console.log(`Swept ${result.pages.length} pages, ${result.findings.length} raw findings (confirmation needs 2 consecutive sweeps)`);
}

export async function cmdMap(appName: string, opts: MapCliOptions = {}): Promise<{ lines: string[] }> {
  const app = await requireApp(appName);
  const client = opts.client ?? new OpenRouterClient();
  const session = new MapSession(app.productionUrl);
  await session.start();
  let proposals: Awaited<ReturnType<typeof mapApp>>;
  try {
    proposals = await mapApp(session, client, { credentials: app.credentials ?? undefined, maxSteps: opts.maxSteps });
  } finally {
    await session.close();
  }
  await deleteProposedFlows(app.id);
  const lines: string[] = [`Mapped ${appName}: ${proposals.length} proposed flow(s).`];
  for (const gp of proposals) {
    const { flow: finalFlow, verified, note } = await verifyWithCorrection(gp, client, {
      baseUrl: app.productionUrl, credentials: app.credentials ?? undefined, stepTimeoutMs: opts.stepTimeoutMs,
    });
    try {
      await addFlow(app.id, finalFlow, 'proposed', { verified, verificationNote: note ?? null, source: 'mapped' });
      const mark = verified ? '✅ verified' : `⚠️ unverified (${note})`;
      lines.push(`  • ${finalFlow.name} (${finalFlow.steps.length} steps) — ${mark}`);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') lines.push(`  • ${finalFlow.name} — skipped (already exists on ${appName})`);
      else throw e;
    }
  }
  lines.push(`Confirm a verified flow with: vigil flow:confirm ${appName} "<name>"`);
  for (const l of lines) console.log(l);
  return { lines };
}

export async function cmdFlowConfirm(appName: string, flowName: string, opts: { force?: boolean } = {}): Promise<void> {
  const app = await requireApp(appName);
  const res = await confirmFlow(app.id, flowName, opts);
  console.log(res.ok ? `Confirmed "${flowName}" — it will now be watched.` : `Did not confirm "${flowName}": ${res.reason}`);
}

export async function cmdReport(appName: string): Promise<{ lines: string[] }> {
  const app = await requireApp(appName);
  const lines: string[] = [];
  lines.push(`# ${appName} — latest verdicts`);
  for (const v of await latestVerdicts(app.id)) {
    lines.push(`${v.verdict.toUpperCase().padEnd(7)} ${v.flowName}${v.failedStepId ? ` (step ${v.failedStepId})` : ''} — ${v.at.toISOString()}`);
  }
  lines.push(`# rest of your app (confirmed sweep findings)`);
  for (const f of await confirmedFindings(app.id)) {
    lines.push(`${f.kind}  ${f.pageUrl}  — ${f.evidence}`);
  }
  const proposed = await listProposedFlows(app.id);
  if (proposed.length) {
    lines.push(`# proposed flows (awaiting confirm)`);
    for (const f of proposed) {
      const mark = f.verified ? 'VERIFIED' : `UNVERIFIED (${f.verificationNote ?? 'replay failed'})`;
      lines.push(`PROPOSED ${f.goldenPath.name} — ${mark}`);
    }
  }
  for (const l of lines) console.log(l);
  return { lines };
}

// ---- commander wiring (only runs when invoked as a script) ----
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const program = new Command().name('vigil');
  program.command('app:add')
    .requiredOption('--name <name>').requiredOption('--url <url>')
    .option('--preview-url <url>').option('--login-email <email>').option('--login-password <password>')
    .action(async (o) => { await cmdAppAdd({ name: o.name, url: o.url, previewUrl: o.previewUrl, loginEmail: o.loginEmail, loginPassword: o.loginPassword }); });
  program.command('flow:add').argument('<app>').argument('<file>')
    .action(async (app, file) => { await cmdFlowAdd(app, file); });
  program.command('flow:describe').argument('<app>').argument('<description>')
    .action(async (app, description) => { await cmdFlowDescribe(app, description); });
  program.command('check').argument('<app>')
    .option('--preview')
    .option('--retries <n>', 'max attempts per flow', '3')
    .option('--step-timeout <ms>', 'per-step timeout in ms', '15000')
    .action(async (app, o) => {
      const { exitCode } = await cmdCheck(app, {
        preview: o.preview, retries: Number(o.retries), stepTimeoutMs: Number(o.stepTimeout),
      });
      process.exitCode = exitCode;
    });
  program.command('sweep').argument('<app>')
    .action(async (app) => { await cmdSweep(app); });
  program.command('map').argument('<app>')
    .action(async (app) => { await cmdMap(app); });
  program.command('flow:confirm').argument('<app>').argument('<flow>').option('--force')
    .action(async (app, flow, o) => { await cmdFlowConfirm(app, flow, { force: o.force }); });
  program.command('report').argument('<app>')
    .action(async (app) => { await cmdReport(app); });
  program.hook('postAction', async () => { await closePool(); });
  program.exitOverride();
  program.parseAsync().catch((e: unknown) => {
    const exitCode = (e as { exitCode?: number }).exitCode;
    if (exitCode === 0) { process.exit(0); } // --help / --version
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  });
}
