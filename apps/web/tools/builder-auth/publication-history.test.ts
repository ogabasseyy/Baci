// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { publicationFixture } from './publication-test-support';

let f: Awaited<ReturnType<typeof publicationFixture>>;
beforeEach(async () => {
  f = await publicationFixture();
}, 30000);
afterEach(async () => {
  await f?.close();
});
async function seed() {
  await f.pool.query(
    `UPDATE page_configs SET published_config='{"old":"live"}',published_seo='{"seo":"live"}',published_store_settings=NULL,published_setup_settings='{"setup":"live"}',is_published=true WHERE merchant_id=$1`,
    [f.merchantId]
  );
  await f.pool.query(
    `UPDATE builder_page_drafts SET draft_seo='{"seo":"pending"}',draft_store_settings='{"store":"pending"}',draft_setup_settings='{"setup":"pending"}' WHERE merchant_id=$1`,
    [f.merchantId]
  );
  await f.pool.query('UPDATE merchants SET is_published=true WHERE id=$1', [
    f.merchantId,
  ]);
}
it('publishes layout only, preserving every pending/private and unrelated published field', async () => {
  await seed();
  const before = (
    await f.pool.query(
      'SELECT * FROM builder_page_drafts WHERE merchant_id=$1',
      [f.merchantId]
    )
  ).rows[0];
  const fields = (
    await f.pool.query(
      'SELECT published_seo,published_store_settings,published_setup_settings FROM page_configs WHERE merchant_id=$1',
      [f.merchantId]
    )
  ).rows[0];
  const intent = await f.request();
  const id = intent.intentId as string;
  const proof = await f.proof(id);
  await f.owner((c) => f.run(c, 'builder_confirm_publication', [id, proof]));
  expect(
    (
      await f.pool.query(
        'SELECT * FROM builder_page_drafts WHERE merchant_id=$1',
        [f.merchantId]
      )
    ).rows[0]
  ).toEqual(before);
  expect(
    (
      await f.pool.query(
        'SELECT published_seo,published_store_settings,published_setup_settings FROM page_configs WHERE merchant_id=$1',
        [f.merchantId]
      )
    ).rows[0]
  ).toEqual(fields);
  const receipt = (
    await f.pool.query(
      'SELECT old_snapshot FROM builder_authorization.publication_receipts'
    )
  ).rows[0];
  expect(receipt.old_snapshot).toMatchObject({
    published_config: { old: 'live' },
    published_seo: { seo: 'live' },
    published_store_settings: null,
    published_setup_settings: { setup: 'live' },
  });
  expect(
    (await f.pool.query('SELECT config FROM page_config_history')).rows[0]
      .config
  ).toEqual({ old: 'live' });
});
it.each([
  'page_config_history',
  'builder_authorization.publication_audit',
])('rolls back the entire publication when %s fails', async (table) => {
  await seed();
  await f.pool.query(
    `CREATE FUNCTION public.fail_publication_fixture() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture_history_failure';END$$;CREATE TRIGGER fail_publication BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION public.fail_publication_fixture()`
  );
  const intent = await f.request();
  const id = intent.intentId as string;
  const proof = await f.proof(id);
  await expect(
    f.owner((c) => f.run(c, 'builder_confirm_publication', [id, proof]))
  ).rejects.toThrow('fixture_history_failure');
  expect(
    (
      await f.pool.query(
        'SELECT published_config FROM page_configs WHERE merchant_id=$1',
        [f.merchantId]
      )
    ).rows[0].published_config
  ).toEqual({ old: 'live' });
  expect(
    (
      await f.pool.query(
        'SELECT consumed_at FROM builder_authorization.publication_intents WHERE id=$1',
        [id]
      )
    ).rows[0].consumed_at
  ).toBeNull();
  expect(
    (
      await f.pool.query(
        'SELECT count(*)::int n FROM builder_authorization.publication_receipts'
      )
    ).rows[0].n
  ).toBe(0);
  expect(
    (
      await f.pool.query(
        'SELECT count(*)::int n FROM builder_authorization.publication_outbox'
      )
    ).rows[0].n
  ).toBe(0);
});
