import { Command } from 'commander';

const program = new Command().name('vigil');
const sub = program.command('app:add');
sub.requiredOption('--name <name>').requiredOption('--url <url>');

// Try calling exitOverride on the subcommand
sub.exitOverride();
program.exitOverride();

try {
  await program.parseAsync(['app:add', '--name', 'test']);
  console.log('Succeeded');
} catch (e: any) {
  console.log('Caught, exitCode:', e.exitCode);
  process.exit(e.exitCode === 0 ? 0 : 2);
}
