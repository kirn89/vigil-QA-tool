import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { cmdAppAdd, cmdFlowAdd, cmdCheck, cmdSweep, cmdReport } from '../src/cli.js';

let server: Server;
let url: string;
let dir: string;

beforeAll(async () => {
  await migrate();
  ({ server, url } = await startFixture());
  dir = await mkdtemp(join(tmpdir(), 'vigil-cli-'));
});
afterAll(async () => {
  await closePool();
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings cascade');
  await fetch(`${url}/__reset`, { method: 'POST' });
});

const loginFlowJson = {
  name: 'login',
  steps: [
    { id: 's1', action: { kind: 'goto', path: '/login' } },
    { id: 's2', action: { kind: 'fill', selector: 'input[name=email]', value: '{{email}}', description: 'email' } },
    { id: 's3', action: { kind: 'fill', selector: 'input[name=password]', value: '{{password}}', description: 'password' } },
    { id: 's4', action: { kind: 'click', selector: 'button[type=submit]', description: 'Sign in' } },
    { id: 's5', action: { kind: 'expect_url', pattern: '/dashboard$' } },
  ],
};

async function setupApp(): Promise<void> {
  await cmdAppAdd({ name: 'demo', url, loginEmail: 'demo@example.com', loginPassword: 'demo-pass' });
  const flowFile = join(dir, 'login.json');
  await writeFile(flowFile, JSON.stringify(loginFlowJson));
  await cmdFlowAdd('demo', flowFile);
}

describe('vigil CLI', () => {
  it('check reports PASS on a healthy app and exits 0', async () => {
    await setupApp();
    const { exitCode, lines } = await cmdCheck('demo', { retries: 1, stepTimeoutMs: 5_000 });
    expect(exitCode).toBe(0);
    expect(lines.join('\n')).toContain('login');
    expect(lines.join('\n')).toContain('PASS');
  });

  it('check reports BROKEN with the failed step and exits 1 when the app breaks', async () => {
    await setupApp();
    await fetch(`${url}/__break?feature=login-redirect`, { method: 'POST' });
    const { exitCode, lines } = await cmdCheck('demo', { retries: 2, stepTimeoutMs: 3_000 });
    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain('BROKEN');
    expect(lines.join('\n')).toContain('s5');
  });

  it('sweep + report surfaces a confirmed dead link after two sweeps', async () => {
    await setupApp();
    await fetch(`${url}/__break?feature=nav-link`, { method: 'POST' });
    await cmdSweep('demo');
    await cmdSweep('demo');
    const { lines } = await cmdReport('demo');
    expect(lines.join('\n')).toContain('dead_link');
    expect(lines.join('\n')).toContain('/gone');
  });

  it('refuses deep nav-discovery for an unsafe-listed app (settlenepal)', async () => {
    // app named "settlenepal" must never have nav-discovery enabled, even with --deep
    await cmdAppAdd({ name: 'settlenepal', url: 'http://127.0.0.1:4999', loginEmail: 'x@y.z', loginPassword: 'p' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await cmdSweep('settlenepal', { deep: true });
    expect(warn.mock.calls.flat().join(' ')).toMatch(/deep nav-discovery disabled/i);
    warn.mockRestore();
  });
});
