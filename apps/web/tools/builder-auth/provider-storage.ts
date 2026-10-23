import { createHash } from 'node:crypto';
import { type AdapterPayload, errors } from 'oidc-provider';
export const providerLookupKey = (
  model: string,
  column: string,
  value: string
) =>
  createHash('sha256')
    .update(JSON.stringify(['baci.builder.lookup.v1', model, column, value]))
    .digest('hex');

import type { Pool, PoolClient } from 'pg';
import type { createOpaqueVault } from './opaque-vault.ts';
import type { SealedSession } from './session-vault.ts';
export function createProviderAdapter(
  pool: Pool,
  opaque: ReturnType<typeof createOpaqueVault>,
  transaction: <T>(
    pool: Pool,
    work: (client: PoolClient) => Promise<T>
  ) => Promise<T>,
  revokeGrant: (client: Pool | PoolClient, grantId: string) => Promise<void>
) {
  return class {
    model: string;
    constructor(model: string) {
      this.model = model;
    }
    async upsert(id: string, payload: AdapterPayload, expiresIn: number) {
      const idHash = providerLookupKey(this.model, 'id', id);
      const sealed = opaque.seal(payload, JSON.stringify([this.model, idHash]));
      await pool.query(
        `INSERT INTO builder_authorization.provider_records(model,id,grant_id,uid,user_code,payload,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+$7*interval '1 second') ON CONFLICT(model,id) DO UPDATE SET grant_id=EXCLUDED.grant_id,uid=EXCLUDED.uid,user_code=EXCLUDED.user_code,payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at`,
        [
          this.model,
          idHash,
          payload.grantId ?? null,
          typeof payload.uid === 'string'
            ? providerLookupKey(this.model, 'uid', payload.uid)
            : null,
          typeof payload.userCode === 'string'
            ? providerLookupKey(this.model, 'user_code', payload.userCode)
            : null,
          sealed,
          expiresIn ?? 86400,
        ]
      );
    }
    async lookup(
      column: 'id' | 'uid' | 'user_code',
      value: string
    ): Promise<AdapterPayload | undefined> {
      const r = await pool.query<{
        id: string;
        payload: SealedSession;
        consumed: number | null;
      }>(
        `SELECT id,payload,consumed FROM builder_authorization.provider_records WHERE model=$1 AND ${column}=$2 AND expires_at>now()`,
        [this.model, providerLookupKey(this.model, column, value)]
      );
      const row = r.rows[0];
      if (!row) return undefined;
      const payload = opaque.open(
        row.payload,
        JSON.stringify([this.model, row.id])
      );
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw new Error('Invalid provider record');
      return {
        ...payload,
        ...(row.consumed ? { consumed: Number(row.consumed) } : {}),
      };
    }
    find(id: string) {
      return this.lookup('id', id);
    }
    findByUid(uid: string) {
      return this.lookup('uid', uid);
    }
    findByUserCode(code: string) {
      return this.lookup('user_code', code);
    }
    async consume(id: string) {
      const r = await pool.query(
        'UPDATE builder_authorization.provider_records SET consumed=extract(epoch FROM now())::bigint WHERE model=$1 AND id=$2 AND consumed IS NULL AND expires_at>now()',
        [this.model, providerLookupKey(this.model, 'id', id)]
      );
      if (r.rowCount !== 1) {
        const prior = await pool.query<{ grant_id: string | null }>(
          'SELECT grant_id FROM builder_authorization.provider_records WHERE model=$1 AND id=$2',
          [this.model, providerLookupKey(this.model, 'id', id)]
        );
        const grantId = prior.rows[0]?.grant_id;
        if (grantId) await transaction(pool, (c) => revokeGrant(c, grantId));
        throw new errors.InvalidGrant('Already consumed');
      }
    }
    async destroy(id: string) {
      await transaction(pool, async (c) => {
        if (this.model === 'Grant') await revokeGrant(c, id);
        await c.query(
          'DELETE FROM builder_authorization.provider_records WHERE model=$1 AND id=$2',
          [this.model, providerLookupKey(this.model, 'id', id)]
        );
      });
    }
    async revokeByGrantId(id: string) {
      await transaction(pool, (c) => revokeGrant(c, id));
    }
  };
}
