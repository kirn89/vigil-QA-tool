import { chromium, type ConsoleMessage, type Response } from 'playwright';
import { VIGIL_USER_AGENT, performSteps, type ReplayOptions } from '../replay/executor.js';
import type { GoldenPath } from '../flows/goldenPath.js';
import { isUnsafeLabel } from './navSafety.js';

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
  /** how long to let a client-rendered page hydrate before judging it (default 3s) */
  hydrationMs?: number;
  /** opt-in: also reach pages behind client-side button/route nav by clicking
   *  navigation-like controls to reveal their URL (default false — read-only/href-only) */
  navDiscovery?: boolean;
  /** cap on nav-click candidates probed per page when navDiscovery is on (default 12) */
  maxNavCandidatesPerPage?: number;
}

const UNSAFE_WORDS = ['logout', 'log-out', 'signout', 'sign-out', 'delete', 'remove', 'destroy', 'archive', 'cancel', 'unsubscribe'];

/** True when a link looks like it triggers a session-ending or destructive action.
 *  The sweep never follows these: GET endpoints with side effects are common in
 *  vibe-coded apps, and following /logout would silently turn the rest of a
 *  logged-in crawl into a logged-out one (spec §4.3.1: sweep is read-only). */
export function isUnsafeHref(href: string): boolean {
  let u: URL;
  try {
    u = new URL(href, 'http://placeholder.local');
  } catch {
    return true; // unparseable → don't follow
  }
  const segments = u.pathname.toLowerCase().split('/').filter(Boolean);
  const matchesWord = (s: string) =>
    UNSAFE_WORDS.some((w) => s === w || s.startsWith(`${w}-`) || s.startsWith(`${w}_`));
  if (segments.some(matchesWord)) return true;
  for (const [k, v] of u.searchParams) {
    if (UNSAFE_WORDS.includes(k.toLowerCase()) || UNSAFE_WORDS.includes(v.toLowerCase())) return true;
  }
  return false;
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

/** Give a client-rendered (SPA) page a moment to hydrate before we judge it.
 *  Many vibe-coded apps (Next.js/v0) serve an empty <body> at the `load` event
 *  and inject the real content client-side a beat later; checking immediately
 *  produces false `unrendered` alarms (false alarms are the top product risk).
 *  Resolves as soon as the page has meaningful content, or after the timeout
 *  (a genuinely blank page never gains content and is then correctly flagged). */
async function waitForHydration(page: import('playwright').Page, timeoutMs: number): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const text = (document.body?.innerText ?? '').trim().length;
        const structural = document.querySelectorAll('form, nav, main, article, section, [role="main"]').length;
        return text >= 30 || structural > 0;
      },
      undefined,
      { timeout: timeoutMs },
    )
    .catch(() => undefined);
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

interface NavCandidate { selector: string; label: string; }

/** Collect clickable controls that look like navigation (not actions). Excludes
 *  anything inside a <form>, any type=submit control, and any destructive label.
 *  Returns a durable selector (#id preferred) the isolated probe can re-locate. */
async function collectNavCandidates(page: import('playwright').Page, cap: number): Promise<NavCandidate[]> {
  const raw = await page.$$eval('button, [role="button"]', (els) =>
    els.map((el, i) => {
      // inForm is the backstop for <button> elements with no explicit type= (HTML defaults them to submit,
      // but getAttribute('type') returns null so isSubmit would be false); always exclude anything in a form.
      const inForm = !!el.closest('form');
      const isSubmit = (el.getAttribute('type') ?? '').toLowerCase() === 'submit';
      const id = el.getAttribute('id');
      const name = el.getAttribute('name');
      const label = ((el.textContent ?? '') || el.getAttribute('aria-label') || '').trim().slice(0, 60);
      let selector: string | null = null;
      if (id) selector = `#${CSS.escape(id)}`;
      else if (name) selector = `[name="${CSS.escape(name)}"]`;
      else if (label) selector = `:nth-match(button, [role="button"], ${i + 1})`; // deterministic position; avoids fuzzy/ambiguous text match
      return { selector, label, inForm, isSubmit };
    }),
  );
  const out: NavCandidate[] = [];
  for (const c of raw) {
    if (!c.selector || c.inForm || c.isSubmit || !c.label) continue;
    if (isUnsafeLabel(c.label)) continue;
    out.push({ selector: c.selector, label: c.label });
    if (out.length >= cap) break;
  }
  return out;
}

/** Click each candidate once in an ISOLATED page (re-navigating to the parent
 *  first), and collect any new same-origin, non-unsafe URL the click revealed.
 *  Clicking is used only to reveal a route — the page itself is swept later via goto. */
async function discoverNavTargets(
  context: import('playwright').BrowserContext,
  parentUrl: string,
  candidates: NavCandidate[],
  timeout: number,
): Promise<string[]> {
  const found: string[] = [];
  for (const c of candidates) {
    const probe = await context.newPage();
    try {
      await probe.goto(parentUrl, { waitUntil: 'load', timeout });
      const before = probe.url();
      await probe.click(c.selector, { timeout: 3_000 }).catch(() => undefined);
      await probe.waitForURL((u) => u.toString() !== before, { timeout: 2_000 }).catch(() => undefined);
      const after = probe.url();
      if (after !== before) {
        const n = normalize(after, parentUrl);
        if (n && !isUnsafeHref(n)) found.push(n);
      }
    } finally {
      await probe.close().catch(() => undefined);
    }
  }
  return found;
}

export async function sweepSite(opts: SweepOptions): Promise<SweepResult> {
  const maxPages = opts.maxPages ?? 200;
  const timeout = opts.pageTimeoutMs ?? 20_000;
  const hydrationMs = opts.hydrationMs ?? 3_000;
  const navDiscovery = opts.navDiscovery ?? false;
  const maxNavCandidates = opts.maxNavCandidatesPerPage ?? 12;
  const findings: SweepFinding[] = [];
  const pages: SweptPage[] = [];

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ userAgent: VIGIL_USER_AGENT });
    const page = await context.newPage();

    let postLoginUrl: string | undefined;
    if (opts.loginFlow) {
      const replayOpts: ReplayOptions = {
        baseUrl: opts.baseUrl, credentials: opts.credentials,
        artifactsDir: 'artifacts/sweep-login', runId: `sweep-${Date.now()}`,
      };
      await performSteps(page, opts.loginFlow, replayOpts);
      postLoginUrl = page.url();
    }

    const queue: string[] = [new URL(opts.baseUrl).href];
    for (const seed of opts.extraSeeds ?? []) {
      const n = normalize(seed, opts.baseUrl);
      if (n) queue.push(n);
    }
    if (postLoginUrl) {
      const n = normalize(postLoginUrl, opts.baseUrl);
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
          await waitForHydration(page, hydrationMs); // let SPAs render before judging
          for (const e of consoleErrors) findings.push({ pageUrl: current, kind: 'console_error', evidence: e });
          for (const f of failedRequests) findings.push({ pageUrl: current, kind: 'failed_request', evidence: f });
          const { brokenImages, unrendered } = await checkPage(page);
          for (const src of brokenImages) findings.push({ pageUrl: current, kind: 'broken_image', evidence: src });
          if (unrendered) findings.push({ pageUrl: current, kind: 'unrendered', evidence: 'no stylesheet or fewer than 30 chars of visible text' });

          // Only enqueue links (<a href>), never click anything — sweep is read-only (spec §4.3.1)
          const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')!));
          for (const href of hrefs) {
            const n = normalize(href, current);
            if (n && !visited.has(n) && !isUnsafeHref(n)) queue.push(n);
          }

          if (navDiscovery) {
            const candidates = await collectNavCandidates(page, maxNavCandidates);
            const revealed = await discoverNavTargets(context, current, candidates, timeout);
            for (const n of revealed) {
              if (!visited.has(n) && !isUnsafeHref(n)) queue.push(n);
            }
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
