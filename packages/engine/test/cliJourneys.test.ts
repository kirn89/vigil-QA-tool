import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, getAppByName } from '../src/db/appsRepo.js';
import { recordSweep } from '../src/db/sweepRepo.js';
import { listCandidates } from '../src/db/candidatesRepo.js';
import { cmdAppAdd, cmdJourneys } from '../src/cli.js';
import { FakeLLMClient, type LLMResponse } from '../src/map/llmClient.js';
import type { SweepResult } from '../src/sweep/crawler.js';

const FOUNDER = process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local';
beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings, journey_candidates cascade');
});

describe('cmdJourneys', () => {
  it('classifies the latest sweep and persists deep candidates', async () => {
    await cmdAppAdd({ name: 'demo', url: 'http://x.test' });
    const app = (await getAppByName(await ensureUser(FOUNDER), 'demo'))!;
    const sweep: SweepResult = {
      pages: [
        { url: 'http://x.test/login', httpStatus: 200, loadMs: 10, signals: { hasForm: true, inputCount: 2, actionButtonCount: 1, hasPasswordField: true } },
        { url: 'http://x.test/about', httpStatus: 200, loadMs: 8, signals: { hasForm: false, inputCount: 0, actionButtonCount: 0, hasPasswordField: false } },
      ],
      findings: [],
    };
    await recordSweep(app.id, sweep);

    const script: LLMResponse[] = [{
      stopReason: 'tool_use',
      content: [{
        type: 'tool_use', id: 't1', name: 'classify_journeys',
        input: { journeys: [
          { name: 'Login', entryUrl: 'http://x.test/login', depth: 'deep', recommended: true },
          { name: 'About', entryUrl: 'http://x.test/about', depth: 'shallow', recommended: false },
        ] },
      }],
    }];

    const { lines } = await cmdJourneys('demo', { client: new FakeLLMClient(script) });
    const all = await listCandidates(app.id);
    expect(all.map((c) => c.name)).toEqual(['Login']); // only deep persisted
    expect(lines.join('\n')).toContain('Login');
    expect(lines.join('\n')).toContain('★'); // recommended marker
  });

  it('throws when there is no sweep to classify', async () => {
    await cmdAppAdd({ name: 'empty', url: 'http://x.test' });
    await expect(cmdJourneys('empty', { client: new FakeLLMClient([]) })).rejects.toThrow(/sweep/i);
  });
});
