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

  it('an authenticated user can insert/select jobs only for their own app', async (ctx) => {
    if (!enabled) { ctx.skip(); return; }
    const a = randomUUID(), b = randomUUID();
    const c = await pool!.connect();
    try {
      await c.query("insert into users (id, email, auth_id) values (gen_random_uuid(), $1, $2)", [`a-${a}@t.test`, a]);
      await c.query("insert into users (id, email, auth_id) values (gen_random_uuid(), $1, $2)", [`b-${b}@t.test`, b]);
      const { rows: ua } = await c.query("select id from users where auth_id=$1", [a]);
      const { rows: ub } = await c.query("select id from users where auth_id=$1", [b]);
      await c.query("insert into apps (user_id, name, production_url) values ($1,$2,$3)", [ua[0].id, `appA-${a}`, 'https://a.test']);
      await c.query("insert into apps (user_id, name, production_url) values ($1,$2,$3)", [ub[0].id, `appB-${b}`, 'https://b.test']);
      const { rows: appA } = await c.query("select id from apps where name=$1", [`appA-${a}`]);
      const { rows: appB } = await c.query("select id from apps where name=$1", [`appB-${b}`]);
      // B's job seeded via service role:
      await c.query("insert into jobs (app_id, type) values ($1,'check_now')", [appB[0].id]);

      await c.query('begin');
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: a, role: 'authenticated' })]);
      // A can insert a job for A's app
      await c.query("insert into jobs (app_id, type) values ($1,'check_now')", [appA[0].id]);
      // A cannot insert for B's app
      let blocked = false;
      try { await c.query("insert into jobs (app_id, type) values ($1,'check_now')", [appB[0].id]); }
      catch { blocked = true; }
      // A sees only A's jobs
      const { rows: visible } = await c.query('select j.id, a.name from jobs j join apps a on a.id=j.app_id');
      await c.query('rollback');

      expect(blocked).toBe(true);
      expect(visible.map((r) => r.name)).toContain(`appA-${a}`);
      expect(visible.map((r) => r.name)).not.toContain(`appB-${b}`);
    } finally {
      await c.query("delete from apps where name like 'appA-%' or name like 'appB-%'").catch(() => {});
      await c.query("delete from users where email like '%@t.test'").catch(() => {});
      c.release();
    }
  });
});
