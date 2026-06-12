import { Command } from 'commander';
const FOUNDER_EMAIL = 'founder@vigil.local';

if (true) {
  const program = new Command().name('vigil');
  program.command('app:add')
    .requiredOption('--name <name>').requiredOption('--url <url>')
    .action(async (o) => { console.log('Action called'); });
  program.hook('postAction', async () => { console.log('postAction called'); });
  program.exitOverride();
  program.parseAsync(process.argv.slice(2)).catch((e) => {
    console.log('Error caught, exitCode:', e.exitCode);
    const exitCode = (e).exitCode;
    if (exitCode === 0) { process.exit(0); } // --help / --version
    if (e instanceof Error) { console.error(e.message); }
    process.exit(2);
  });
}
