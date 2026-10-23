// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { asActor, draftFixture } from './draft-fixture';

it('drains pending, running and processing legacy jobs before dropping draft columns', async () => {
  const f = await draftFixture({ cutover: false });
  const c = await f.pool.connect();
  try {
    for (const status of ['pending', 'running', 'processing']) {
      await f.pool.query(
        "INSERT INTO ai_jobs(type,status) VALUES('storefront_layout_generation',$1)",
        [status]
      );
      await c.query('BEGIN');
      await c.query("SET LOCAL baci.builder_private_cutover='approved'");
      await expect(
        c.query('CALL builder_authorization.cutover_private_drafts()')
      ).rejects.toThrow('legacy_job_drain');
      await c.query('ROLLBACK');
      expect(
        (
          await f.pool.query(
            "SELECT count(*) FROM information_schema.columns WHERE table_name='page_configs' AND column_name='draft_config'"
          )
        ).rows[0].count
      ).toBe('1');
      await f.pool.query('DELETE FROM ai_jobs');
    }
    await c.query('BEGIN');
    await c.query("SET LOCAL baci.builder_private_cutover='approved'");
    await c.query('CALL builder_authorization.cutover_private_drafts()');
    await c.query('COMMIT');
  } finally {
    await c.query('ROLLBACK');
    c.release();
    await f.close();
  }
}, 30000);

it('sets country currency on both new stores and empty placeholders', async () => {
  const f = await draftFixture();
  const c = await f.pool.connect();
  try {
    for (const placeholder of [false, true])
      for (const [country, currency] of [
        ['NG', 'NGN'],
        ['GH', 'GHS'],
        ['US', 'USD'],
      ]) {
        const actor = randomUUID();
        const connection = randomUUID();
        const slug = `fixture-${randomUUID()}`;
        await f.pool.query('INSERT INTO auth.users VALUES($1)', [actor]);
        await f.pool.query(
          "INSERT INTO builder_authorization.connections(id,actor_user_id,provider_grant_id,scopes,allow_create_store,expires_at) VALUES($1::uuid,$2,$1::text,ARRAY['storefront.read','storefront.write'],true,now()+interval '1 hour')",
          [connection, actor]
        );
        if (placeholder)
          await f.pool.query(
            'INSERT INTO merchants(id,user_id) VALUES($1,$2)',
            [randomUUID(), actor]
          );
        await asActor(c, actor, () =>
          c.query('SELECT builder_create_draft($1,1,$2,$3,$4)', [
            connection,
            randomUUID(),
            {
              businessName: 'Fixture store',
              businessType: 'electronics',
              country,
              requestedSlug: slug,
            },
            {
              root: { props: { rendererVersion: 'baci-home-six-v1' } },
              content: [],
            },
          ])
        );
        expect(
          (
            await f.pool.query(
              'SELECT country,payout_currency FROM merchants WHERE user_id=$1',
              [actor]
            )
          ).rows[0]
        ).toEqual({ country, payout_currency: currency });
      }
  } finally {
    c.release();
    await f.close();
  }
}, 30000);
