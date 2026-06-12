import { fileURLToPath } from 'node:url';
console.log('process.argv:', process.argv);
console.log('import.meta.url:', import.meta.url);
console.log('fileURLToPath(import.meta.url):', fileURLToPath(import.meta.url));
console.log('process.argv[1]:', process.argv[1]);
console.log('Match:', process.argv[1] === fileURLToPath(import.meta.url));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Running as main module');
} else {
  console.log('NOT running as main module');
}
