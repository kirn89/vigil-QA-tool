import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startFixture } from '../src/server.js';

let server: Server;
let url: string;

beforeAll(async () => ({ server, url } = await startFixture()));
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(async () => { await fetch(`${url}/__reset`, { method: 'POST' }); });

async function login(): Promise<Response> {
  return fetch(`${url}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'email=demo%40example.com&password=demo-pass',
    redirect: 'manual',
  });
}

describe('fixture app', () => {
  it('serves the home page with nav links', async () => {
    const html = await (await fetch(url)).text();
    expect(html).toContain('Demo App');
    expect(html).toContain('href="/about"');
  });

  it('login redirects to /dashboard on good credentials', async () => {
    const res = await login();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/dashboard');
  });

  it('breaking login-redirect sends users to /blank instead', async () => {
    await fetch(`${url}/__break?feature=login-redirect`, { method: 'POST' });
    expect((await login()).headers.get('location')).toBe('/blank');
  });

  it('breaking about-image serves a missing image reference', async () => {
    await fetch(`${url}/__break?feature=about-image`, { method: 'POST' });
    expect(await (await fetch(`${url}/about`)).text()).toContain('/missing.png');
  });

  it('breaking nav-link points home nav at a 404', async () => {
    await fetch(`${url}/__break?feature=nav-link`, { method: 'POST' });
    expect(await (await fetch(url)).text()).toContain('href="/gone"');
    expect((await fetch(`${url}/gone`)).status).toBe(404);
  });

  it('breaking items-create makes item creation 500', async () => {
    await fetch(`${url}/__break?feature=items-create`, { method: 'POST' });
    const res = await fetch(`${url}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'name=Widget',
    });
    expect(res.status).toBe(500);
  });
});
