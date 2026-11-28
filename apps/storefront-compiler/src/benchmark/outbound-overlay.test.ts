import { describe, expect, it } from 'vitest';
import { generateOgabasseyBackingCatalog } from './ogabassey-catalog-fixture';
import {
  applyVariantStockOverlayToJson,
  computeVariantStockOverlay,
} from './outbound-overlay';

describe('outbound-overlay', () => {
  it('computes variant stock overlays and synchronizes both inStock and available fields', () => {
    const rows = generateOgabasseyBackingCatalog(2);
    rows[0].variants[0].stockQty = 0;
    rows[0].variants[1].stockQty = 0;
    const cached = JSON.stringify({
      generation: 1,
      availabilityGeneration: 1,
      product: {
        id: rows[0].id,
        slug: rows[0].slug,
        name: rows[0].name,
        categorySlug: rows[0].categorySlug,
        categoryName: rows[0].categoryName,
        brand: rows[0].brand,
        condition: rows[0].condition,
        priceNgn: rows[0].priceNgn,
        inStock: true,
        available: true,
        imageUrl: rows[0].imageUrl,
        imageAlt: rows[0].imageAlt,
        shortSpecs: rows[0].shortSpecs,
        variants: rows[0].variants.map((v) => ({
          id: v.id,
          label: v.label,
          storage: v.storage,
          color: v.color,
          priceNgn: v.priceNgn,
          inStock: true,
          available: true,
        })),
      },
    });
    const overlay = computeVariantStockOverlay(rows, cached);
    const updated = JSON.parse(
      applyVariantStockOverlayToJson(cached, overlay, {
        coupled: 1,
        availability: 2,
      })
    ) as {
      availabilityGeneration: number;
      product: {
        inStock: boolean;
        available: boolean;
        variants: { inStock: boolean; available: boolean }[];
      };
    };
    expect(updated.availabilityGeneration).toBe(2);
    expect(updated.product.inStock).toBe(false);
    expect(updated.product.available).toBe(false);
    expect(
      updated.product.variants.every((v) => !v.inStock && !v.available)
    ).toBe(true);
  });
});
