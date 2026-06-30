import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { ensureUser, createApp } from '../src/db/appsRepo.js';
import { enqueueJob, claimNextJob, finishJob, hasActiveJob } from '../src/db/jobsRepo.js';

let appId: string;
beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });
beforeEach(async () => {
  await getPool().query('truncate users, apps, flows, runs, sweeps, sweep_pages, sweep_findings, journey_candidates, jobs cascade');
  const userId = await ensureUser('founder@vigil.test');
  appId = (await createApp({ userId, name: 'demo', productionUrl: 'http://x.test', previewUrl: null, credentials: null })).id;
});

describe('jobsRepo', () => {
  it('enqueues, then claims exactly one queued job (oldest first) and marks it running', async () => {
    await enqueueJob(appId, 'check_now', 'production');
    const claimed = await claimNextJob();
    expect(claimed?.appId).toBe(appId);
    expect(claimed?.status).toBe('running');
    expect(claimed?.environment).toBe('production');
    // queue now empty
    expect(await claimNextJob()).toBeNull();
  });

  it('hasActiveJob is true while queued/running, false once finished', async () => {
    const id = await enqueueJob(appId, 'check_now', 'preview');
    expect(await hasActiveJob(appId)).toBe(true);   // queued
    await claimNextJob();
    expect(await hasActiveJob(appId)).toBe(true);   // running
    await finishJob(id, true);
    expect(await hasActiveJob(appId)).toBe(false);  // done
  });

  it('finishJob records failure with an error message', async () => {
    const id = await enqueueJob(appId, 'check_now', 'production');
    await claimNextJob();
    await finishJob(id, false, 'boom');
    const { rows } = await getPool().query('select status, error from jobs where id=$1', [id]);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error).toBe('boom');
  });
});
