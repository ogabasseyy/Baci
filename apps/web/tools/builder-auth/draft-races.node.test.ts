import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { asActor, draftFixture } from './draft-fixture.ts';

const input = {
  businessName: 'Race Store',
  businessType: 'electronics',
  country: 'NG',
  requestedSlug: 'race-store',
};
const config = {
  root: { props: { rendererVersion: 'baci-home-six-v1', title: 'Race' } },
  content: [],
};
test('simultaneous retry has one effect; revoke wins before write/replay; retention is fail closed', async () => {
  const f = await draftFixture();
  const a = await f.pool.connect();
  const b = await f.pool.connect();
  const revoker = await f.providerPool.connect();
  try {
    const actor = randomUUID();
    const connection = randomUUID();
    const retry = randomUUID();
    await f.pool.query('INSERT INTO auth.users VALUES($1)', [actor]);
    await f.pool.query(
      "INSERT INTO builder_authorization.connections(id,actor_user_id,provider_grant_id,scopes,allow_create_store,expires_at) VALUES($1::uuid,$2,$1::text,ARRAY['storefront.read','storefront.write'],true,now()+interval '1 hour')",
      [connection, actor]
    );
    const begin = async (client: typeof a) => {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='5s'");
      const pid = Number(
        (await client.query('SELECT pg_backend_pid() pid')).rows[0].pid
      );
      await client.query('SET LOCAL ROLE authenticated');
      await client.query("SELECT set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({
          sub: actor,
          role: 'authenticated',
          email: 'fixture@example.test',
        }),
      ]);
      return pid;
    };
    const create = (client: typeof a) =>
      client.query('SELECT builder_create_draft($1,1,$2,$3,$4) result', [
        connection,
        retry,
        input,
        config,
      ]);
    async function blocked(pid: number) {
      for (let i = 0; i < 200; i++) {
        if (
          (
            await f.pool.query(
              'SELECT cardinality(pg_blocking_pids($1))>0 blocked',
              [pid]
            )
          ).rows[0].blocked
        )
          return;
        await delay(5);
      }
      assert.fail('Expected the explicit transaction barrier');
    }
    await begin(a);
    const first = (await create(a)).rows[0].result;
    const pid = await begin(b);
    const duplicate = create(b);
    await blocked(pid);
    await a.query('COMMIT');
    assert.deepEqual((await duplicate).rows[0].result, first);
    await b.query('COMMIT');
    assert.equal(
      (
        await f.pool.query('SELECT count(*) FROM merchants WHERE user_id=$1', [
          actor,
        ])
      ).rows[0].count,
      '1'
    );
    assert.equal(
      (
        await f.pool.query(
          'SELECT count(*) FROM builder_authorization.mutation_evidence WHERE connection_id=$1',
          [connection]
        )
      ).rows[0].count,
      '1'
    );
    await f.pool.query(
      "UPDATE builder_authorization.mutation_evidence SET created_at=now()-interval '8 days' WHERE connection_id=$1",
      [connection]
    );
    await assert.rejects(
      asActor(a, actor, () => create(a)),
      /OPERATION_FAILED/
    );
    // A revoker locks the canonical row first. The captured request must wait and then fail.
    await revoker.query('BEGIN');
    await revoker.query(
      "UPDATE builder_authorization.connections SET status='revoked',revoked_at=now(),grant_version=2 WHERE id=$1",
      [connection]
    );
    const waitingPid = await begin(a);
    const waiting = create(a);
    const rejected = assert.rejects(waiting, /CONNECTION_REVOKED/);
    await blocked(waitingPid);
    await revoker.query('COMMIT');
    await rejected;
    await a.query('ROLLBACK');
    assert.equal(
      (
        await f.pool.query('SELECT count(*) FROM merchants WHERE user_id=$1', [
          actor,
        ])
      ).rows[0].count,
      '1'
    );
  } finally {
    await a.query('ROLLBACK');
    await b.query('ROLLBACK');
    await revoker.query('ROLLBACK');
    a.release();
    b.release();
    revoker.release();
    await f.close();
  }
});
