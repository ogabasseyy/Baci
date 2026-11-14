import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { asActor, experienceSqlFixture } from './fixture.ts';

test('jobs: a build job cannot be replayed or claimed through a different connection', async () => {
  const f = await experienceSqlFixture();
  const client = await f.pool.connect();
  try {
    for (const name of [
      '20261024072905_experience_private_foundation.sql',
      '20261024073157_experience_private_uploads.sql',
      '20261025060500_experience_upload_manifest_validation.sql',
      '20261024073533_experience_job_and_draft_lifecycle.sql',
      '20261024171619_experience_owner_intents.sql',
      '20261028162326_experience_retry_build_quota.sql',
      '20261113175836_experience_build_connection_binding.sql',
      '20261113180409_experience_build_bound_lifecycle.sql',
      '20261113181020_experience_finalize_connection_binding.sql',
      '20261113181439_experience_list_due_builds.sql',
      '20261113183638_experience_background_build_recovery.sql',
      '20261114023338_experience_build_lease_renewal.sql',
      '20261114023420_experience_background_recovery_terminal.sql',
      '20261114024007_experience_finalize_live_lease.sql',
    ])
      await f.pool.query(
        readFileSync(
          new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
          'utf8'
        )
      );
    const [actor, merchant, artifact, first, second, retry] = Array.from(
      { length: 6 },
      () => randomUUID()
    );
    await f.pool.query('INSERT INTO auth.users(id) VALUES($1)', [actor]);
    await f.pool.query('INSERT INTO merchants(id,user_id) VALUES($1,$2)', [
      merchant,
      actor,
    ]);
    await f.pool.query(
      "INSERT INTO experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,repeat('a',64),'{}')",
      [artifact, merchant]
    );
    for (const connection of [first, second])
      await f.pool.query(
        "INSERT INTO builder_authorization.connections(id,actor_user_id,provider_grant_id,scopes,allowed_merchant_ids,expires_at) VALUES($1::uuid,$2,$1::uuid::text,ARRAY['storefront.read','storefront.write'],ARRAY[$3]::uuid[],now()+interval '1 hour')",
        [connection, actor, merchant]
      );
    const queue = (connection: string) =>
      asActor(client, actor, () =>
        client.query('SELECT experience_queue_build($1,$2,1,$3,$4) id', [
          merchant,
          connection,
          artifact,
          retry,
        ])
      );
    const job = (await queue(first)).rows[0].id;
    assert.equal((await queue(first)).rows[0].id, job);
    const due = (connection: string) =>
      asActor(client, actor, () =>
        client.query('SELECT experience_list_due_builds($1,$2,1) AS ids', [
          merchant,
          connection,
        ])
      );
    assert.deepEqual((await due(first)).rows[0].ids, [job]);
    assert.deepEqual((await due(second)).rows[0].ids, []);
    await assert.rejects(queue(second), /IDEMPOTENCY_CONFLICT/);
    const nonce = (
      await f.pool.query(
        'SELECT attempt_nonce FROM experience_jobs WHERE id=$1',
        [job]
      )
    ).rows[0].attempt_nonce;
    await assert.rejects(
      asActor(client, actor, () =>
        client.query('SELECT experience_claim_build($1,$2,1,$3,$4)', [
          merchant,
          second,
          job,
          nonce,
        ])
      ),
      /BUILD_FAILED/
    );
    await asActor(client, actor, () =>
      client.query('SELECT experience_claim_build($1,$2,1,$3,$4)', [
        merchant,
        first,
        job,
        nonce,
      ])
    );
    assert.deepEqual((await due(first)).rows[0].ids, []);
    const secondRetry = randomUUID();
    const finalizeJob = (
      await asActor(client, actor, () =>
        client.query('SELECT experience_queue_build($1,$2,1,$3,$4) id', [
          merchant,
          first,
          artifact,
          secondRetry,
        ])
      )
    ).rows[0].id;
    const finalizeNonce = (
      await f.pool.query(
        'SELECT attempt_nonce FROM experience_jobs WHERE id=$1',
        [finalizeJob]
      )
    ).rows[0].attempt_nonce;
    await asActor(client, actor, () =>
      client.query('SELECT experience_claim_build($1,$2,1,$3,$4)', [
        merchant,
        first,
        finalizeJob,
        finalizeNonce,
      ])
    );
    const hash = (value: string) =>
      createHash('sha256').update(value).digest('hex');
    const javascript = 'export{}';
    const build = hash(`${javascript}\0`);
    const receipt = hash('receipt');
    const files = [
      {
        path: 'app.js',
        mime: 'text/javascript',
        bytes: Buffer.from(javascript).toString('hex'),
        digest: hash(javascript),
      },
      { path: 'app.css', mime: 'text/css', bytes: '', digest: hash('') },
    ];
    await f.pool.query(
      'INSERT INTO experience_evidence(merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) VALUES($1,$2,$3,$4,$5,$6)',
      [
        merchant,
        finalizeJob,
        finalizeNonce,
        build,
        receipt,
        'http://127.0.0.1:4100',
      ]
    );
    const finalize = (connection: string) =>
      asActor(client, actor, () =>
        client.query(
          'SELECT experience_finalize_build($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10) id',
          [
            merchant,
            connection,
            finalizeJob,
            finalizeNonce,
            'a'.repeat(64),
            build,
            receipt,
            randomUUID(),
            JSON.stringify(files),
            'http://127.0.0.1:4100',
          ]
        )
      );
    await assert.rejects(finalize(second), /BUILD_FAILED/);
    await f.pool.query(
      "UPDATE experience_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [finalizeJob]
    );
    await assert.rejects(finalize(first), /BUILD_FAILED/);
    await f.pool.query(
      "UPDATE experience_jobs SET lease_expires_at=clock_timestamp()+interval '1 minute' WHERE id=$1",
      [finalizeJob]
    );
    assert.match((await finalize(first)).rows[0].id, /^[0-9a-f-]{36}$/);
    await assert.rejects(finalize(second), /BUILD_FAILED/);
    await asActor(client, actor, () =>
      client.query('SELECT experience_fail_build($1,$2,1,$3,$4)', [
        merchant,
        second,
        job,
        nonce,
      ])
    );
    assert.equal(
      (
        await f.pool.query('SELECT status FROM experience_jobs WHERE id=$1', [
          job,
        ])
      ).rows[0].status,
      'running'
    );
    await assert.rejects(
      asActor(client, actor, () =>
        client.query('SELECT experience_cancel_build($1,$2,1,$3)', [
          merchant,
          second,
          job,
        ])
      ),
      /NOT_FOUND/
    );
    await asActor(client, actor, () =>
      client.query('SELECT experience_cancel_build($1,$2,1,$3)', [
        merchant,
        first,
        job,
      ])
    );
    await assert.rejects(
      asActor(client, actor, () =>
        client.query('SELECT experience_retry_build($1,$2,1,$3)', [
          merchant,
          second,
          job,
        ])
      ),
      /BUILD_FAILED/
    );
    await asActor(client, actor, () =>
      client.query('SELECT experience_retry_build($1,$2,1,$3)', [
        merchant,
        first,
        job,
      ])
    );
    assert.deepEqual((await due(first)).rows[0].ids, [job]);
    const previousNonce = (
      await f.pool.query(
        'SELECT attempt_nonce FROM experience_jobs WHERE id=$1',
        [job]
      )
    ).rows[0].attempt_nonce;
    await asActor(client, actor, () =>
      client.query('SELECT experience_claim_build($1,$2,1,$3,$4)', [
        merchant,
        first,
        job,
        previousNonce,
      ])
    );
    const renew = (connection: string, attempt: string) =>
      asActor(client, actor, () =>
        client.query(
          'SELECT experience_renew_build_lease($1,$2,1,$3,$4) AS renewed',
          [merchant, connection, job, attempt]
        )
      );
    assert.equal((await renew(first, previousNonce)).rows[0].renewed, true);
    assert.equal((await renew(second, previousNonce)).rows[0].renewed, false);
    await f.pool.query(
      "UPDATE experience_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [job]
    );
    assert.equal((await renew(first, previousNonce)).rows[0].renewed, false);
    assert.deepEqual((await due(first)).rows[0].ids, [job]);
    const recover = (connection: string) =>
      asActor(client, actor, () =>
        client.query(
          'SELECT experience_prepare_background_build($1,$2,1,$3) AS status',
          [merchant, connection, job]
        )
      );
    await assert.rejects(recover(second), /NOT_FOUND/);
    assert.equal((await recover(first)).rows[0].status, 'ready');
    const recovered = (
      await f.pool.query(
        'SELECT attempt_nonce,status FROM experience_jobs WHERE id=$1',
        [job]
      )
    ).rows[0];
    assert.equal(recovered.status, 'queued');
    assert.notEqual(recovered.attempt_nonce, previousNonce);
    assert.equal((await renew(first, previousNonce)).rows[0].renewed, false);
    await assert.rejects(
      asActor(client, actor, () =>
        client.query('SELECT experience_claim_build($1,$2,1,$3,$4)', [
          merchant,
          first,
          job,
          previousNonce,
        ])
      ),
      /BUILD_FAILED/
    );
    const competingClient = await f.pool.connect();
    try {
      const claims = await Promise.allSettled(
        [client, competingClient].map((c) =>
          asActor(c, actor, () =>
            c.query('SELECT experience_claim_build($1,$2,1,$3,$4)', [
              merchant,
              first,
              job,
              recovered.attempt_nonce,
            ])
          )
        )
      );
      assert.equal(
        claims.filter((claim) => claim.status === 'fulfilled').length,
        1
      );
      assert.equal(
        claims.filter((claim) => claim.status === 'rejected').length,
        1
      );
    } finally {
      competingClient.release();
    }
    await f.pool.query(
      'INSERT INTO experience_evidence(merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) VALUES($1,$2,$3,$4,$5,$6)',
      [merchant, job, previousNonce, build, receipt, 'http://127.0.0.1:4100']
    );
    await assert.rejects(
      asActor(client, actor, () =>
        client.query(
          'SELECT experience_finalize_build($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10)',
          [
            merchant,
            first,
            job,
            previousNonce,
            'a'.repeat(64),
            build,
            receipt,
            randomUUID(),
            JSON.stringify(files),
            'http://127.0.0.1:4100',
          ]
        )
      ),
      /BUILD_FAILED/
    );
    await asActor(client, actor, () =>
      client.query('SELECT experience_fail_build($1,$2,1,$3,$4)', [
        merchant,
        first,
        job,
        previousNonce,
      ])
    );
    assert.equal(
      (
        await f.pool.query('SELECT status FROM experience_jobs WHERE id=$1', [
          job,
        ])
      ).rows[0].status,
      'running'
    );
    for (let n = 0; n < 2; n++) {
      await f.pool.query(
        "UPDATE experience_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [job]
      );
      assert.equal((await recover(first)).rows[0].status, 'ready');
      const attempt = (
        await f.pool.query(
          'SELECT attempt_nonce FROM experience_jobs WHERE id=$1',
          [job]
        )
      ).rows[0].attempt_nonce;
      await asActor(client, actor, () =>
        client.query('SELECT experience_claim_build($1,$2,1,$3,$4)', [
          merchant,
          first,
          job,
          attempt,
        ])
      );
    }
    await f.pool.query(
      "UPDATE experience_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [job]
    );
    assert.deepEqual((await due(first)).rows[0].ids, [job]);
    assert.equal((await recover(first)).rows[0].status, 'unavailable');
    assert.equal(
      (
        await f.pool.query('SELECT status FROM experience_jobs WHERE id=$1', [
          job,
        ])
      ).rows[0].status,
      'failed'
    );
    assert.deepEqual((await due(first)).rows[0].ids, []);
    for (const role of ['anon', 'service_role', 'baci_builder_auth_storage']) {
      const grants = await f.pool.query(
        'SELECT has_function_privilege($1,$2,$3) allowed',
        [role, 'public.experience_list_due_builds(uuid,uuid,bigint)', 'EXECUTE']
      );
      assert.equal(grants.rows[0].allowed, false);
    }
    await asActor(client, actor, () =>
      client.query('SELECT public.disconnect_builder_connection($1)', [first])
    );
    await assert.rejects(due(first), /CONNECTION_REVOKED/);
  } finally {
    client.release();
    await f.close();
  }
});
