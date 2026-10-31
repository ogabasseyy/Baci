// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildSyntheticCatalog,
  SYNTHETIC_PRODUCT_SCENARIOS,
} from './synthetic-catalog';
import {
  SYNTHETIC_MERCHANT_A,
  SYNTHETIC_MERCHANT_B,
} from './synthetic-merchants';

describe('buildSyntheticCatalog', () => {
  const catalogA = buildSyntheticCatalog(SYNTHETIC_MERCHANT_A);
  const catalogB = buildSyntheticCatalog(SYNTHETIC_MERCHANT_B);

  it('gives both merchants the same four products under different ids', () => {
    for (const scenario of SYNTHETIC_PRODUCT_SCENARIOS) {
      const [a, b] = [catalogA[scenario], catalogB[scenario]];

      expect(b.product.name).toBe(a.product.name);
      expect(b.row.slug).toBe(a.row.slug);
      expect(b.priceMajor).toBe(a.priceMajor);
      expect(b.stockState).toBe(a.stockState);
      expect(b.product.id).not.toBe(a.product.id);
      expect(b.row.merchant_id).toBe(SYNTHETIC_MERCHANT_B.context.id);
    }
  });

  it('keeps the product, the UCP row and the variant of a scenario in step', () => {
    for (const entry of Object.values(catalogA)) {
      expect(entry.row.id).toBe(entry.product.id);
      expect(entry.row.price).toBe(entry.product.price);
      expect(entry.row.manage_stock).toBe(entry.product.manage_stock);
      expect(entry.row.stock).toBe(entry.product.stock);
      if (entry.variant) {
        expect(entry.variant.product?.name).toBe(entry.product.name);
        expect(entry.variant.product?.price).toBe(entry.product.price);
        expect(entry.variant.product?.manage_stock).toBe(
          entry.product.manage_stock
        );
      }
    }
  });

  it('gives a variant only to the two stock scenarios', () => {
    expect(catalogA.kobo_price.variant).toBeNull();
    expect(catalogA.refurbished.variant).toBeNull();
    expect(catalogA.out_of_stock_variant.variant).not.toBeNull();
    expect(catalogA.unknown_stock_variant.variant).not.toBeNull();
  });

  it('leaves manage_stock null only for the untracked scenario', () => {
    expect(catalogA.unknown_stock_variant.stockState).toBe('unknown');
    expect(catalogA.unknown_stock_variant.product.manage_stock).toBeNull();
    for (const scenario of [
      'kobo_price',
      'refurbished',
      'out_of_stock_variant',
    ] as const) {
      expect(catalogA[scenario].product.manage_stock).toBe(true);
    }
  });

  it('derives a hyphenated slug from each product name', () => {
    expect(catalogA.kobo_price.row.slug).toBe('kobo-phone');
    expect(catalogA.refurbished.row.slug).toBe('refurbished-laptop');
  });
});
