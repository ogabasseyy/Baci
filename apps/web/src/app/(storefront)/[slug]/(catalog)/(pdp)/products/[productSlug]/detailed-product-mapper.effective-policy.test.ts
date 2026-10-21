import { describe, expect, it, vi } from 'vitest';

const normalizeVariantsMock = vi.hoisted(() => vi.fn(() => []));
vi.mock('@/lib/storefront-product-variants', () => ({
  normalizeStorefrontProductVariants: normalizeVariantsMock,
}));

vi.mock('@/lib/seo-utils', () => {
  const generateSlug = (value: string) =>
    value.toLowerCase().replace(/\s+/g, '-');

  return {
    generateSlug,
    getProductUrl: (product: {
      canonical_url?: string | null;
      category?: string | null;
      category_slug?: string | null;
      id: string;
      name: string;
      slug?: string | null;
    }) => {
      if (product.canonical_url) {
        try {
          return new URL(product.canonical_url, 'https://storefront.invalid')
            .pathname;
        } catch {
          // Fall back to the slug route below.
        }
      }

      const productSlug =
        product.slug ||
        (product.name ? generateSlug(product.name) : product.id);
      const categorySlug =
        product.category_slug ||
        (product.category ? generateSlug(product.category) : undefined);

      return categorySlug
        ? `/${categorySlug}/${productSlug}`
        : `/products/${productSlug}`;
    },
  };
});

import { normalizeStorefrontProductVariants } from '@/lib/storefront-product-variants';
import { mapDetailedCachedProductToProduct } from './detailed-product-mapper';

describe('mapDetailedCachedProductToProduct effective policy', () => {
  it('maps the snapshot-emitted effective policy for anchor-strict products', () => {
    const product = mapDetailedCachedProductToProduct(
      {
        id: 'product-1',
        merchant_id: 'merchant-1',
        name: 'Anchor Strict Phone',
        price: 100,
        stock: 2,
        manage_stock: true,
        inventory_tracking_policy: 'off',
        effective_policy: 'serialized_strict',
        product_variants: [],
      } as never,
      'merchant-1'
    );

    expect(product.effective_policy).toBe('serialized_strict');
    expect(product.inventory_tracking_policy).toBe('off');
  });

  it('leaves effective policy undefined on stale snapshots without the key', () => {
    const product = mapDetailedCachedProductToProduct(
      {
        id: 'product-1',
        merchant_id: 'merchant-1',
        name: 'Legacy Phone',
        price: 100,
        stock: 5,
        manage_stock: true,
        inventory_tracking_policy: 'off',
        product_variants: [],
      } as never,
      'merchant-1'
    );

    expect(product.effective_policy).toBeUndefined();
  });
});
