import type { Pool } from 'pg';

/** Bounded cleanup using the existing broker role. Retains connection audit rows. */
export async function deleteExpiredAuthRecords(pool: Pool, limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw Error('Invalid cleanup limit');
  const transactions = await pool.query(
    `DELETE FROM builder_authorization.transactions WHERE id_hash IN (
       SELECT id_hash FROM builder_authorization.transactions
       WHERE expires_at <= statement_timestamp()
       ORDER BY expires_at, id_hash LIMIT $1 FOR UPDATE SKIP LOCKED
     )`,
    [limit]
  );
  const providerRecords = await pool.query(
    `DELETE FROM builder_authorization.provider_records WHERE (model,id) IN (
       SELECT model,id FROM builder_authorization.provider_records
       WHERE expires_at <= statement_timestamp()
       ORDER BY expires_at, model, id LIMIT $1 FOR UPDATE SKIP LOCKED
     )`,
    [limit]
  );
  const sessions = await pool.query(
    `DELETE FROM builder_authorization.sessions WHERE connection_id IN (
       SELECT s.connection_id FROM builder_authorization.sessions s
       JOIN builder_authorization.connections c ON c.id = s.connection_id
       WHERE c.status IN ('revoked', 'expired') OR c.expires_at <= statement_timestamp()
       ORDER BY c.expires_at, s.connection_id LIMIT $1
       FOR UPDATE OF s, c SKIP LOCKED
     )`,
    [limit]
  );
  return {
    transactions: transactions.rowCount ?? 0,
    providerRecords: providerRecords.rowCount ?? 0,
    sessions: sessions.rowCount ?? 0,
  };
}

export function startAuthRetention(settings: {
  run(): Promise<void>;
  schedule(callback: () => void): () => void;
}) {
  let pending: Promise<void> | undefined;
  let stopped = false;
  const cancel = settings.schedule(() => {
    if (stopped || pending) return;
    pending = settings
      .run()
      .catch(() => {
        // Do not log database errors: they may contain credential or record data.
        console.error('AUTH_RETENTION_BATCH_FAILED');
      })
      .finally(() => {
        pending = undefined;
      });
  });
  return async () => {
    stopped = true;
    cancel();
    await pending;
  };
}
