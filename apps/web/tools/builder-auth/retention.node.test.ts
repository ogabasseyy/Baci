import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Pool } from 'pg';
import { deleteExpiredAuthRecords, startAuthRetention } from './retention.ts';
import { databaseFixture } from './test-fixtures.ts';

test('bounded broker cleanup removes only expired temporary records', async () => {
  const fixture = await databaseFixture();
  const pool = new Pool({
    ...fixture.pool.options,
    options: '-c role=baci_builder_auth_storage',
  });
  try {
    await fixture.pool.query(
      readFileSync(
        new URL(
          '../../../../supabase/migrations/20261113172936_builder_auth_retention_indexes.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    await fixture.pool.query(`
      INSERT INTO builder_authorization.transactions(id_hash,browser_hash,sealed,expires_at)
      VALUES ('expired-1','browser','{}',now()-interval '2 minutes'),
             ('expired-2','browser','{}',now()-interval '1 minute'),
             ('live','browser','{}',now()+interval '1 hour');
      INSERT INTO builder_authorization.provider_records(model,id,payload,expires_at)
      VALUES ('AccessToken','expired-1','{}',now()-interval '2 minutes'),
             ('AccessToken','expired-2','{}',now()-interval '1 minute'),
             ('AccessToken','live','{}',now()+interval '1 hour');
    `);
    assert.deepEqual(await deleteExpiredAuthRecords(pool, 1), {
      transactions: 1,
      providerRecords: 1,
    });
    assert.deepEqual(await deleteExpiredAuthRecords(pool, 1), {
      transactions: 1,
      providerRecords: 1,
    });
    assert.deepEqual(await deleteExpiredAuthRecords(pool, 1), {
      transactions: 0,
      providerRecords: 0,
    });
    assert.deepEqual(
      (
        await fixture.pool.query(
          'SELECT id_hash FROM builder_authorization.transactions'
        )
      ).rows,
      [{ id_hash: 'live' }]
    );
    assert.deepEqual(
      (
        await fixture.pool.query(
          'SELECT id FROM builder_authorization.provider_records'
        )
      ).rows,
      [{ id: 'live' }]
    );
    await assert.rejects(deleteExpiredAuthRecords(pool, 0), /invalid/i);
    await assert.rejects(deleteExpiredAuthRecords(pool, 1001), /invalid/i);
  } finally {
    await pool.end();
    await fixture.close();
  }
});

test('scheduled cleanup does not overlap and shutdown waits for the active batch', async () => {
  let tick = () => {};
  let release = () => {};
  let runs = 0;
  let cancelled = false;
  const work = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stop = startAuthRetention({
    run: async () => {
      runs++;
      await work;
    },
    schedule: (callback) => {
      tick = callback;
      return () => {
        cancelled = true;
      };
    },
  });
  tick();
  tick();
  assert.equal(runs, 1);
  let stopped = false;
  const closing = stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  assert.equal(stopped, false);
  assert.equal(cancelled, true);
  release();
  await closing;
  tick();
  assert.equal(runs, 1);
});
