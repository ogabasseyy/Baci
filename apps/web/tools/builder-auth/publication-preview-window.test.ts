// @vitest-environment node
import { expect, it } from 'vitest';
import { createPrivateHome } from '../../src/lib/website-builder/create-private-home';
import { loadPreviewData } from '../../src/lib/website-builder/preview-data';
import { createLifecycleHarness } from '../../tests/builder-chatgpt/lifecycle.test-utils';

it('binds the same newest-first 24 products and ID tie-breaker as the public homepage', async () => {
  const f = await createLifecycleHarness();
  try {
    await f.pool.query('DELETE FROM products WHERE merchant_id=$1', [
      f.merchantId,
    ]);
    await f.pool.query(
      `INSERT INTO products(id,merchant_id,name,price,slug,status,images,created_at)
      SELECT ('30000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,$1,'Product '||i,100,'product-'||i,'active','[]',timestamptz '2026-10-01'+((i-1)/2)*interval '1 hour' FROM generate_series(1,26) i`,
      [f.merchantId]
    );
    const result = await loadPreviewData(
      f.ctx,
      createPrivateHome('Store'),
      await f.version()
    );
    const expected = Array.from({ length: 12 }, (_, i) => [
      25 - i * 2,
      26 - i * 2,
    ])
      .flat()
      .map((i) => `30000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(
      result.projection.catalog.products.map((product) => product.id)
    ).toEqual(expected);
  } finally {
    await f.close();
  }
}, 30000);
