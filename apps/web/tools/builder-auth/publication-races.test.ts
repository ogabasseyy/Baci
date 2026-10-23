// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { publicationFixture } from './publication-test-support';

let f: Awaited<ReturnType<typeof publicationFixture>>;
beforeEach(async () => {
  f = await publicationFixture();
}, 30000);
afterEach(async () => {
  await f?.close();
});
it('serializes duplicate confirmations and deduplicates identical effects with different retry keys', async () => {
  const a = await f.request();
  const secondKey = randomUUID();
  const b = await f.request(secondKey);
  const p = await f.proof(a.intentId as string);
  const q = await f.proof(b.intentId as string);
  const results = await Promise.all([
    f.owner((c) => f.run(c, 'builder_confirm_publication', [a.intentId, p])),
    f.owner((c) => f.run(c, 'builder_confirm_publication', [b.intentId, q])),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(await f.request(secondKey, b.version as string)).toEqual(results[0]);
  expect(
    (
      await f.pool.query(
        'SELECT count(*)::int n FROM builder_authorization.publication_receipts'
      )
    ).rows[0].n
  ).toBe(1);
});
it('fails concurrent readiness/private/native writers at the common nonblocking website guard', async () => {
  const a = await f.request();
  const p = await f.proof(a.intentId as string);
  const client = await f.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('baci.website:'||$1,0))",
      [f.merchantId]
    );
    await expect(
      f.owner((c) => f.run(c, 'builder_confirm_publication', [a.intentId, p]))
    ).rejects.toMatchObject({ code: '40001' });
    await expect(
      f.pool.query("UPDATE products SET status='draft' WHERE merchant_id=$1", [
        f.merchantId,
      ])
    ).rejects.toMatchObject({ code: '40001' });
    await expect(
      f.pool.query(
        'UPDATE merchant_feature_settings SET pay_on_delivery_enabled=false WHERE merchant_id=$1',
        [f.merchantId]
      )
    ).rejects.toMatchObject({ code: '40001' });
    await expect(
      f.pool.query(
        'UPDATE builder_page_drafts SET draft_config=draft_config WHERE merchant_id=$1',
        [f.merchantId]
      )
    ).rejects.toMatchObject({ code: '40001' });
    await expect(
      f.pool.query(
        'UPDATE page_configs SET is_published=true WHERE merchant_id=$1',
        [f.merchantId]
      )
    ).rejects.toMatchObject({ code: '40001' });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect(
    (
      await f.pool.query(
        'SELECT count(*)::int n FROM builder_authorization.publication_receipts'
      )
    ).rows[0].n
  ).toBe(0);
});
