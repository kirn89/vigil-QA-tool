import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { goldenPathSchema } from '../src/flows/goldenPath.js';
import { replayFlow, VIGIL_USER_AGENT } from '../src/replay/executor.js';

let server: Server;
let url: string;
let artifactsDir: string;

beforeAll(async () => {
  ({ server, url } = await startFixture());
  artifactsDir = await mkdtemp(join(tmpdir(), 'vigil-'));
});
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
    { id: 's6', action: { kind: 'expect_text', text: 'Welcome back' } },
  ],
});

const creds = { email: 'demo@example.com', password: 'demo-pass' };

describe('replayFlow', () => {
  it('completes the login flow against a healthy app', async () => {
    const attempt = await replayFlow(loginFlow, { baseUrl: url, credentials: creds, artifactsDir, runId: 't1' });
    expect(attempt.outcome).toBe('completed');
    expect(attempt.steps).toHaveLength(6);
    expect(attempt.steps.every((s) => s.status === 'ok')).toBe(true);
    expect(attempt.steps[0]!.screenshot).toMatch(/\.png$/);
  });

  it('fails at the expect_url step when login redirect is broken', async () => {
    await fetch(`${url}/__break?feature=login-redirect`, { method: 'POST' });
    const attempt = await replayFlow(loginFlow, {
      baseUrl: url, credentials: creds, artifactsDir, runId: 't2', stepTimeoutMs: 3_000,
    });
    expect(attempt.outcome).toBe('failed_step');
    expect(attempt.failedStepId).toBe('s5');
    const failed = attempt.steps.find((s) => s.stepId === 's5');
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBeTruthy();
  });

  it('identifies itself with the Vigil user agent (spec §6 run hygiene)', async () => {
    const uaFlow = goldenPathSchema.parse({
      name: 'ua', steps: [
        { id: 'u1', action: { kind: 'goto', path: '/__echo-ua' } },
        { id: 'u2', action: { kind: 'expect_text', text: 'Vigil-Check' } },
      ],
    });
    const attempt = await replayFlow(uaFlow, { baseUrl: url, artifactsDir, runId: 't3' });
    expect(attempt.outcome).toBe('completed');
    expect(VIGIL_USER_AGENT).toContain('Vigil-Check');
  });

  it('collects console errors emitted by pages it visits', async () => {
    await fetch(`${url}/__break?feature=console-error`, { method: 'POST' });
    const homeFlow = goldenPathSchema.parse({
      name: 'home', steps: [
        { id: 'h1', action: { kind: 'goto', path: '/' } },
        { id: 'h2', action: { kind: 'expect_text', text: 'Demo App' } },
      ],
    });
    const attempt = await replayFlow(homeFlow, { baseUrl: url, artifactsDir, runId: 't4' });
    expect(attempt.consoleErrors.some((e) => e.includes('boom from fixture'))).toBe(true);
  });

  it('selects a native dropdown option and uploads a file', async () => {
    const uploadPath = join(artifactsDir, 'profile.pdf');
    await writeFile(uploadPath, 'pretend pdf bytes');
    const onboarding = goldenPathSchema.parse({
      name: 'onboarding',
      steps: [
        { id: 'o1', action: { kind: 'goto', path: '/onboarding' } },
        { id: 'o2', action: { kind: 'select', selector: 'select[name=country]', value: 'IN', description: 'country' } },
        { id: 'o3', action: { kind: 'upload', selector: 'input[name=document]', path: uploadPath, description: 'document' } },
        { id: 'o4', action: { kind: 'expect_text', text: 'country=India file=profile.pdf' } },
      ],
    });
    const attempt = await replayFlow(onboarding, { baseUrl: url, artifactsDir, runId: 't5' });
    expect(attempt.outcome).toBe('completed');
    expect(attempt.steps.every((s) => s.status === 'ok')).toBe(true);
  });
});
