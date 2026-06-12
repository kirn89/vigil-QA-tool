import { chromium, type ConsoleMessage, type Response } from 'playwright';
import { VIGIL_USER_AGENT, performSteps, type ReplayOptions } from '../replay/executor.js';
import type { GoldenPath } from '../flows/goldenPath.js';

export type FindingKind = 'dead_link' | 'console_error' | 'failed_request' | 'broken_image' | 'unrendered' | 'slow';

export interface SweepFinding { pageUrl: string; kind: FindingKind; evidence: string; }
export interface SweptPage { url: string; httpStatus: number; loadMs: number; }
export interface SweepResult { pages: SweptPage[]; findings: SweepFinding[]; }

export interface SweepOptions {
  baseUrl: string;
  maxPages?: number;
  /** paths seeded into the queue beyond the root (e.g. post-login pages) */
  extraSeeds?: string[];
  /** optional login warm-up executed before crawling (cookies persist in the context) */
  loginFlow?: GoldenPath;
  credentials?: { email: string; password: string };
  pageTimeoutMs?: number;
}

function normalize(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.origin !== new URL(base).origin) return null; // same-origin only
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

async function checkPage(page: import('playwright').Page): Promise<{ brokenImages: string[]; unrendered: boolean }> {
  return page.evaluate(() => {
    const brokenImages = Array.from(document.images)
      .filter((img) => img.complete && img.naturalWidth === 0 && !!img.getAttribute('src'))
      .map((img) => img.getAttribute('src')!);
    const hasStyles = document.styleSheets.length > 0;
    const textLength = (document.body?.innerText ?? '').trim().length;
    // Pages with interactive elements (forms, nav) or visible text >= 30 chars are considered rendered.
    const hasInteractiveContent =
      document.querySelectorAll('form, nav, main, article, section').length > 0;
    const unrendered = !hasStyles || (textLength < 30 && !hasInteractiveContent);
    return { brokenImages, unrendered };
  });
}

export async function sweepSite(opts: SweepOptions): Promise<SweepResult> {
  const maxPages = opts.maxPages ?? 200;
  const timeout = opts.pageTimeoutMs ?? 20_000;
  const findings: SweepFinding[] = [];
  const pages: SweptPage[] = [];

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ userAgent: VIGIL_USER_AGENT });
    const page = await context.newPage();

    if (opts.loginFlow) {
      const replayOpts: ReplayOptions = {
        baseUrl: opts.baseUrl, credentials: opts.credentials,
        artifactsDir: 'artifacts/sweep-login', runId: `sweep-${Date.now()}`,
      };
      await performSteps(page, opts.loginFlow, replayOpts);
    }

    const queue: string[] = [new URL(opts.baseUrl).href];
    for (const seed of opts.extraSeeds ?? []) {
      const n = normalize(seed, opts.baseUrl);
      if (n) queue.push(n);
    }
    const visited = new Set<string>();

    while (queue.length > 0 && visited.size < maxPages) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const consoleErrors: string[] = [];
      const failedRequests: string[] = [];
      const onConsole = (msg: ConsoleMessage) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); };
      const onPageError = (err: Error) => consoleErrors.push(err.message);
      const onResponse = (res: Response) => {
        if (res.status() >= 400 && res.url() !== current) failedRequests.push(`${res.status()} ${res.url()}`);
      };
      page.on('console', onConsole);
      page.on('pageerror', onPageError);
      page.on('response', onResponse);

      const started = Date.now();
      try {
        const response = await page.goto(current, { waitUntil: 'load', timeout });
        const loadMs = Date.now() - started;
        const status = response?.status() ?? 0;
        pages.push({ url: current, httpStatus: status, loadMs });

        if (status >= 400) {
          findings.push({ pageUrl: current, kind: 'dead_link', evidence: `HTTP ${status}` });
        } else {
          for (const e of consoleErrors) findings.push({ pageUrl: current, kind: 'console_error', evidence: e });
          for (const f of failedRequests) findings.push({ pageUrl: current, kind: 'failed_request', evidence: f });
          const { brokenImages, unrendered } = await checkPage(page);
          for (const src of brokenImages) findings.push({ pageUrl: current, kind: 'broken_image', evidence: src });
          if (unrendered) findings.push({ pageUrl: current, kind: 'unrendered', evidence: 'no stylesheet or fewer than 30 chars of visible text' });

          // Only enqueue links (<a href>), never click anything — sweep is read-only (spec §4.3.1)
          const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')!));
          for (const href of hrefs) {
            const n = normalize(href, current);
            if (n && !visited.has(n)) queue.push(n);
          }
        }
      } catch (err) {
        pages.push({ url: current, httpStatus: 0, loadMs: Date.now() - started });
        findings.push({ pageUrl: current, kind: 'dead_link', evidence: err instanceof Error ? err.message : String(err) });
      } finally {
        page.off('console', onConsole);
        page.off('pageerror', onPageError);
        page.off('response', onResponse);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  return { pages, findings };
}
