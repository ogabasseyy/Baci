// @vitest-environment node
import { expect, it } from 'vitest';
import { publicationFixture } from './publication-test-support';

it('stamps existing publication writers without exposing raw revisions or a reusable definer', async () => {
  const f = await publicationFixture();
  const writer = await f.pool.connect();
  try {
    const token = async () =>
      (
        await f.pool.query(
          'SELECT token FROM builder_published_revisions WHERE merchant_id=$1',
          [f.merchantId]
        )
      ).rows[0]?.token;
    await f.pool.query(
      'GRANT SELECT(id,merchant_id) ON page_configs TO service_role; GRANT SELECT(id) ON merchants TO service_role; GRANT UPDATE(published_config,is_published) ON page_configs TO service_role; GRANT UPDATE(is_published) ON merchants TO service_role'
    );
    await writer.query('BEGIN');
    await writer.query('SET LOCAL ROLE service_role');
    await writer.query(
      `UPDATE page_configs SET published_config='{"legacy":"live"}',is_published=true WHERE merchant_id=$1`,
      [f.merchantId]
    );
    await writer.query('COMMIT');
    const first = await token();
    expect(first).toBeDefined();
    await writer.query('BEGIN');
    await writer.query('SET LOCAL ROLE service_role');
    await writer.query('UPDATE merchants SET is_published=true WHERE id=$1', [
      f.merchantId,
    ]);
    await writer.query('COMMIT');
    expect(await token()).not.toBe(first);
    const rights = (
      await f.pool.query(
        `SELECT has_table_privilege('service_role','public.builder_published_revisions','INSERT') raw, has_function_privilege('authenticated','public.builder_observe_publication()','EXECUTE') callable`
      )
    ).rows[0];
    expect(rights).toEqual({ raw: false, callable: false });
    await f.pool.query(
      'CREATE TEMP TABLE forged_revision(merchant_id uuid); CREATE TRIGGER forged AFTER INSERT ON forged_revision FOR EACH ROW EXECUTE FUNCTION public.builder_observe_publication()'
    );
    await expect(
      f.pool.query('INSERT INTO forged_revision VALUES($1)', [f.merchantId])
    ).rejects.toThrow('invalid_revision_trigger_origin');
  } finally {
    await writer.query('ROLLBACK');
    writer.release();
    await f.close();
  }
}, 30000);
