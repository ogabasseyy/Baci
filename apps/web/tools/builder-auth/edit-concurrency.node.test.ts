import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { asActor, editFixture } from './edit-fixture.ts';

test('two replicas claim one lease; ready apply loses to concurrent edit', async () => {
  const f = await editFixture();
  const a = await f.pool.connect();
  const b = await f.pool.connect();
  try {
    const id = (await f.queue()).rows[0].result.operationId;
    const claim = (c: typeof a) =>
      asActor(c, f.actor, () =>
        c.query('SELECT builder_claim_edit($1,1,$2,$3) result', [
          f.connection,
          f.merchant,
          id,
        ])
      ) as Promise<{ rows: { result: { leaseId: string } | null }[] }>;
    const claims = await Promise.all([claim(a), claim(b)]);
    assert.equal(claims.filter((c) => c.rows[0].result !== null).length, 1);
    const lease = claims.find((c) => c.rows[0].result !== null)?.rows[0].result;
    assert.ok(lease);
    await f.finish(id, lease.leaseId);
    await f.pool.query(
      "UPDATE merchants SET logo_url='https://example.test/logo.png' WHERE id=$1",
      [f.merchant]
    );
    const retryKey = randomUUID();
    const result = (
      await f.call('builder_apply_operation', [
        f.connection,
        1,
        f.merchant,
        id,
        f.version,
        retryKey,
      ])
    ).rows[0].result;
    assert.equal(result.code, 'STALE_DRAFT');
    assert.deepEqual(
      (
        await f.call('builder_apply_operation', [
          f.connection,
          1,
          f.merchant,
          id,
          f.version,
          retryKey,
        ])
      ).rows[0].result,
      result
    );
    await assert.rejects(
      f.call('builder_apply_operation', [
        f.connection,
        1,
        f.merchant,
        id,
        f.version,
        randomUUID(),
      ]),
      /IDEMPOTENCY_CONFLICT/
    );
    assert.equal(
      (await f.call('builder_get_operation', [f.connection, 1, f.merchant, id]))
        .rows[0].result.status,
      'conflict'
    );
  } finally {
    a.release();
    b.release();
    await f.close();
  }
});
test('durable per-user quota applies across operations and retries; stale grant cannot finish', async () => {
  const f = await editFixture();
  try {
    const id = (await f.queue()).rows[0].result.operationId;
    await f.pool.query(
      'INSERT INTO builder_authorization.edit_quota(actor_user_id,attempts) VALUES($1,10)',
      [f.actor]
    );
    assert.equal((await f.claim(id)).rows[0].result, null);
    assert.equal(
      (
        await f.pool.query(
          'SELECT attempts FROM builder_authorization.builder_edit_operations WHERE id=$1',
          [id]
        )
      ).rows[0].attempts,
      0
    );
    await f.pool.query(
      "UPDATE builder_authorization.edit_quota SET window_start=now()-interval '2 minutes' WHERE actor_user_id=$1",
      [f.actor]
    );
    const lease = (await f.claim(id)).rows[0].result;
    assert.equal(
      (
        await f.pool.query(
          'SELECT attempts FROM builder_authorization.edit_quota WHERE actor_user_id=$1',
          [f.actor]
        )
      ).rows[0].attempts,
      1
    );
    await f.providerPool.query(
      'UPDATE builder_authorization.connections SET grant_version=2 WHERE id=$1',
      [f.connection]
    );
    await assert.rejects(f.finish(id, lease.leaseId), /CONNECTION_REVOKED/);
    await assert.rejects(
      f.call('builder_get_operation', [f.connection, 1, f.merchant, id]),
      /CONNECTION_REVOKED/
    );
    // Even a fresh version may not complete an operation created by an older grant.
    await assert.rejects(
      f.call('builder_finish_edit', [
        f.connection,
        2,
        f.merchant,
        id,
        lease.leaseId,
        'ready',
        f.source,
      ]),
      /NOT_FOUND/
    );
  } finally {
    await f.close();
  }
});
test('expired/crashed operations cannot run forever; unsupported template fails before claim', async () => {
  const f = await editFixture();
  try {
    const id = (await f.queue()).rows[0].result.operationId;
    const lease = (await f.claim(id)).rows[0].result;
    const expiry = Date.parse(String(lease.leaseExpiresAt));
    assert.ok(expiry > Date.now() + 290000 && expiry <= Date.now() + 301000);
    await f.pool.query(
      "UPDATE builder_authorization.builder_edit_operations SET attempts=3,lease_expires_at=now()-interval '1 second' WHERE id=$1",
      [id]
    );
    assert.equal((await f.claim(id)).rows[0].result, null);
    assert.equal(
      (await f.call('builder_get_operation', [f.connection, 1, f.merchant, id]))
        .rows[0].result.status,
      'failed'
    );
    const expired = (await f.queue()).rows[0].result.operationId;
    await f.pool.query(
      "UPDATE builder_authorization.builder_edit_operations SET expires_at=now()-interval '1 second' WHERE id=$1",
      [expired]
    );
    assert.equal(
      (
        await f.call('builder_get_operation', [
          f.connection,
          1,
          f.merchant,
          expired,
        ])
      ).rows[0].result.status,
      'failed'
    );
    await assert.rejects(f.claim(expired), /OPERATION_FAILED/);
    await f.pool.query(
      "UPDATE merchants SET template_id='legacy' WHERE id=$1",
      [f.merchant]
    );
    const current = (
      await f.pool.query(
        'SELECT token FROM builder_website_revisions WHERE merchant_id=$1',
        [f.merchant]
      )
    ).rows[0].token;
    await assert.rejects(
      f.call('builder_queue_edit', [
        f.connection,
        1,
        f.merchant,
        current,
        randomUUID(),
        'Edit',
      ]),
      /UNSUPPORTED_TEMPLATE/
    );
  } finally {
    await f.close();
  }
});
test('an apply retry key cannot alias another ready operation with an identical candidate', async () => {
  const f = await editFixture();
  try {
    const first = (await f.queue()).rows[0].result.operationId;
    const second = (await f.queue()).rows[0].result.operationId;
    const one = (await f.claim(first)).rows[0].result;
    await f.finish(first, one.leaseId);
    const two = (await f.claim(second)).rows[0].result;
    await f.finish(second, two.leaseId);
    const key = randomUUID();
    await f.call('builder_apply_operation', [
      f.connection,
      1,
      f.merchant,
      first,
      f.version,
      key,
    ]);
    await assert.rejects(
      f.call('builder_apply_operation', [
        f.connection,
        1,
        f.merchant,
        second,
        f.version,
        key,
      ]),
      /IDEMPOTENCY_CONFLICT/
    );
  } finally {
    await f.close();
  }
});
test('a modified ready candidate cannot pass its server-generated digest', async () => {
  const f = await editFixture();
  try {
    const id = (await f.queue()).rows[0].result.operationId;
    const lease = (await f.claim(id)).rows[0].result;
    await f.finish(id, lease.leaseId);
    const prepared = (
      await f.call('builder_prepare_apply', [f.connection, 1, f.merchant, id])
    ).rows[0].result;
    assert.match(String(prepared.candidateDigest), /^[a-f0-9]{64}$/);
    await f.pool.query(
      "UPDATE builder_authorization.builder_edit_operations SET candidate=jsonb_set(candidate,'{root,props,title}','\"Tampered\"') WHERE id=$1",
      [id]
    );
    await assert.rejects(
      f.call('builder_apply_operation', [
        f.connection,
        1,
        f.merchant,
        id,
        f.version,
        randomUUID(),
      ]),
      /OPERATION_FAILED/
    );
  } finally {
    await f.close();
  }
});
test('inherited public-table defaults cannot grant raw delete/truncate rights after private move', async () => {
  const { draftFixture } = await import('./draft-fixture.ts');
  const { readFileSync } = await import('node:fs');
  const f = await draftFixture();
  try {
    await f.pool.query(
      'GRANT ALL ON public.builder_edit_operations TO authenticated'
    );
    await f.pool.query(
      readFileSync(
        new URL(
          '../../../../supabase/migrations/20261022103000_builder_async_edits.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    const row = (
      await f.pool.query(
        "SELECT has_table_privilege('authenticated','builder_authorization.builder_edit_operations','DELETE') d,has_table_privilege('authenticated','builder_authorization.builder_edit_operations','TRUNCATE') t"
      )
    ).rows[0];
    assert.equal(row.d, false);
    assert.equal(row.t, false);
  } finally {
    await f.close();
  }
});
