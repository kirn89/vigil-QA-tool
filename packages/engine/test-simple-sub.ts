import { Command } from 'commander';

const program = new Command();
program.name('test').exitOverride();

const sub = program.command('sub').requiredOption('--opt <val>').action(() => {});

program.parseAsync(['sub']).catch(e => {
  console.log('Caught:', e.exitCode);
  process.exit(2);
});
