import { chromium, type Page } from 'playwright';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { interpolate, type GoldenPath, type InterpolationContext, type Step } from '../flows/goldenPath.js';

export const VIGIL_USER_AGENT = 'Vigil-Check/0.1 (synthetic monitor; +https://vigil.invalid)';

export interface StepResult {
  stepId: string;
  status: 'ok' | 'failed';
  error?: string;
  screenshot?: string;
  durationMs: number;
}

export interface FlowAttempt {
  outcome: 'completed' | 'failed_step' | 'crashed';
  failedStepId?: string;
  steps: StepResult[];
  consoleErrors: string[];
  error?: string;
}

export interface ReplayOptions {
  baseUrl: string;
  credentials?: { email: string; password: string };
  artifactsDir: string;
  runId: string;
  stepTimeoutMs?: number;
}

async function executeStep(page: Page, step: Step, opts: ReplayOptions, ctx: InterpolationContext, timeout: number): Promise<void> {
  const a = step.action;
  switch (a.kind) {
    case 'goto':
      await page.goto(new URL(a.path, opts.baseUrl).href, { waitUntil: 'load', timeout });
      break;
    case 'click':
      await page.locator(a.selector).first().click({ timeout });
      break;
    case 'fill':
      await page.locator(a.selector).first().fill(interpolate(a.value, ctx), { timeout });
      break;
    case 'expect_text':
      await page.getByText(a.text).first().waitFor({ state: 'visible', timeout });
      break;
    case 'expect_url':
      await page.waitForURL(new RegExp(a.pattern), { timeout });
      break;
  }
}

/** Executes steps on an existing page. Shared by replayFlow and the sweep's login warm-up. */
export async function performSteps(
  page: Page, flow: GoldenPath, opts: ReplayOptions,
): Promise<{ steps: StepResult[]; failedStepId?: string }> {
  const timeout = opts.stepTimeoutMs ?? 15_000;
  const ctx: InterpolationContext = { ...opts.credentials, runId: opts.runId };
  const results: StepResult[] = [];
  await mkdir(opts.artifactsDir, { recursive: true });

  for (const step of flow.steps) {
    const started = Date.now();
    const screenshot = join(opts.artifactsDir, `${flow.name}-${opts.runId}-${step.id}.png`);
    try {
      await executeStep(page, step, opts, ctx, timeout);
      await page.screenshot({ path: screenshot }).catch(() => undefined);
      results.push({ stepId: step.id, status: 'ok', screenshot, durationMs: Date.now() - started });
    } catch (err) {
      await page.screenshot({ path: screenshot }).catch(() => undefined);
      results.push({
        stepId: step.id, status: 'failed', screenshot,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      });
      return { steps: results, failedStepId: step.id };
    }
  }
  return { steps: results };
}

export async function replayFlow(flow: GoldenPath, opts: ReplayOptions): Promise<FlowAttempt> {
  const consoleErrors: string[] = [];
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ userAgent: VIGIL_USER_AGENT });
    const page = await context.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    const { steps, failedStepId } = await performSteps(page, flow, opts);
    return failedStepId
      ? { outcome: 'failed_step', failedStepId, steps, consoleErrors }
      : { outcome: 'completed', steps, consoleErrors };
  } catch (err) {
    return {
      outcome: 'crashed', steps: [], consoleErrors,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
