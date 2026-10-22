import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { editFixture } from './edit-fixture.ts';

test('semantic queue, readonly poll, lease, ready candidate and exactly once CAS apply', async () => {
  const f = await editFixture();
  try {
    const key = randomUUID();
    const queued = (await f.queue(key)).rows[0].result;
    const id = queued.operationId;
    assert.deepEqual((await f.queue(key)).rows[0].result, queued);
    await assert.rejects(
      f.queue(key, 'Other instructions'),
      /IDEMPOTENCY_CONFLICT/
    );
    const poll = () =>
      f.call('builder_get_operation', [f.connection, 1, f.merchant, id]);
    assert.equal((await poll()).rows[0].result.status, 'pending');
    assert.equal(
      (
        await f.pool.query(
          'SELECT attempts FROM builder_authorization.builder_edit_operations WHERE id=$1',
          [id]
        )
      ).rows[0].attempts,
      0
    );
    const lease = (await f.claim(id)).rows[0].result;
    assert.equal(lease.sourceVersion, `draft:${f.version}`);
    assert.equal(lease.attempt, 1);
    assert.equal((await f.claim(id)).rows[0].result, null);
    const candidate = structuredClone(f.source);
    candidate.root.props.title = 'Edited';
    assert.equal(
      (await f.finish(id, lease.leaseId, 'ready', candidate)).rows[0].result
        .status,
      'ready'
    );
    const retry = randomUUID();
    const args = [f.connection, 1, f.merchant, id, f.version, retry];
    const applied = (await f.call('builder_apply_operation', args)).rows[0]
      .result;
    assert.equal(applied.status, 'draft');
    assert.notEqual(applied.version, `draft:${f.version}`);
    assert.deepEqual(
      (await f.call('builder_apply_operation', args)).rows[0].result,
      applied
    );
    assert.equal((await poll()).rows[0].result.status, 'applied');
    assert.equal(
      (
        await f.pool.query(
          'SELECT published_config FROM page_configs WHERE merchant_id=$1',
          [f.merchant]
        )
      ).rows[0].published_config,
      null
    );
    await assert.rejects(
      f.call(
        'builder_get_operation',
        [f.connection, 1, f.merchant, id],
        f.other
      ),
      /CONNECTION_REVOKED/
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT has_table_privilege('service_role','builder_authorization.builder_edit_operations','SELECT') allowed"
        )
      ).rows[0].allowed,
      false
    );
  } finally {
    await f.close();
  }
});
test('retry delays, lease expiry, old completion and three attempt exhaustion', async () => {
  const f = await editFixture();
  try {
    const id = (await f.queue()).rows[0].result.operationId;
    let lease = (await f.claim(id)).rows[0].result;
    await f.finish(id, lease.leaseId, 'transient', null);
    const row = async () =>
      (
        await f.pool.query(
          'SELECT status,attempts,round(extract(epoch FROM next_attempt_at-clock_timestamp())) delay FROM builder_authorization.builder_edit_operations WHERE id=$1',
          [id]
        )
      ).rows[0];
    assert.equal((await row()).delay, '60');
    assert.equal((await f.claim(id)).rows[0].result, null);
    await f.pool.query(
      "UPDATE builder_authorization.builder_edit_operations SET next_attempt_at=now()-interval '1 second' WHERE id=$1",
      [id]
    );
    const old = lease;
    lease = (await f.claim(id)).rows[0].result;
    await assert.rejects(f.finish(id, old.leaseId), /OPERATION_FAILED/);
    await f.finish(id, lease.leaseId, 'transient', null);
    assert.equal((await row()).delay, '120');
    await f.pool.query(
      "UPDATE builder_authorization.builder_edit_operations SET next_attempt_at=now()-interval '1 second' WHERE id=$1",
      [id]
    );
    lease = (await f.claim(id)).rows[0].result;
    assert.equal(lease.attempt, 3);
    await f.finish(id, lease.leaseId, 'transient', null);
    assert.equal((await row()).status, 'failed');
    assert.equal((await f.claim(id)).rows[0].result, null);
    const id2 = (await f.queue()).rows[0].result.operationId;
    lease = (await f.claim(id2)).rows[0].result;
    await f.pool.query(
      "UPDATE builder_authorization.builder_edit_operations SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
      [id2]
    );
    await assert.rejects(f.finish(id2, lease.leaseId), /OPERATION_FAILED/);
    const renewed = (await f.claim(id2)).rows[0].result;
    assert.notEqual(renewed.leaseId, lease.leaseId);
    assert.equal(renewed.attempt, 2);
  } finally {
    await f.close();
  }
});
test('stale source and revoked grant fence generation completion and replay', async () => {
  const f = await editFixture();
  try {
    const id = (await f.queue()).rows[0].result.operationId;
    const lease = (await f.claim(id)).rows[0].result;
    await f.pool.query(
      "UPDATE merchants SET business_name='New name' WHERE id=$1",
      [f.merchant]
    );
    assert.equal(
      (await f.finish(id, lease.leaseId)).rows[0].result.status,
      'conflict'
    );
    await f.providerPool.query(
      "UPDATE builder_authorization.connections SET status='revoked',revoked_at=now(),grant_version=2 WHERE id=$1",
      [f.connection]
    );
    await assert.rejects(f.finish(id, lease.leaseId), /CONNECTION_REVOKED/);
    await assert.rejects(
      f.call('builder_get_operation', [f.connection, 1, f.merchant, id]),
      /CONNECTION_REVOKED/
    );
  } finally {
    await f.close();
  }
});
