import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { asActor, experienceSqlFixture } from './fixture.ts';

test('fixture preserves the signed actor/session correlation without reviving a revoked session', async () => {
  const f = await experienceSqlFixture();
  const actor = randomUUID();
  const c = await f.pool.connect();
  try {
    await f.pool.query('INSERT INTO auth.users(id) VALUES($1)', [actor]);
    const read = () =>
      asActor(c, actor, () =>
        c.query("SELECT auth.uid() actor,auth.jwt()->>'session_id' session")
      );
    const first = (await read()).rows[0];
    assert.equal(first.actor, actor);
    await f.pool.query('DELETE FROM auth.sessions WHERE id=$1', [
      first.session,
    ]);
    assert.equal((await read()).rows[0].session, first.session);
    assert.equal(
      (await f.pool.query('SELECT count(*) FROM auth.sessions')).rows[0].count,
      '0'
    );
  } finally {
    c.release();
    await f.close();
  }
});
