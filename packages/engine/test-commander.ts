import { Command } from 'commander';

const program = new Command().name('vigil');
const appAdd = program.command('app:add');
appAdd.requiredOption('--name <name>').requiredOption('--url <url>');
appAdd.action(async (o) => { console.log('Action called'); });

console.log('Has exitOverride method:', typeof (program as any).exitOverride);

program.exitOverride();
console.log('Called exitOverride on program');

program.parseAsync(process.argv.slice(2))
  .then(() => {
    console.log('parseAsync succeeded');
  })
  .catch((e: unknown) => {
    console.log('parseAsync failed - caught');
    const err = e as any;
    console.log('Error type:', err.constructor.name);
    console.log('Error exitCode:', err.exitCode);
    console.log('Error code:', err.code);
    const exitCode = err.exitCode;
    if (exitCode === 0) { process.exit(0); }
    if (e instanceof Error) { console.error(e.message); }
    process.exit(2);
  });
