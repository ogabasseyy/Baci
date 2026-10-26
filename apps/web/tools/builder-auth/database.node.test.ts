import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { createOpaqueVault } from './opaque-vault.ts';
import { createSessionVault } from './session-vault.ts';
import { createAuthStorage } from './storage.ts';
import { databaseFixture } from './test-fixtures.ts';

const actor = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const connection = '20000000-0000-4000-8000-000000000001';
const merchant = '30000000-0000-4000-8000-000000000001';
test('private SQL permissions, single-use records, durable refresh lock and canonical revocation', {
  timeout: 90000,
}, async () => {
  const fixture = await databaseFixture();
  const pool = fixture.pool;
  try {
    await pool.query('INSERT INTO auth.users VALUES($1),($2)', [actor, other]);
    await pool.query('INSERT INTO public.merchants VALUES($1,$2)', [
      merchant,
      actor,
    ]);
    const rolePool = new Pool({
      ...pool.options,
      options: '-c role=baci_builder_auth_storage',
      max: 8,
    });
    const key = randomBytes(32);
    const keys = new Map([['k1', key]]);
    const store = createAuthStorage(
      rolePool,
      createSessionVault({ activeKeyId: 'k1', keys }),
      createOpaqueVault('k1', keys)
    );
    try {
      await store.createConnection(
        {
          connectionId: connection,
          actorUserId: actor,
          grantVersion: 1,
          providerGrantId: 'grant-a',
          scopes: ['storefront.read', 'storefront.write'],
          allowedMerchantIds: [],
          allowCreateStore: true,
          expiresAt: new Date(Date.now() + 600000).toISOString(),
        },
        {
          accessToken: 'private-access',
          refreshToken: 'private-refresh',
          expiresAt: 1,
        }
      );
      const row = await store.readConnection(connection);
      assert.equal(row?.actorUserId, actor);
      assert(row);
      assert(!Object.hasOwn(row, 'providerGrantId'));
      await assert.rejects(
        rolePool.query('SELECT id FROM public.merchants'),
        /permission denied/
      );
      const secret = await pool.query(
        'SELECT sealed FROM builder_authorization.sessions'
      );
      assert(!JSON.stringify(secret.rows).includes('private-access'));
      await assert.rejects(
        pool.query(
          'SET ROLE authenticated; SELECT sealed FROM builder_authorization.sessions'
        ),
        /permission denied/
      );
      await pool.query('RESET ROLE');
      const owner = await pool.connect();
      try {
        await owner.query('BEGIN');
        await owner.query('SET LOCAL ROLE authenticated');
        await owner.query(
          "SELECT set_config('request.jwt.claim.sub',$1,true)",
          [other]
        );
        assert.equal(
          (
            await owner.query(
              'SELECT id FROM builder_authorization.connections'
            )
          ).rows.length,
          0
        );
        await owner.query(
          "SELECT set_config('request.jwt.claim.sub',$1,true)",
          [actor]
        );
        await owner.query(
          'UPDATE builder_authorization.connections SET allowed_merchant_ids=ARRAY[$1]::uuid[] WHERE id=$2',
          [merchant, connection]
        );
        await owner.query('COMMIT');
      } finally {
        owner.release();
      }
      assert.deepEqual(
        (await store.readConnection(connection))?.allowedMerchantIds,
        [merchant]
      );
      assert.equal((await store.readConnection(connection))?.grantVersion, 1);
      let release: () => void = () => {};
      const held = new Promise<void>((r) => {
        release = r;
      });
      let entered: () => void = () => {};
      const started = new Promise<void>((r) => {
        entered = r;
      });
      const first = store.withSession(connection, 1, async (ctx) => {
        entered();
        await held;
        return ctx.row.actorUserId;
      });
      await started;
      await assert.rejects(
        store.withSession(connection, 1, async () => null),
        /busy/
      );
      release();
      assert.equal(await first, actor);
      const Adapter = store.providerAdapter;
      const replayId = '20000000-0000-4000-8000-000000000002';
      await store.createConnection(
        {
          connectionId: replayId,
          actorUserId: actor,
          providerGrantId: 'grant-replay',
          grantVersion: 1,
          scopes: ['storefront.read'],
          allowedMerchantIds: [],
          allowCreateStore: false,
          expiresAt: new Date(Date.now() + 600000).toISOString(),
        },
        {
          accessToken: 'replay-private',
          refreshToken: 'replay-refresh',
          expiresAt: Date.now() + 300000,
        }
      );
      const a = new Adapter('AuthorizationCode');
      await a.upsert(
        'code',
        { grantId: 'grant-replay', secret: 'private-code' },
        60
      );
      assert(
        !JSON.stringify(
          (
            await pool.query(
              'SELECT payload FROM builder_authorization.provider_records'
            )
          ).rows
        ).includes('private-code')
      );
      const consumed = await Promise.allSettled([
        a.consume('code'),
        new Adapter('AuthorizationCode').consume('code'),
      ]);
      assert.equal(
        consumed.filter((result) => result.status === 'fulfilled').length,
        1
      );
      assert.equal((await store.readConnection(replayId))?.status, 'revoked');
      const disconnect = await pool.connect();
      try {
        await disconnect.query('BEGIN');
        await disconnect.query('SET LOCAL ROLE authenticated');
        await disconnect.query(
          "SELECT set_config('request.jwt.claim.sub',$1,true)",
          [other]
        );
        assert.equal(
          (
            await disconnect.query(
              'SELECT public.disconnect_builder_connection($1) AS ok',
              [connection]
            )
          ).rows[0].ok,
          false
        );
        await disconnect.query(
          "SELECT set_config('request.jwt.claim.sub',$1,true)",
          [actor]
        );
        assert.equal(
          (
            await disconnect.query(
              'SELECT public.disconnect_builder_connection($1) AS ok',
              [connection]
            )
          ).rows[0].ok,
          true
        );
        assert.equal(
          (
            await disconnect.query(
              'SELECT public.disconnect_builder_connection($1) AS ok',
              [connection]
            )
          ).rows[0].ok,
          true
        );
        await disconnect.query('COMMIT');
      } finally {
        disconnect.release();
      }
      assert.equal((await store.readConnection(connection))?.grantVersion, 2);
      await a.revokeByGrantId('grant-a');
      assert.equal((await store.readConnection(connection))?.status, 'revoked');
      await assert.rejects(
        store.withSession(connection, 1, async () => null),
        /Reconnect/
      );
    } finally {
      await rolePool.end();
    }
  } finally {
    await fixture.close();
  }
});
