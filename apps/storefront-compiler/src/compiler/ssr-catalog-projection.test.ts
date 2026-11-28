import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildSsrCatalogProjectionSnippet } from './ssr-catalog-projection';

describe('ssr-catalog-projection', () => {
  it('normalizes SSR product prices, requiresVariant, and namespaces colliding declared asset IDs', () => {
    const ctx: Record<string, unknown> = {
      ASSETS_MAP: { 'hero-banner': '/assets/hero-banner' },
      EMPTY_FACETS: { brands: [], conditions: [], totalMatches: 0 },
      isFiniteNumber: (v: unknown) =>
        typeof v === 'number' && Number.isFinite(v),
      Array,
      Object,
      Boolean,
      String,
    };
    vm.runInNewContext(
      `${buildSsrCatalogProjectionSnippet()}\nglobalThis.normProd = normalizeSsrCatalogProduct; globalThis.normFacets = normalizeSsrCatalogFacets;`,
      ctx
    );
    const normProd = ctx.normProd as (
      p: Record<string, unknown>
    ) => Record<string, unknown>;
    const projected = normProd({
      id: 'p1',
      slug: 'phone',
      name: 'Phone',
      priceNgn: 500000,
      imageUrl: 'https://cdn.usebaci.com/p1.webp',
      image: { assetId: 'hero-banner', alt: 'Phone' },
      variants: [{ id: 'v1', label: '128GB', priceNgn: 500000, inStock: true }],
    });
    expect(projected.price).toBe(500000);
    expect(projected.requiresVariant).toBe(true);
    expect((projected.image as { assetId: string }).assetId).toBe(
      'catalog-product-p1'
    );
  });
});
