import { describe, expect, it } from 'vitest';
import {
  executeSimulatedAnonCatalogRpc,
  projectSafeProduct,
} from './anon-catalog-rpc';
import { generateOgabasseyBackingCatalog } from './ogabassey-catalog-fixture';

describe('anon-catalog-rpc', () => {
  it('projects public fields without leaking costPriceNgn and matches /v1/product?sku= strictly against actual SKUs', () => {
    const rows = generateOgabasseyBackingCatalog(5);
    const safe = projectSafeProduct(rows[0]);
    expect(JSON.stringify(safe)).not.toContain('costPriceNgn');
    expect(safe.variants[0]?.sku).toBe(rows[0].variants[0]?.sku);

    // Slug must NEVER satisfy ?sku= when no top-level or variant SKU matches!
    const slugAsSkuRes = JSON.parse(
      executeSimulatedAnonCatalogRpc(
        new URL(`https://catalog.baci.internal/v1/product?sku=${rows[0].slug}`),
        'm1',
        rows,
        { coupled: 1, availability: 2 }
      )
    ) as { product: unknown };
    expect(slugAsSkuRes.product).toBeNull();

    const realVariantSku = rows[0].variants[0]?.sku ?? '';
    const realSkuRes = JSON.parse(
      executeSimulatedAnonCatalogRpc(
        new URL(
          `https://catalog.baci.internal/v1/product?sku=${encodeURIComponent(realVariantSku)}`
        ),
        'm1',
        rows,
        { coupled: 1, availability: 2 }
      )
    ) as { product: { id: string } | null };
    expect(realSkuRes.product?.id).toBe(rows[0].id);
  });
});
