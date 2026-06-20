import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { goldenPathSchema } from '../src/flows/goldenPath.js';
import { verifyFlow } from '../src/map/verify.js';

let server: Server;
let url: string;
let artifactsDir: string;

beforeAll(async () => {
  ({ server, url } = await startFixture());
  artifactsDir = await mkdtemp(join(tmpdir(), 'vigil-verify-'));
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(async () => { await fetch(`${url}/__reset`, { method: 'POST' }); });

const creds = { email: 'demo@example.com', password: 'demo-pass' };
const goodLogin = goldenPathSchema.parse({
  name: 'login',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/login' } },
    { id: 's2', action: { kind: 'fill', selector: '#email', value: '{{email}}', description: 'email' } },
    { id: 's3', action: { kind: 'fill', selector: '#password', value: '{{password}}', description: 'password' } },
    { id: 's4', action: { kind: 'click', selector: 'button[type="submit"]', description: 'submit' } },
    { id: 's5', action: { kind: 'expect_url', pattern: '/dashboard$' } },
  ],
});
const hallucinated = goldenPathSchema.parse({
  name: 'contact',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/contact' } },
    { id: 's2', action: { kind: 'fill', selector: '#name', value: 'x', description: 'name (does not exist)' } },
  ],
});

describe('verifyFlow', () => {
  it('verifies a grounded flow (fresh-browser replay passes)', async () => {
    const r = await verifyFlow(goodLogin, { baseUrl: url, credentials: creds, artifactsDir, stepTimeoutMs: 6000 });
    expect(r.verified).toBe(true);
    expect(r.note).toBeUndefined();
  });

  it('flags a hallucinated flow with the failing step in the note', async () => {
    const r = await verifyFlow(hallucinated, { baseUrl: url, artifactsDir, stepTimeoutMs: 4000 });
    expect(r.verified).toBe(false);
    expect(r.note).toMatch(/s2/);
  });
});
