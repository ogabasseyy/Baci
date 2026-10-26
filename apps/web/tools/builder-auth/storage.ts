import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import type { createOpaqueVault } from './opaque-vault.ts';
import {
  createProviderAdapter,
  providerLookupKey,
} from './provider-storage.ts';
import type { SessionState } from './refresh.ts';
import type {
  createSessionVault,
  SealedSession,
  UpstreamTokens,
} from './session-vault.ts';

const connectionSchema = z.object({
  connectionId: z.uuid(),
  actorUserId: z.uuid(),
  providerGrantId: z.string(),
  grantVersion: z.coerce.number().int().positive().safe(),
  scopes: z.array(
    z.enum(['storefront.read', 'storefront.write', 'storefront.publish'])
  ),
  allowedMerchantIds: z.array(z.uuid()).max(1),
  allowCreateStore: z.boolean(),
  status: z.enum(['active', 'revoked', 'expired']),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
});
export type Connection = z.infer<typeof connectionSchema>;
export type NewConnection = Omit<Connection, 'status' | 'revokedAt'>;
const projection = `id AS "connectionId",actor_user_id AS "actorUserId",provider_grant_id AS "providerGrantId",grant_version AS "grantVersion",scopes,allowed_merchant_ids AS "allowedMerchantIds",allow_create_store AS "allowCreateStore",status,expires_at::text AS "expiresAt",revoked_at::text AS "revokedAt"`;
// PostgreSQL date text is normalized before returning the public-safe projection.
const parseConnection = (row: unknown) => {
  const c = connectionSchema.parse(row);
  return {
    ...c,
    expiresAt: new Date(c.expiresAt).toISOString(),
    revokedAt: c.revokedAt ? new Date(c.revokedAt).toISOString() : null,
  };
};
async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const result = await work(c);
    await c.query('COMMIT');
    return result;
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
export function createAuthStorage(
  pool: Pool,
  vault: ReturnType<typeof createSessionVault>,
  opaque: ReturnType<typeof createOpaqueVault>
) {
  async function readConnection(id: string) {
    const r = await pool.query(
      `SELECT ${projection} FROM builder_authorization.connections WHERE id=$1`,
      [id]
    );
    if (!r.rows[0]) return null;
    const row = parseConnection(r.rows[0]);
    return {
      connectionId: row.connectionId,
      actorUserId: row.actorUserId,
      grantVersion: row.grantVersion,
      scopes: row.scopes,
      allowedMerchantIds: row.allowedMerchantIds,
      allowCreateStore: row.allowCreateStore,
      status: row.status,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    };
  }
  async function revokeGrant(c: Pool | PoolClient, grantId: string) {
    await c.query(
      "UPDATE builder_authorization.connections SET status='revoked',revoked_at=COALESCE(revoked_at,now()),grant_version=CASE WHEN status='revoked' THEN grant_version ELSE grant_version+1 END WHERE provider_grant_id=$1",
      [grantId]
    );
    await c.query(
      'DELETE FROM builder_authorization.sessions WHERE connection_id IN (SELECT id FROM builder_authorization.connections WHERE provider_grant_id=$1)',
      [grantId]
    );
    await c.query(
      "DELETE FROM builder_authorization.provider_records WHERE grant_id=$1 OR (model='Grant' AND id=$2)",
      [grantId, providerLookupKey('Grant', 'id', grantId)]
    );
  }
  const providerAdapter = createProviderAdapter(
    pool,
    opaque,
    transaction,
    revokeGrant
  );
  return {
    providerAdapter,
    readConnection,
    async listActiveEditConnections(after: string | null, limit: number) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 20)
        throw new Error('Invalid connection limit');
      if (after !== null) z.uuid().parse(after);
      const rows = await pool.query<{ id: string }>(
        "SELECT id FROM builder_authorization.connections WHERE status='active' AND revoked_at IS NULL AND expires_at>clock_timestamp() AND 'storefront.write'=ANY(scopes) AND ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2",
        [after, limit]
      );
      return rows.rows.map((row) => row.id);
    },
    async readByGrant(grantId: string) {
      const r = await pool.query(
        `SELECT ${projection} FROM builder_authorization.connections WHERE provider_grant_id=$1`,
        [grantId]
      );
      return r.rows[0] ? parseConnection(r.rows[0]) : null;
    },
    async createConnection(row: NewConnection, tokens: UpstreamTokens) {
      await transaction(pool, async (c) => {
        await c.query(
          'INSERT INTO builder_authorization.connections(id,actor_user_id,provider_grant_id,grant_version,scopes,allowed_merchant_ids,allow_create_store,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            row.connectionId,
            row.actorUserId,
            row.providerGrantId,
            row.grantVersion,
            row.scopes,
            row.allowedMerchantIds,
            row.allowCreateStore,
            row.expiresAt,
          ]
        );
        await c.query(
          'INSERT INTO builder_authorization.sessions(connection_id,sealed) VALUES($1,$2)',
          [row.connectionId, vault.seal(tokens, row)]
        );
      });
    },
    async revoke(id: string) {
      await transaction(pool, async (c) => {
        const r = await c.query<{ provider_grant_id: string }>(
          'SELECT provider_grant_id FROM builder_authorization.connections WHERE id=$1 FOR UPDATE',
          [id]
        );
        if (r.rows[0]) await revokeGrant(c, r.rows[0].provider_grant_id);
      });
    },
    async withSession<T>(
      id: string,
      version: number,
      work: (ctx: {
        row: SessionState;
        markRefreshing: () => Promise<void>;
        save: (tokens: UpstreamTokens) => Promise<void>;
        revoke: () => Promise<void>;
      }) => Promise<T>
    ): Promise<T> {
      const c = await pool.connect();
      let locked = false;
      try {
        const lock = await c.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock(hashtextextended('baci.builder.refresh.'||$1,0)) AS locked",
          [id]
        );
        if (!lock.rows[0]?.locked)
          throw new Error('Connection busy; retry shortly.');
        locked = true;
        const r = await c.query(
          `SELECT ${projection} FROM builder_authorization.connections WHERE id=$1`,
          [id]
        );
        if (!r.rows[0]) throw new Error('Reconnect Baci to continue.');
        const grant = parseConnection(r.rows[0]);
        if (
          grant.status !== 'active' ||
          grant.revokedAt ||
          grant.grantVersion !== version ||
          Date.parse(grant.expiresAt) <= Date.now()
        )
          throw new Error('Reconnect Baci to continue.');
        const s = await c.query<{
          sealed: SealedSession;
          refresh_started_at: string | null;
        }>(
          'SELECT sealed,refresh_started_at FROM builder_authorization.sessions WHERE connection_id=$1',
          [id]
        );
        if (!s.rows[0]) throw new Error('Reconnect Baci to continue.');
        const revoke = () =>
          transaction(pool, (client) =>
            revokeGrant(client, grant.providerGrantId)
          );
        let tokens: UpstreamTokens;
        try {
          tokens = vault.open(s.rows[0].sealed, grant);
        } catch {
          await revoke();
          throw new Error('Reconnect Baci to continue.');
        }
        return await work({
          row: {
            ...grant,
            active: true,
            expiresAt: Date.parse(grant.expiresAt),
            refreshStarted: s.rows[0].refresh_started_at !== null,
            tokens,
          },
          markRefreshing: async () => {
            const r = await c.query(
              'UPDATE builder_authorization.sessions SET refresh_started_at=now() WHERE connection_id=$1 AND refresh_started_at IS NULL',
              [id]
            );
            if (r.rowCount !== 1)
              throw new Error('Reconnect Baci to continue.');
          },
          save: async (tokens) => {
            await transaction(pool, async (client) => {
              const current = await client.query(
                "SELECT id FROM builder_authorization.connections WHERE id=$1 AND grant_version=$2 AND status='active' AND expires_at>now() FOR UPDATE",
                [id, version]
              );
              if (current.rowCount !== 1)
                throw new Error('Reconnect Baci to continue.');
              const r = await client.query(
                'UPDATE builder_authorization.sessions SET sealed=$2,refresh_started_at=NULL,updated_at=now() WHERE connection_id=$1',
                [id, vault.seal(tokens, grant)]
              );
              if (r.rowCount !== 1)
                throw new Error('Reconnect Baci to continue.');
            });
          },
          revoke,
        });
      } finally {
        try {
          if (locked)
            await c.query(
              "SELECT pg_advisory_unlock(hashtextextended('baci.builder.refresh.'||$1,0))",
              [id]
            );
        } finally {
          c.release();
        }
      }
    },
    async putTransaction(idHash: string, browserHash: string, value: unknown) {
      await pool.query(
        "INSERT INTO builder_authorization.transactions(id_hash,browser_hash,sealed,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",
        [idHash, browserHash, opaque.seal(value, `transaction:${idHash}`)]
      );
    },
    async takeTransaction(idHash: string, browserHash: string) {
      const r = await pool.query<{ sealed: SealedSession }>(
        'DELETE FROM builder_authorization.transactions WHERE id_hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING sealed',
        [idHash, browserHash]
      );
      return r.rows[0]
        ? opaque.open(r.rows[0].sealed, `transaction:${idHash}`)
        : null;
    },
  };
}
export type AuthStorage = ReturnType<typeof createAuthStorage>;
