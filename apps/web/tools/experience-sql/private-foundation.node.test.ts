import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { asActor, experienceSqlFixture as draftFixture } from './fixture.ts';

const migration = new URL(
  '../../../../supabase/migrations/20261024072905_experience_private_foundation.sql',
  import.meta.url
);
test('private-foundation: owner-only immutable source and authority denial', async () => {
  const f = await draftFixture();
  try {
    await f.pool.query(readFileSync(migration, 'utf8'));
    const a = randomUUID();
    const b = randomUUID();
    const staff = randomUUID();
    const m = randomUUID();
    await f.pool.query('INSERT INTO auth.users(id) VALUES($1),($2),($3)', [
      a,
      b,
      staff,
    ]);
    await f.pool.query('INSERT INTO merchants(id,user_id) VALUES($1,$2)', [
      m,
      a,
    ]);
    await f.pool.query(
      "INSERT INTO experience_artifacts(merchant_id,source_digest,manifest) VALUES($1,repeat('a',64),'{}')",
      [m]
    );
    const c = await f.pool.connect();
    try {
      const result = await asActor(c, a, () =>
        c.query('SELECT public.experience_require_owner($1,null,null)', [m])
      );
      assert.ok(result);
      assert.equal(
        (
          await asActor(c, a, () =>
            c.query('SELECT count(*) FROM experience_artifacts')
          )
        ).rows[0].count,
        '1'
      );
      for (const actor of [b, staff])
        await assert.rejects(
          asActor(c, actor, () =>
            c.query('SELECT public.experience_require_owner($1,null,null)', [m])
          ),
          /NOT_FOUND/
        );
      for (const table of [
        'experience_artifacts',
        'experience_source_files',
        'experience_builds',
        'experience_evidence',
        'experience_approvals',
        'experience_draft_heads',
        'experience_published_heads',
      ]) {
        await assert.rejects(
          asActor(c, a, () =>
            c.query(`INSERT INTO public.${table} DEFAULT VALUES`)
          ),
          /permission denied/
        );
        const read = await asActor(c, b, () =>
          c.query(`SELECT count(*) FROM public.${table}`)
        );
        assert.equal(read.rows[0].count, '0');
      }
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE anon');
      await assert.rejects(
        c.query('SELECT id FROM public.experience_artifacts'),
        /permission denied/
      );
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE service_role');
      await assert.rejects(
        c.query('SELECT public.experience_require_owner($1,null,null)', [m]),
        /permission denied/
      );
      await c.query('ROLLBACK');
      await f.pool.query(
        "UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE user_id=$1",
        [a]
      );
      await assert.rejects(
        asActor(c, a, () =>
          c.query('SELECT public.experience_require_owner($1,null,null)', [m])
        ),
        /NOT_FOUND/
      );
      assert.equal(
        (
          await asActor(c, a, () =>
            c.query('SELECT count(*) FROM experience_artifacts')
          )
        ).rows[0].count,
        '0'
      );
      await f.pool.query('DELETE FROM auth.sessions WHERE user_id=$1', [a]);
      await assert.rejects(
        asActor(c, a, () =>
          c.query('SELECT public.experience_require_owner($1,null,null)', [m])
        ),
        /NOT_FOUND/
      );
      await f.pool.query(
        readFileSync(
          new URL(
            '../../../../supabase/tests/experience/private-foundation.sql',
            import.meta.url
          ),
          'utf8'
        )
      );
    } finally {
      c.release();
    }
  } finally {
    await f.close();
  }
});
