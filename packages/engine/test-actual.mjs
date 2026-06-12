import { Command } from 'commander';
import { closePool } from './src/db/pool.js';

const program = new Command().name('vigil');
program.command('app:add')
  .requiredOption('--name <name>').requiredOption('--url <url>')
  .action(async (o) => { console.log('Action called'); });

program.hook('postAction', async () => { 
  console.log('postAction - closing pool');
  await closePool(); 
});

program.exitOverride();

program.parseAsync(process.argv.slice(2)).catch((e) => {
  console.log('Caught, exitCode:', e.exitCode);
  const exitCode = (e).exitCode;
  if (exitCode === 0) { process.exit(0); }
  if (e instanceof Error) { console.error(e.message); }
  process.exit(2);
});
