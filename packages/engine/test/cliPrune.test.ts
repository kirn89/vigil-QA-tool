import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, utimes, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdPruneScreenshots } from '../src/cli.js';

const SUPA = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SCREENSHOT_BUCKET'] as const;
let dir: string;
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vigil-prune-'));
  for (const k of SUPA) { saved[k] = process.env[k]; delete process.env[k]; } // force the local store
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  for (const k of SUPA) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('cmdPruneScreenshots', () => {
  it('prunes screenshots older than the cutoff from the local store and reports the count', async () => {
    await writeFile(join(dir, 'old.png'), 'x');
    await writeFile(join(dir, 'fresh.png'), 'y');
    const tenDaysAgo = Date.now() / 1000 - 10 * 86_400;
    await utimes(join(dir, 'old.png'), tenDaysAgo, tenDaysAgo);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await cmdPruneScreenshots({ days: 7, baseDir: dir });
    expect(log.mock.calls.flat().join(' ')).toMatch(/Pruned 1 screenshot/);
    log.mockRestore();

    expect(await readdir(dir)).toEqual(['fresh.png']);
  });
});
