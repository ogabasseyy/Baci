import assert from 'node:assert/strict';
import { Client } from 'pg';
export async function verifyMediaConcurrency(configuration, observer) {
  const writer = new Client(configuration);
  const deleter = new Client(configuration);
  const merchant = '36690000-0000-4000-8000-000000000031';
  const object = '36690000-0000-4000-8000-000000000032';
  const product = '36690000-0000-4000-8000-000000000033';
  const actor = '36690000-0000-4000-8000-000000000034';
  const path = `${merchant}/concurrent.webp`;
  const claim = () =>
    deleter.query('SELECT * FROM public.claim_merchant_media_deletion($1,$2)', [
      merchant,
      object,
    ]);
  async function blocked(connection) {
    const {
      rows: [{ pid }],
    } = await connection.query('SELECT pg_backend_pid() AS pid');
    return pid;
  }
  async function observeLock(pid) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const { rows } = await observer.query(
        "SELECT wait_event_type='Lock' AS blocked FROM pg_stat_activity WHERE pid=$1",
        [pid]
      );
      if (rows[0]?.blocked) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail('expected the actual media reference gate lock');
  }
  try {
    await Promise.all([writer.connect(), deleter.connect()]);
    for (const connection of [writer, deleter])
      await connection.query(
        "SELECT set_config('request.jwt.claim.sub',$1,false)",
        [actor]
      );
    await observer.query(
      'INSERT INTO public.merchants(id,user_id) VALUES($1,$2)',
      [merchant, actor]
    );
    await observer.query(
      "INSERT INTO public.products(id,merchant_id,images) VALUES($1,$2,'[]')",
      [product, merchant]
    );
    await observer.query(
      "INSERT INTO storage.objects(id,bucket_id,name) VALUES($1,'media',$2)",
      [object, path]
    );
    await observer.query(
      "INSERT INTO storage.objects(id,bucket_id,name) VALUES('36690000-0000-4000-8000-000000000035','media',$1)",
      [`${merchant}/not-claimed.webp`]
    );
    const writerPid = await blocked(writer);
    const deleterPid = await blocked(deleter);
    await writer.query('BEGIN');
    await writer.query(
      'UPDATE public.products SET images=$1::jsonb WHERE id=$2',
      [JSON.stringify([path]), product]
    );
    const waitingClaim = claim().then(
      () => null,
      (error) => error
    );
    await observeLock(deleterPid);
    await writer.query('COMMIT');
    assert.equal((await waitingClaim)?.message, 'media_in_use');
    await observer.query("UPDATE public.products SET images='[]' WHERE id=$1", [
      product,
    ]);
    await deleter.query('BEGIN');
    const admitted = await claim();
    assert.equal(admitted.rows[0].state, 'pending');
    await writer.query('BEGIN');
    const waitingWrite = writer
      .query('UPDATE public.products SET images=$1::jsonb WHERE id=$2', [
        JSON.stringify([path]),
        product,
      ])
      .then(
        () => null,
        (error) => error
      );
    await observeLock(writerPid);
    await deleter.query('COMMIT');
    assert.equal((await waitingWrite)?.message, 'media_pending_deletion');
    await writer.query('ROLLBACK');
    // Exercise authenticated Storage RLS on metadata in this owned empty cluster.
    // This simulates the API's metadata transaction; it is not file-byte proof.
    // A snapshot taken before a claim cannot miss its permanent tombstone.
    const staleObject = '36690000-0000-4000-8000-000000000036';
    const stalePath = `${merchant}/stale-snapshot.webp`;
    await observer.query(
      "INSERT INTO storage.objects(id,bucket_id,name) VALUES($1,'media',$2)",
      [staleObject, stalePath]
    );
    await writer.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await writer.query('SELECT id FROM public.products WHERE id=$1', [product]);
    await deleter.query(
      'SELECT * FROM public.claim_merchant_media_deletion($1,$2)',
      [merchant, staleObject]
    );
    await assert.rejects(
      writer.query('UPDATE public.products SET images=$1::jsonb WHERE id=$2', [
        JSON.stringify([stalePath]),
        product,
      ]),
      { code: '40001' }
    );
    await writer.query('ROLLBACK');
    await deleter.query('SET ROLE authenticated');
    const forbidden = await deleter.query(
      'DELETE FROM storage.objects WHERE name=$1 RETURNING id',
      [`${merchant}/not-claimed.webp`]
    );
    assert.equal(forbidden.rowCount, 0);
    assert.equal(
      (
        await observer.query('SELECT id FROM storage.objects WHERE name=$1', [
          `${merchant}/not-claimed.webp`,
        ])
      ).rowCount,
      1
    );
    const removed = await deleter.query(
      'DELETE FROM storage.objects WHERE id=$1 RETURNING id',
      [object]
    );
    assert.equal(removed.rowCount, 1);
    const completed = await deleter.query(
      'SELECT public.complete_merchant_media_deletion($1,$2) AS done',
      [merchant, path]
    );
    assert.equal(completed.rows[0].done, true);
    assert.equal((await claim()).rows[0].state, 'deleted');
    await assert.rejects(
      writer.query('UPDATE public.products SET images=$1::jsonb WHERE id=$2', [
        JSON.stringify([path]),
        product,
      ]),
      { message: 'media_pending_deletion' }
    );
  } finally {
    await Promise.allSettled([
      writer.query('ROLLBACK'),
      deleter.query('ROLLBACK'),
    ]);
    await Promise.all([writer.end(), deleter.end()]);
  }
}
