import EmbeddedPostgres from 'embedded-postgres';
import { rm } from 'node:fs/promises';

const DATA_DIR = '.pgdata-test';
let pg: EmbeddedPostgres | undefined;

export async function setup(): Promise<void> {
  await rm(DATA_DIR, { recursive: true, force: true });
  pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: 'postgres',
    port: 54329,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  // Pin the test DB to the embedded instance regardless of the ambient .env, so a
  // developer .env that points DATABASE_URL at a remote (e.g. Supabase) can never be
  // truncated by the suite's beforeEach hooks. SSL off — embedded PG has none.
  // Set (don't delete) both: dotenv in env.ts skips keys already present, so setting
  // them here makes the embedded values win over a remote .env. Deleting DATABASE_SSL
  // would let dotenv re-set it to the .env value (SSL on) and break embedded PG.
  process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:54329/postgres';
  process.env.DATABASE_SSL = 'false';
}

export async function teardown(): Promise<void> {
  await pg?.stop();
  await rm(DATA_DIR, { recursive: true, force: true });
}
