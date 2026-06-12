import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { sweepSite } from '../src/sweep/crawler.js';

let server: Server;
let url: string;

beforeAll(async () => ({ server, url } = await startFixture()));
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(async () => { await fetch(`${url}/__reset`, { method: 'POST' }); });

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

  it('respects the page cap', async () => {
    const result = await sweepSite({ baseUrl: url, maxPages: 2 });
    expect(result.pages.length).toBeLessThanOrEqual(2);
  });
});
