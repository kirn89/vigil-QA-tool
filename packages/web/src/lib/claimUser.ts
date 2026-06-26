export interface ClaimDb {
  query(sql: string, params: unknown[]): Promise<{ rowCount: number }>;
}

/** Link a Supabase auth identity to the engine's users table. Claims a pre-existing
 *  (concierge-created) row by email; if none, inserts a new linked row. Idempotent:
 *  a second call with the same email no longer matches an unlinked row, inserts nothing
 *  new because the email already carries this auth_id. Runs with the service role. */
export async function claimUser(db: ClaimDb, authId: string, email: string): Promise<void> {
  const normalized = email.toLowerCase();
  const claimed = await db.query(
    'update users set auth_id = $1 where lower(email) = $2 and auth_id is null',
    [authId, normalized],
  );
  if (claimed.rowCount === 0) {
    await db.query(
      'insert into users (email, auth_id) values ($1, $2) on conflict (email) do update set auth_id = excluded.auth_id',
      [normalized, authId],
    );
  }
}
