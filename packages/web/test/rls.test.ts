// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { applyRls } from '../scripts/apply-rls.js';

const CONN = process.env.DATABASE_URL;
const ssl = (process.env.DATABASE_SSL ?? '').toLowerCase();
const pool = CONN ? new pg.Pool({ connectionString: CONN, ssl: ssl === 'true' || ssl === 'require' ? { rejectUnauthorized: false } : undefined }) : undefined;

async function hasAuthSchema(): Promise<boolean> {
  if (!pool) return false;
  const { rows } = await pool.query("select 1 from information_schema.routines where routine_schema='auth' and routine_name='uid'");
  return rows.length > 0;
}

let enabled = false;

beforeAll(async () => {
  if (!pool) return;
  enabled = await hasAuthSchema();
  if (enabled) await applyRls(CONN!);
});
afterAll(async () => { await pool?.end(); });

// Seed two owners with one app each; assert each authenticated user sees only their own app.
describe('RLS isolation', () => {
  it('an authenticated user reads only their own apps', async (ctx) => {
    if (!enabled) { ctx.skip(); return; }
    const a = randomUUID(), b = randomUUID();
    const c = await pool!.connect();
    try {
      // Seed via service-role connection (bypasses RLS).
      await c.query("insert into users (id, email, auth_id) values (gen_random_uuid(), $1, $2)", [`a-${a}@t.test`, a]);
      await c.query("insert into users (id, email, auth_id) values (gen_random_uuid(), $1, $2)", [`b-${b}@t.test`, b]);
      const { rows: ua } = await c.query("select id from users where auth_id=$1", [a]);
      const { rows: ub } = await c.query("select id from users where auth_id=$1", [b]);
      await c.query("insert into apps (user_id, name, production_url) values ($1,$2,$3)", [ua[0].id, `appA-${a}`, 'https://a.test']);
      await c.query("insert into apps (user_id, name, production_url) values ($1,$2,$3)", [ub[0].id, `appB-${b}`, 'https://b.test']);

      // As authenticated user A:
      await c.query('begin');
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: a, role: 'authenticated' })]);
      const { rows: visible } = await c.query('select name from apps');
      await c.query('rollback');

      const names = visible.map((r) => r.name);
      expect(names).toContain(`appA-${a}`);
      expect(names).not.toContain(`appB-${b}`);
    } finally {
      // cleanup (service role)
      await c.query("delete from apps where name like $1 or name like $2", [`appA-%`, `appB-%`]).catch(() => {});
      await c.query("delete from users where email like '%@t.test'").catch(() => {});
      c.release();
    }
  });
});
