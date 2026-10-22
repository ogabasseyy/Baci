// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadStoreLaunchReadiness } from '../../src/lib/store-readiness/load-store-launch-readiness';
import { getStorePublicationMissingItems } from '../../src/lib/store-readiness/store-publication-missing-items';
import { publicationRlsClient } from './publication-rls-client';
import { publicationFixture } from './publication-test-support';

let f: Awaited<ReturnType<typeof publicationFixture>>;
beforeAll(async () => {
  f = await publicationFixture();
}, 30000);
afterAll(async () => {
  await f?.close();
});
it('keeps authoritative SQL blockers equal to normal-owner readiness across launch states', async () => {
  const client = publicationRlsClient(f.actor, f.owner);
  for (const [country, pod, kora, currency] of [
    ['US', true, false, 'USD'],
    ['NG', false, false, 'NGN'],
    ['NG', true, false, 'NGN'],
    ['GH', false, true, 'GHS'],
    ['US', false, true, 'USD'],
    ['', false, false, 'NGN'],
  ] as const) {
    await f.pool.query(
      'UPDATE merchants SET country=$1,payout_currency=$2 WHERE id=$3',
      [country, currency, f.merchantId]
    );
    await f.pool.query(
      'UPDATE merchant_feature_settings SET pay_on_delivery_enabled=$1,korapay_enabled=$2 WHERE merchant_id=$3',
      [pod, kora, f.merchantId]
    );
    const actual = await loadStoreLaunchReadiness({
      supabase: client,
      merchantId: f.merchantId,
    });
    const sql = await f.owner(
      async (c) =>
        (
          await c.query(
            'SELECT builder_authorization.publication_missing_items($1) result',
            [f.merchantId]
          )
        ).rows[0].result
    );
    expect(sql).toEqual(getStorePublicationMissingItems(actual));
  }
});
