import { Command } from 'commander';

const program = new Command().name('vigil');
program.command('app:add')
  .requiredOption('--name <name>').requiredOption('--url <url>')
  .action(async (o) => { console.log('Action called'); });

program.hook('postAction', async () => { 
  console.log('postAction hook called - this should not appear for parse errors');
});

program.exitOverride();

program.parseAsync(process.argv.slice(2)).catch((e) => {
  console.log('Error caught, exitCode:', e.exitCode);
  const exitCode = (e).exitCode;
  if (exitCode === 0) { 
    console.log('Exiting with 0 for help/version');
    process.exit(0); 
  }
  if (e instanceof Error) { console.error(e.message); }
  console.log('About to exit with code 2');
  process.exit(2);
});
