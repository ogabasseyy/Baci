// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { publicationFixture } from './publication-test-support';

let f: Awaited<ReturnType<typeof publicationFixture>>;
beforeAll(async () => {
  f = await publicationFixture();
}, 30000);
afterAll(async () => {
  await f?.close();
});
it('requires a live owner, canonical grant, exact intent and independent render proof before any publish', async () => {
  const intent = await f.request();
  expect(intent).toMatchObject({ status: 'approval_required' });
  const id = intent.intentId as string;
  await expect(
    f.owner((c) => f.run(c, 'builder_confirm_publication', [id, randomUUID()]))
  ).rejects.toThrow('PREVIEW_REQUIRED');
  const proof = await f.proof(id);
  const result = await f.owner((c) =>
    f.run<Record<string, unknown>>(c, 'builder_confirm_publication', [
      id,
      proof,
    ])
  );
  expect(result).toMatchObject({
    status: 'verifying',
    storefrontId: f.merchantId,
  });
  expect(result.publishedVersion).not.toBe(result.version);
  const row = (
    await f.pool.query(
      "SELECT published_config,is_published FROM page_configs WHERE merchant_id=$1 AND page_slug='home'",
      [f.merchantId]
    )
  ).rows[0];
  expect(row.is_published).toBe(true);
  expect(row.published_config.root.props.title).toBe('Approval Fixture');
  const replay = await f.owner((c) =>
    f.run(c, 'builder_confirm_publication', [id, randomUUID()])
  );
  expect(replay).toEqual(result);
  expect(
    (
      await f.pool.query(
        'SELECT count(*)::int n FROM builder_authorization.publication_receipts'
      )
    ).rows[0].n
  ).toBe(1);
  expect(
    (
      await f.pool.query(
        'SELECT count(*)::int n FROM builder_authorization.publication_outbox'
      )
    ).rows[0].n
  ).toBe(1);
});
