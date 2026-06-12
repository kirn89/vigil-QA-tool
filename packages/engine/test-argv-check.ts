import { Command } from 'commander';

const program = new Command();
program.name('vigil').exitOverride();

program.command('app:add')
  .requiredOption('--name <name>')
  .requiredOption('--url <url>')
  .action(async (o) => { console.log('Action'); });

console.log('process.argv.slice(2):', process.argv.slice(2));

program.parseAsync().catch(e => {
  console.log('Caught, exitCode:', e.exitCode);
  process.exit(2);
});
