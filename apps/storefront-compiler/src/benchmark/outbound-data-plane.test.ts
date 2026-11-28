import { describe, expect, it } from 'vitest';
import {
  generateOgabasseyBackingCatalog,
  type PublicProjectedProduct,
} from './ogabassey-catalog-fixture';
import { SimulatedPostgrestOutboundPlane } from './outbound-data-plane';

describe('outbound-data-plane', () => {
  it('merges per-variant stock flips in split-availability mode on cache HIT while blocking non-catalog hosts', async () => {
    const merchantId = '00000000-0000-4000-8000-000000000001';
    const products = generateOgabasseyBackingCatalog(10);
    products[0].variants[0].stockQty = 5;
    products[0].variants[1].stockQty = 3;

    const plane = new SimulatedPostgrestOutboundPlane({
      merchantId,
      products,
      generationSampleTtlMs: 15_000,
    });
    const pdpUrl = `https://catalog.baci.internal/v1/product?category=${products[0].categorySlug}&productSlug=${products[0].slug}`;

    const first = await plane.handleOutboundFetch(
      new Request(pdpUrl),
      { merchantId, merchantSlug: 'ogabassey' },
      'split-availability'
    );
    expect(first.status).toBe(200);
    expect(plane.telemetry.originCatalogRpcCalls).toBe(1);

    plane.recordInventoryWrite(merchantId, 0, 0);
    plane.advanceClockMs(15_001);

    const second = await plane.handleOutboundFetch(
      new Request(pdpUrl),
      { merchantId, merchantSlug: 'ogabassey' },
      'split-availability'
    );
    expect(second.headers.get('x-baci-cache')).toBe('HIT');
    const body = (await second.json()) as { product: PublicProjectedProduct };
    expect(body.product.inStock).toBe(false);
    expect(plane.telemetry.originCatalogRpcCalls).toBe(1);
  });
});
