import { Command } from 'commander';

const program = new Command();
program.name('vigil').exitOverride();

program.command('app:add')
  .requiredOption('--name <name>')
  .requiredOption('--url <url>')
  .action(async (o) => { console.log('Action'); });

program.parseAsync(['app:add', '--name', 'test']).catch(e => {
  console.log('Caught, exitCode:', e.exitCode);
  process.exit(2);
});
