import { fileURLToPath } from 'node:url';

console.log('process.argv:', process.argv);
console.log('process.argv.slice(2):', process.argv.slice(2));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Running as script');
}
