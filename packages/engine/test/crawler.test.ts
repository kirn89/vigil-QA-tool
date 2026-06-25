import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { isUnsafeHref, sweepSite } from '../src/sweep/crawler.js';

let server: Server;
let url: string;

beforeAll(async () => ({ server, url } = await startFixture()));
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(async () => { await fetch(`${url}/__reset`, { method: 'POST' }); });

describe('isUnsafeHref', () => {
  it('blocks logout/signout/destructive-looking links', () => {
    for (const href of ['/logout', '/auth/sign-out', '/signout?next=/', '/items/3/delete', '/remove?id=9', '/account/destroy', '/posts/7?action=delete']) {
      expect(isUnsafeHref(href), href).toBe(true);
    }
  });
  it('allows normal links', () => {
    for (const href of ['/about', '/items', '/blog/deleted-scenes', '/sign-in', '/login', '/archives-of-history']) {
      expect(isUnsafeHref(href), href).toBe(false);
    }
  });
});

describe('sweepSite', () => {
  it('visits same-origin pages and reports none broken on a healthy site', async () => {
    const result = await sweepSite({ baseUrl: url, maxPages: 20 });
    expect(result.pages.length).toBeGreaterThanOrEqual(4); // home, login, contact, about
    expect(result.findings).toEqual([]);
  });

  it('reports a dead link when nav points at a 404', async () => {
    await fetch(`${url}/__break?feature=nav-link`, { method: 'POST' });
    const result = await sweepSite({ baseUrl: url, maxPages: 20 });
    const dead = result.findings.find((f) => f.kind === 'dead_link');
    expect(dead?.pageUrl).toContain('/gone');
  });

  it('reports console errors', async () => {
    await fetch(`${url}/__break?feature=console-error`, { method: 'POST' });
    const result = await sweepSite({ baseUrl: url, maxPages: 20 });
    const err = result.findings.find((f) => f.kind === 'console_error');
    expect(err?.evidence).toContain('boom from fixture');
  });

  it('reports broken images', async () => {
    await fetch(`${url}/__break?feature=about-image`, { method: 'POST' });
    const result = await sweepSite({ baseUrl: url, maxPages: 20 });
    const img = result.findings.find((f) => f.kind === 'broken_image');
    expect(img?.evidence).toContain('missing.png');
  });

  it('reports pages that render no meaningful content', async () => {
    // /blank is only linked post-login; crawl it directly via extraSeeds
    const result = await sweepSite({ baseUrl: url, maxPages: 20, extraSeeds: ['/blank'] });
    const blank = result.findings.find((f) => f.kind === 'unrendered' && f.pageUrl.endsWith('/blank'));
    expect(blank).toBeTruthy();
  });

  it('does not flag a client-rendered (SPA) page that hydrates after load as unrendered', async () => {
    // /hydrate is empty at the `load` event and fills in ~150ms later via script.
    // Without waiting for hydration the crawler false-alarms (the scholarai/settlenepal
    // auth pages did exactly this). It must give the client a moment to render.
    const result = await sweepSite({ baseUrl: url, maxPages: 20, extraSeeds: ['/hydrate'] });
    const falseAlarm = result.findings.find((f) => f.kind === 'unrendered' && f.pageUrl.endsWith('/hydrate'));
    expect(falseAlarm).toBeFalsy();
  });

  it('respects the page cap', async () => {
    const result = await sweepSite({ baseUrl: url, maxPages: 2 });
    expect(result.pages.length).toBeLessThanOrEqual(2);
  });

  it('without navDiscovery, misses a page reachable only by clicking a nav button', async () => {
    const result = await sweepSite({ baseUrl: url, maxPages: 30 });
    expect(result.pages.some((p) => p.url.endsWith('/app'))).toBe(true);          // reached via <a href>
    expect(result.pages.some((p) => p.url.endsWith('/app/inside'))).toBe(false);  // button-only, missed
  });

  it('with navDiscovery, reaches the button-only page but never clicks destructive or submit controls', async () => {
    const result = await sweepSite({ baseUrl: url, maxPages: 30, navDiscovery: true });
    // capability: the inbox page, reachable only by clicking "Open inbox", is now swept
    expect(result.pages.some((p) => p.url.endsWith('/app/inside'))).toBe(true);
    // the no-id "Open settings" button is reached via the :nth-match fallback selector
    expect(result.pages.some((p) => p.url.endsWith('/app/extra'))).toBe(true);
    // safety: the "Delete account" button (destructive label) was never clicked
    expect(result.pages.some((p) => p.url.endsWith('/app/deleted'))).toBe(false);
    // safety: the form submit ("Send message") was never triggered
    const { hits } = await (await fetch(`${url}/__submit-hits`)).json();
    expect(hits).toBe(0);
  });

  it('captures interaction signals per page (form/inputs/password/buttons)', async () => {
    const result = await sweepSite({ baseUrl: url, maxPages: 20 });
    const login = result.pages.find((p) => p.url.endsWith('/login'))!;
    expect(login.signals?.hasForm).toBe(true);
    expect(login.signals?.inputCount).toBeGreaterThanOrEqual(2);
    expect(login.signals?.hasPasswordField).toBe(true);
    expect(login.signals?.actionButtonCount).toBeGreaterThanOrEqual(1);
    const about = result.pages.find((p) => p.url.endsWith('/about'))!;
    expect(about.signals?.hasForm).toBe(false);
  });
});
