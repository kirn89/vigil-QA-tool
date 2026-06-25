import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

beforeAll(async () => { await migrate(); });
afterAll(async () => { await closePool(); });

describe('migration 003', () => {
  it('adds sweep_pages.signals and the journey_candidates table', async () => {
    const { rows: cols } = await getPool().query(
      `select column_name from information_schema.columns where table_name = 'sweep_pages' and column_name = 'signals'`);
    expect(cols).toHaveLength(1);
    const { rows: tbl } = await getPool().query(
      `select table_name from information_schema.tables where table_name = 'journey_candidates'`);
    expect(tbl).toHaveLength(1);
  });
});
