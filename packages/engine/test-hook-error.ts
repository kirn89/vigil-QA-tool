import { Command } from 'commander';

const program = new Command();
program.name('vigil').exitOverride();

program.command('app:add')
  .requiredOption('--name <name>')
  .requiredOption('--url <url>')
  .action(async (o) => { console.log('Action'); });

program.hook('postAction', async () => { 
  console.log('[HOOK] postAction called');
  throw new Error('Hook error');
});

program.parseAsync().catch(e => {
  console.log('[MAIN] Caught, exitCode:', e.exitCode);
  process.exit(2);
});
