import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { goldenPathSchema } from '../src/flows/goldenPath.js';
import { sweepSite } from '../src/sweep/crawler.js';

let server: Server;
let url: string;
beforeAll(async () => ({ server, url } = await startFixture()));
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(async () => { await fetch(`${url}/__reset`, { method: 'POST' }); });

const loginFlow = goldenPathSchema.parse({
  name: 'login',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/login' } },
    { id: 's2', action: { kind: 'fill', selector: 'input[name=email]', value: '{{email}}', description: 'email' } },
    { id: 's3', action: { kind: 'fill', selector: 'input[name=password]', value: '{{password}}', description: 'password' } },
    { id: 's4', action: { kind: 'click', selector: 'button[type=submit]', description: 'Sign in' } },
    { id: 's5', action: { kind: 'expect_url', pattern: '/dashboard$' } },
  ],
});
const creds = { email: 'demo@example.com', password: 'demo-pass' };

describe('sweep seeds from the post-login landing page', () => {
  it('reaches /dashboard and /items (only linked once logged in)', async () => {
    const result = await sweepSite({ baseUrl: url, maxPages: 30, loginFlow, credentials: creds });
    const paths = result.pages.map((p) => new URL(p.url).pathname);
    expect(paths).toContain('/dashboard');
    expect(paths).toContain('/items');
  });
});
