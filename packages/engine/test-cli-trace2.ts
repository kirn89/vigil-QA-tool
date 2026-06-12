import { Command } from 'commander';
import { fileURLToPath } from 'node:url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const program = new Command().name('vigil');
  program.command('app:add')
    .requiredOption('--name <name>').requiredOption('--url <url>')
    .action(async (o) => { console.log('Action called'); });
  
  program.hook('postAction', async () => { 
    console.log('postAction hook - no closePool');
  });
  
  program.exitOverride();
  program.parseAsync().catch((e: unknown) => {
    console.log('In catch, exitCode:', (e as any).exitCode);
    const exitCode = (e as { exitCode?: number }).exitCode;
    if (exitCode === 0) { process.exit(0); }
    if (e instanceof Error) { console.error(e.message); }
    process.exit(2);
  });
}
