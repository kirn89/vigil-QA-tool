import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Where step screenshots go. Local disk for dev/tests; Supabase Storage in prod.
 *  `put` returns a locator (a local path, or a bucket-relative object path) that is
 *  stored on the StepResult. `prune` deletes screenshots older than `olderThanDays`
 *  and returns how many were removed (for a nightly retention cron). */
export interface ScreenshotStore {
  put(key: string, data: Buffer): Promise<string>;
  prune(olderThanDays: number): Promise<number>;
}

export class LocalScreenshotStore implements ScreenshotStore {
  constructor(private readonly baseDir: string) {}

  async put(key: string, data: Buffer): Promise<string> {
    await mkdir(this.baseDir, { recursive: true });
    const path = join(this.baseDir, key);
    await writeFile(path, data);
    return path;
  }

  async prune(olderThanDays: number): Promise<number> {
    const cutoff = Date.now() - olderThanDays * 86_400_000;
    let entries: string[];
    try {
      entries = await readdir(this.baseDir);
    } catch {
      return 0; // missing dir → nothing to prune
    }
    let deleted = 0;
    for (const name of entries) {
      const path = join(this.baseDir, name);
      const s = await stat(path).catch(() => undefined);
      if (s?.isFile() && s.mtimeMs < cutoff) {
        await rm(path, { force: true });
        deleted++;
      }
    }
    return deleted;
  }
}

export interface SupabaseStorageConfig {
  url: string; // e.g. https://<project>.supabase.co
  serviceKey: string; // service-role key (server-side only)
  bucket: string;
}

/** Uploads screenshots to Supabase Storage via its REST API using the built-in
 *  fetch — no SDK dependency. The service-role key must stay server-side. */
export class SupabaseScreenshotStore implements ScreenshotStore {
  constructor(
    private readonly cfg: SupabaseStorageConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private objectUrl(key: string): string {
    return `${this.cfg.url}/storage/v1/object/${this.cfg.bucket}/${key}`;
  }

  async put(key: string, data: Buffer): Promise<string> {
    const res = await this.fetchImpl(this.objectUrl(key), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.serviceKey}`,
        'content-type': 'image/png',
        'x-upsert': 'true',
      },
      // Buffer isn't a fetch BodyInit in these lib types; copy into a plain
      // ArrayBuffer-backed Uint8Array (a PNG is small, so the copy is negligible).
      body: Uint8Array.from(data),
    });
    if (!res.ok) throw new Error(`screenshot upload failed: ${res.status} ${await res.text().catch(() => '')}`.trim());
    return `${this.cfg.bucket}/${key}`;
  }

  /** Lists objects in the bucket and deletes those older than the cutoff. */
  async prune(olderThanDays: number): Promise<number> {
    const cutoff = Date.now() - olderThanDays * 86_400_000;
    const listRes = await this.fetchImpl(`${this.cfg.url}/storage/v1/object/list/${this.cfg.bucket}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cfg.serviceKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 10_000, sortBy: { column: 'created_at', order: 'asc' } }),
    });
    if (!listRes.ok) throw new Error(`screenshot list failed: ${listRes.status}`);
    const objects = (await listRes.json()) as Array<{ name: string; created_at?: string }>;
    const stale = objects.filter((o) => o.created_at && Date.parse(o.created_at) < cutoff).map((o) => o.name);
    if (stale.length === 0) return 0;
    const delRes = await this.fetchImpl(`${this.cfg.url}/storage/v1/object/${this.cfg.bucket}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.cfg.serviceKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ prefixes: stale }),
    });
    if (!delRes.ok) throw new Error(`screenshot delete failed: ${delRes.status}`);
    return stale.length;
  }
}

/** Picks the store from env: Supabase when SUPABASE_URL + SUPABASE_SERVICE_KEY +
 *  SUPABASE_SCREENSHOT_BUCKET are all set, else local disk at `fallbackDir`.
 *  Defaulting to local keeps dev and the test suite dependency-free. */
export function screenshotStoreFromEnv(fallbackDir: string): ScreenshotStore {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const bucket = process.env.SUPABASE_SCREENSHOT_BUCKET;
  if (url && serviceKey && bucket) return new SupabaseScreenshotStore({ url, serviceKey, bucket });
  return new LocalScreenshotStore(fallbackDir);
}
