import { chromium, type Browser, type Page } from 'playwright';
import { VIGIL_USER_AGENT } from '../replay/executor.js';
import { isUnsafeHref } from '../sweep/crawler.js';

export interface SnapshotEntry {
  ref: string;
  role: string;
  name: string;
  selector: string;
}

interface RawEntry extends SnapshotEntry { href: string | null; }

/** A live browser the map agent drives. Tools are intentionally narrow: navigate,
 *  snapshot (accessibility-ish view with durable selectors), click/fill/select by ref,
 *  read_state. Destructive links are filtered out of snapshots, and clicks are limited
 *  to refs from the latest snapshot — so the agent cannot fire a control we withheld. */
export class MapSession {
  private browser: Browser | undefined;
  private page!: Page;
  private lastRefs = new Set<string>();

  constructor(private readonly baseUrl: string) {}

  async start(): Promise<void> {
    this.browser = await chromium.launch();
    const context = await this.browser.newContext({ userAgent: VIGIL_USER_AGENT });
    this.page = await context.newPage();
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
  }

  async navigate(path: string): Promise<string> {
    await this.page.goto(new URL(path, this.baseUrl).href, { waitUntil: 'load', timeout: 20_000 });
    return this.readState();
  }

  async readState(): Promise<string> {
    const pathname = new URL(this.page.url()).pathname;
    const headings = await this.page.$$eval('h1,h2', (els) =>
      els.map((e) => (e.textContent ?? '').trim()).filter(Boolean).slice(0, 5));
    return `url=${pathname}\nheadings=${headings.join(' | ')}`;
  }

  async textOf(selector: string): Promise<string> {
    return (await this.page.locator(selector).first().textContent()) ?? '';
  }

  async snapshot(): Promise<SnapshotEntry[]> {
    const raw: RawEntry[] = await this.page.evaluate(() => {
      function durableSelector(el: Element): string {
        const tag = el.tagName.toLowerCase();
        if (el.id) return `#${el.id}`;
        const name = el.getAttribute('name');
        if (name) return `${tag}[name="${name}"]`;
        const type = el.getAttribute('type');
        if (tag === 'input' && type) return `input[type="${type}"]`;
        return tag;
      }
      const els = Array.from(document.querySelectorAll('a[href],button,input,select,textarea'));
      const out: Array<{ ref: string; role: string; name: string; selector: string; href: string | null }> = [];
      let n = 1;
      for (const el of els) {
        const tag = el.tagName.toLowerCase();
        const role = tag === 'a' ? 'link'
          : tag === 'button' ? 'button'
          : tag === 'select' ? 'select'
          : tag === 'textarea' ? 'textbox'
          : (el.getAttribute('type') ?? 'textbox');
        const name = ((el.textContent ?? '') || el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('name') || '').trim().slice(0, 40);
        const ref = `e${n++}`;
        el.setAttribute('data-vigil-ref', ref);
        out.push({ ref, role, name, selector: durableSelector(el), href: el.getAttribute('href') });
      }
      return out;
    });

    const safe = raw.filter((e) => !(e.role === 'link' && e.href && isUnsafeHref(e.href)));
    this.lastRefs = new Set(safe.map((e) => e.ref));
    return safe.map(({ ref, role, name, selector }) => ({ ref, role, name, selector }));
  }

  private locator(ref: string) {
    if (!this.lastRefs.has(ref)) throw new Error(`unknown ref "${ref}" — call snapshot first and use a returned ref`);
    return this.page.locator(`[data-vigil-ref="${ref}"]`).first();
  }

  async click(ref: string): Promise<string> {
    await this.locator(ref).click({ timeout: 15_000 });
    return this.readState();
  }

  async fill(ref: string, value: string): Promise<string> {
    await this.locator(ref).fill(value, { timeout: 15_000 });
    return this.readState();
  }

  async select(ref: string, value: string): Promise<string> {
    await this.locator(ref).selectOption(value, { timeout: 15_000 });
    return this.readState();
  }
}
