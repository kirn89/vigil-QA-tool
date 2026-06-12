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
}

export async function teardown(): Promise<void> {
  await pg?.stop();
  await rm(DATA_DIR, { recursive: true, force: true });
}
