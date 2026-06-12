import { getPool } from './pool.js';
import { encryptJson, decryptJson } from './crypto.js';

export interface Credentials { email: string; password: string; }
export interface AppRecord {
  id: string; userId: string; name: string;
  productionUrl: string; previewUrl: string | null;
  credentials: Credentials | null;
}

export async function ensureUser(email: string): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into users (email) values ($1)
     on conflict (email) do update set email = excluded.email
     returning id`, [email]);
  return rows[0]!.id;
}

export async function createApp(input: {
  userId: string; name: string; productionUrl: string;
  previewUrl: string | null; credentials: Credentials | null;
}): Promise<AppRecord> {
  const { rows } = await getPool().query(
    `insert into apps (user_id, name, production_url, preview_url, credentials_encrypted)
     values ($1, $2, $3, $4, $5) returning id`,
    [input.userId, input.name, input.productionUrl, input.previewUrl,
     input.credentials ? encryptJson(input.credentials) : null]);
  return { id: rows[0]!.id as string, ...input };
}

export async function getAppByName(userId: string, name: string): Promise<AppRecord | null> {
  const { rows } = await getPool().query(
    `select id, user_id, name, production_url, preview_url, credentials_encrypted
     from apps where user_id = $1 and name = $2`, [userId, name]);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id, userId: r.user_id, name: r.name,
    productionUrl: r.production_url, previewUrl: r.preview_url,
    credentials: r.credentials_encrypted ? decryptJson(r.credentials_encrypted) : null,
  };
}
