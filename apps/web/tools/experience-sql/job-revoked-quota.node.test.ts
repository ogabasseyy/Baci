import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { asActor, experienceSqlFixture } from './fixture.ts';

test('jobs: a reconnected owner regains quota without reviving revoked attempts', async () => {
  const f = await experienceSqlFixture();
  const client = await f.pool.connect();
  try {
    for (const name of [
      '20261024072905_experience_private_foundation.sql',
      '20261024073533_experience_job_and_draft_lifecycle.sql',
      '20261113175836_experience_build_connection_binding.sql',
      '20261113180409_experience_build_bound_lifecycle.sql',
      '20261114023338_experience_build_lease_renewal.sql',
      '20261120095000_experience_reclaim_unusable_build_quota.sql',
    ]) {
      await f.pool.query(
        readFileSync(
          new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
          'utf8'
        )
      );
    }
    const [actor, merchant, artifact, old, expired, superseded, replacement] =
      Array.from({ length: 7 }, () => randomUUID());
    await f.pool.query('INSERT INTO auth.users(id) VALUES($1)', [actor]);
    await f.pool.query('INSERT INTO merchants(id,user_id) VALUES($1,$2)', [
      merchant,
      actor,
    ]);
    await f.pool.query(
      "INSERT INTO experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,repeat('a',64),'{}')",
      [artifact, merchant]
    );
    for (const connection of [old, expired, superseded, replacement]) {
      await f.pool.query(
        "INSERT INTO builder_authorization.connections(id,actor_user_id,provider_grant_id,scopes,allowed_merchant_ids,expires_at) VALUES($1::uuid,$2,$1::uuid::text,ARRAY['storefront.read','storefront.write'],ARRAY[$3]::uuid[],now()+interval '1 hour')",
        [connection, actor, merchant]
      );
    }
    const queue = async (connection: string | null, retry = randomUUID()) =>
      (
        await asActor(client, actor, () =>
          client.query<{ id: string }>(
            'SELECT experience_queue_build($1,$2,$3,$4,$5) id',
            [merchant, connection, connection ? 1 : null, artifact, retry]
          )
        )
      ).rows[0].id;
    const state = async (id: string) =>
      (
        await f.pool.query<{
          status: string;
          attempt_nonce: string;
          lease_expires_at: Date | null;
        }>(
          'SELECT status, attempt_nonce, lease_expires_at FROM experience_jobs WHERE id=$1',
          [id]
        )
      ).rows[0];

    const originalKey = randomUUID();
    const revoke = (connection: string) =>
      asActor(client, actor, () =>
        client.query(
          "UPDATE builder_authorization.connections SET status='revoked', revoked_at=clock_timestamp() WHERE id=$1",
          [connection]
        )
      );
    const revokedJob = await queue(old, originalKey);
    const expiredJob = await queue(expired);
    const supersededJob = await queue(superseded);
    const nativeJob = await queue(null);
    const oldAttempt = (await state(revokedJob)).attempt_nonce;
    await asActor(client, actor, () =>
      client.query('SELECT experience_claim_build($1,$2,1,$3,$4)', [
        merchant,
        old,
        revokedJob,
        oldAttempt,
      ])
    );
    await assert.rejects(queue(replacement), /QUOTA_EXCEEDED/);
    await revoke(old);
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE baci_builder_auth_storage');
      await client.query(
        "UPDATE builder_authorization.connections SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [expired]
      );
      await client.query(
        'UPDATE builder_authorization.connections SET grant_version=2 WHERE id=$1',
        [superseded]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    await assert.rejects(
      queue(replacement, originalKey),
      /IDEMPOTENCY_CONFLICT/
    );
    const newJob = await queue(replacement);
    for (const id of [revokedJob, expiredJob, supersededJob]) {
      const row = await state(id);
      assert.equal(row.status, 'cancelled');
      assert.equal(row.lease_expires_at, null);
    }
    assert.notEqual((await state(revokedJob)).attempt_nonce, oldAttempt);
    assert.equal((await state(nativeJob)).status, 'queued');
    assert.equal((await state(newJob)).status, 'queued');
    await assert.rejects(
      asActor(client, actor, () =>
        client.query('SELECT experience_renew_build_lease($1,$2,1,$3,$4)', [
          merchant,
          old,
          revokedJob,
          oldAttempt,
        ])
      ),
      /CONNECTION_REVOKED/
    );
    await assert.rejects(
      asActor(client, actor, () =>
        client.query('SELECT experience_retry_build($1,$2,1,$3)', [
          merchant,
          replacement,
          revokedJob,
        ])
      ),
      /BUILD_FAILED/
    );
    const anotherJob = await queue(replacement);
    const lastJob = await queue(replacement);
    await assert.rejects(queue(replacement), /QUOTA_EXCEEDED/);

    await asActor(client, actor, () =>
      client.query('SELECT experience_cancel_build($1,NULL,NULL,$2)', [
        merchant,
        nativeJob,
      ])
    );
    await queue(null);
    await revoke(replacement);
    await asActor(client, actor, () =>
      client.query('SELECT experience_retry_build($1,NULL,NULL,$2)', [
        merchant,
        nativeJob,
      ])
    );
    assert.equal((await state(nativeJob)).status, 'queued');
    for (const id of [newJob, anotherJob, lastJob])
      assert.equal((await state(id)).status, 'cancelled');

    const result = await f.pool.query(
      `SELECT rolname AS role, has_function_privilege(rolname,
        'experience_authorization.require_available_build_slot(uuid,uuid)', 'EXECUTE') AS allowed
      FROM pg_catalog.pg_roles
      WHERE rolname IN ('authenticated', 'anon', 'service_role', 'baci_builder_auth_storage')`
    );
    assert.equal(result.rowCount, 4);
    assert.ok(result.rows.every((row) => row.allowed === false));
  } finally {
    client.release();
    await f.close();
  }
});
