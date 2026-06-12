import { Command } from 'commander';

const program = new Command().name('vigil');

program.command('app:add')
  .requiredOption('--name <name>').requiredOption('--url <url>')
  .action(async (o) => { console.log('Action called'); });

program.command('flow:add').argument('<app>').argument('<file>')
  .action(async (app, file) => { console.log('Flow add action'); });

program.hook('postAction', async () => { console.log('postAction'); });

program.exitOverride();

program.parseAsync().catch((e: unknown) => {
  console.log('Caught in main program');
  const exitCode = (e as { exitCode?: number }).exitCode;
  if (exitCode === 0) { process.exit(0); }
  if (e instanceof Error) { console.error(e.message); }
  process.exit(2);
});
