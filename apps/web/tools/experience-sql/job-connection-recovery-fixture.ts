import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { asActor, type experienceSqlFixture } from './fixture.ts';

export async function checkConnectionRecovery(input: {
  f: Awaited<ReturnType<typeof experienceSqlFixture>>;
  client: PoolClient;
  actor: string;
  merchant: string;
  first: string;
  second: string;
  job: string;
  build: string;
  receipt: string;
  files: unknown;
  due(connection: string): Promise<{ rows: Array<{ ids: string[] }> }>;
}) {
  const {
    f,
    client,
    actor,
    merchant,
    first,
    second,
    job,
    build,
    receipt,
    files,
    due,
  } = input;
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
  await asActor(client, actor, () =>
    client.query('SELECT public.disconnect_builder_connection($1)', [first])
  );
  await assert.rejects(due(first), /CONNECTION_REVOKED/);
}

export async function checkDistinctBuildReplay(input: {
  f: Awaited<ReturnType<typeof experienceSqlFixture>>;
  client: PoolClient;
  actor: string;
  merchant: string;
  first: string;
  artifact: string;
  build: string;
  receipt: string;
  firstBuild: string;
  finalize(
    connection: string,
    job: string,
    attempt: string
  ): Promise<{ rows: Array<{ id: string }> }>;
}) {
  const {
    f,
    client,
    actor,
    merchant,
    first,
    artifact,
    build,
    receipt,
    firstBuild,
    finalize,
  } = input;
  const nextJob = (
    await asActor(client, actor, () =>
      client.query('SELECT experience_queue_build($1,$2,1,$3,$4) id', [
        merchant,
        first,
        artifact,
        randomUUID(),
      ])
    )
  ).rows[0].id;
  const nextAttempt = (
    await f.pool.query(
      'SELECT attempt_nonce FROM experience_jobs WHERE id=$1',
      [nextJob]
    )
  ).rows[0].attempt_nonce;
  await asActor(client, actor, () =>
    client.query('SELECT experience_claim_build($1,$2,1,$3,$4)', [
      merchant,
      first,
      nextJob,
      nextAttempt,
    ])
  );
  await f.pool.query(
    'INSERT INTO experience_evidence(merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) VALUES($1,$2,$3,$4,$5,$6)',
    [merchant, nextJob, nextAttempt, build, receipt, 'http://127.0.0.1:4100']
  );
  const nextBuild = (await finalize(first, nextJob, nextAttempt)).rows[0].id;
  assert.notEqual(nextBuild, firstBuild);
  assert.equal(
    (await finalize(first, nextJob, nextAttempt)).rows[0].id,
    nextBuild
  );
}
