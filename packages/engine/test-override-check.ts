import { Command } from 'commander';

const program = new Command().name('vigil');
program.command('app:add')
  .requiredOption('--name <name>')
  .requiredOption('--url <url>')
  .action(async (o) => { console.log('Action'); });

console.log('Calling exitOverride');
const result = program.exitOverride();
console.log('exitOverride returned:', result);

try {
  await program.parseAsync(['app:add', '--name', 'test']);
  console.log('parseAsync returned normally');
} catch (e: any) {
  console.log('parseAsync threw, exitCode:', e.exitCode);
  process.exit(e.exitCode === 0 ? 0 : 2);
}
