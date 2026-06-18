import { config } from 'dotenv';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from the package dir first, then fall back to repo root.
// Tests run from packages/engine; the .env lives at the monorepo root.
const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
config({ path: join(packageDir, '.env') });
config({ path: join(packageDir, '../../.env') });

export function env(name: 'DATABASE_URL' | 'VIGIL_SECRET_KEY' | 'OPENROUTER_API_KEY'): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (copy .env.example to .env)`);
  return v;
}
