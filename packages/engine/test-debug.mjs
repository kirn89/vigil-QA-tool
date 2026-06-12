import { Command } from 'commander';

const program = new Command().name('vigil');
program.command('app:add')
  .requiredOption('--name <name>').requiredOption('--url <url>')
  .action(async (o) => { console.log('Action called with:', o); });

program.hook('postAction', async () => { 
  console.log('postAction hook called');
  // This hook might throw async
  throw new Error('Hook error');
});

program.exitOverride();

program.parseAsync(process.argv.slice(2)).catch((e) => {
  console.log('Caught error, exitCode:', e.exitCode, 'message:', e.message);
  const exitCode = (e).exitCode;
  if (exitCode === 0) { process.exit(0); } // --help / --version
  if (e instanceof Error) { console.error(e.message); }
  process.exit(2);
});
