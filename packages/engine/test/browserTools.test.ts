import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startFixture } from '@vigil/fixture-app';
import { MapSession } from '../src/map/browserTools.js';

let server: Server;
let url: string;
let session: MapSession;

beforeAll(async () => ({ server, url } = await startFixture()));
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(async () => { await fetch(`${url}/__reset`, { method: 'POST' }); });

describe('MapSession', () => {
  it('navigates and reports state (path + headings)', async () => {
    session = new MapSession(url);
    await session.start();
    try {
      const state = await session.navigate('/login');
      expect(state).toContain('url=/login');
      expect(state).toContain('Sign in');
    } finally { await session.close(); }
  });

  it('snapshots interactive elements with durable selectors', async () => {
    session = new MapSession(url);
    await session.start();
    try {
      await session.navigate('/login');
      const entries = await session.snapshot();
      const email = entries.find((e) => e.selector === '#email');
      const pwd = entries.find((e) => e.selector === '#password');
      const submit = entries.find((e) => e.role === 'button' && /sign in/i.test(e.name));
      expect(email).toBeTruthy();
      expect(pwd).toBeTruthy();
      expect(submit).toBeTruthy();
      expect(email!.ref).toMatch(/^e\d+$/);
    } finally { await session.close(); }
  });

  it('drives a login by ref and reaches the dashboard', async () => {
    session = new MapSession(url);
    await session.start();
    try {
      await session.navigate('/login');
      const entries = await session.snapshot();
      const email = entries.find((e) => e.selector === '#email')!;
      const pwd = entries.find((e) => e.selector === '#password')!;
      const submit = entries.find((e) => e.role === 'button')!;
      await session.fill(email.ref, 'demo@example.com');
      await session.fill(pwd.ref, 'demo-pass');
      await session.click(submit.ref);
      const state = await session.readState();
      expect(state).toContain('url=/dashboard');
    } finally { await session.close(); }
  });

  it('omits destructive links from the snapshot and rejects unknown refs', async () => {
    session = new MapSession(url);
    await session.start();
    try {
      await session.navigate('/');
      await session.snapshot();
      await expect(session.click('e999')).rejects.toThrow(/unknown ref/i);
    } finally { await session.close(); }
  });

  it('selects a native dropdown option by ref', async () => {
    session = new MapSession(url);
    await session.start();
    try {
      await session.navigate('/onboarding');
      const entries = await session.snapshot();
      const country = entries.find((e) => e.selector === 'select[name="country"]')!;
      await session.select(country.ref, 'IN');
      const result = await session.readState();
      expect(await session.textOf('#result')).toContain('India');
      expect(result).toContain('url=/onboarding');
    } finally { await session.close(); }
  });
});
