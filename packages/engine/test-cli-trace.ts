import { Command } from 'commander';
import { fileURLToPath } from 'node:url';

const FOUNDER_EMAIL = process.env.VIGIL_USER_EMAIL ?? 'founder@vigil.local';

console.log('process.argv[1]:', process.argv[1]);
console.log('fileURLToPath(import.meta.url):', fileURLToPath(import.meta.url));
console.log('Running guard:', process.argv[1] === fileURLToPath(import.meta.url));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('INSIDE GUARD - Setting up program');
  const program = new Command().name('vigil');
  program.command('app:add')
    .requiredOption('--name <name>').requiredOption('--url <url>')
    .action(async (o) => { console.log('Action called'); });
  
  program.hook('postAction', async () => { 
    console.log('postAction hook');
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
