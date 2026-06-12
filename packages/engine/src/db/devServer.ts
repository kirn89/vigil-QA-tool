import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';

const DATA_DIR = '.pgdata';

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: 'postgres',
  password: 'postgres',
  port: 54329,
  persistent: true,
});

const firstRun = !existsSync(`${DATA_DIR}/PG_VERSION`);
if (firstRun) await pg.initialise();
await pg.start();
console.log('Postgres running on 127.0.0.1:54329 (data: .pgdata). Ctrl-C to stop.');

process.on('SIGINT', () => {
  void pg.stop().then(() => process.exit(0));
});
