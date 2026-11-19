import { describe, expect, it } from 'vitest';
import type { CachedProductLcpHint } from '@/lib/cached-data';
import {
  buildCriticalCommerceRouteProduct,
  getCachedProductRoutePrimaryImage,
  mapCachedProductLcpHintToRouteProduct,
} from './category-product-lcp-projection';

function cachedHint(overrides: Partial<CachedProductLcpHint> = {}) {
  return {
    id: 'product-1',
    merchant_id: 'merchant-1',
    name: 'Phone X',
    status: 'active',
    price: '1,200,000',
    compare_at_price: '1,500,000',
    stock: 8,
    stock_quantity: 8,
    manage_stock: false,
    images: [{ url: 'https://cdn.example/base.avif' }],
    categories: { id: 'cat-1', name: 'Phones', slug: 'phones' },
    product_categories: [
      { categories: { id: 'cat-2', name: 'Fallback', slug: 'fallback' } },
    ],
    product_variants: [
      {
        id: 'variant-expensive',
        status: 'active',
        is_active: true,
        price_override: 1_400_000,
        stock_quantity: 3,
        primary_image: 'https://cdn.example/expensive.avif',
        attributes: { storage: '256GB' },
      },
      {
        id: 'variant-cheapest',
        status: 'active',
        is_active: true,
        price_override: 1_100_000,
        stock_quantity: 2,
        primary_image: 'https://cdn.example/cheapest.avif',
        attributes: { storage: '128GB' },
      },
    ],
    ...overrides,
  } as CachedProductLcpHint & { status: string };
}

describe('cached category PDP projection', () => {
  it('projects sale prices, canonical category, global cheapest variant image, and inventory facts', () => {
    const product = mapCachedProductLcpHintToRouteProduct(cachedHint());

    expect(product).toMatchObject({
      base_price: 1_500_000,
      category: 'Phones',
      category_slug: 'phones',
      compare_at_price: 1_500_000,
      has_variants: true,
      has_variant_matrix: true,
      image: 'https://cdn.example/cheapest.avif',
      imageLarge: 'https://cdn.example/cheapest.avif',
      manage_stock: false,
      max_variant_price: undefined,
      min_variant_price: undefined,
      price: 1_200_000,
      sale_price: 1_200_000,
      stock: 8,
      stock_quantity: 8,
    });
    expect(getCachedProductRoutePrimaryImage(cachedHint())).toBe(
      'https://cdn.example/cheapest.avif'
    );
  });

  it('gives primary canonical category precedence over legacy flat category string', () => {
    const product = mapCachedProductLcpHintToRouteProduct(
      cachedHint({
        category: 'Old Legacy Category',
        categories: {
          id: 'cat-canonical',
          name: 'Canonical Smartphones',
          slug: 'smartphones',
        },
      })
    );
    expect(product.category).toBe('Canonical Smartphones');
  });

  it('keeps denormalized price ranges only for unmanaged stock and defaults nullable tracking to managed', () => {
    const unmanaged = mapCachedProductLcpHintToRouteProduct(
      cachedHint({
        max_variant_price: '1,400,000',
        min_variant_price: '1,100,000',
      })
    );
    expect(unmanaged).toMatchObject({
      manage_stock: false,
      max_variant_price: 1_400_000,
      min_variant_price: 1_100_000,
    });

    const managed = mapCachedProductLcpHintToRouteProduct(
      cachedHint({
        manage_stock: null,
        max_variant_price: 1_400_000,
        min_variant_price: 1_100_000,
      })
    );
    expect(managed).toMatchObject({
      manage_stock: true,
      max_variant_price: undefined,
      min_variant_price: undefined,
    });
  });

  it('falls back to legacy image and id when variant or canonical hint fields are absent', () => {
    const product = mapCachedProductLcpHintToRouteProduct(
      cachedHint({
        categories: null,
        product_categories: null,
        product_variants: [],
        slug: null,
      })
    );

    expect(product).toMatchObject({
      category: undefined,
      category_slug: undefined,
      id: 'product-1',
      image: 'https://cdn.example/base.avif',
      slug: 'product-1',
    });
  });

  it('carries the tracking policy for the critical offer pool cap', () => {
    const product = mapCachedProductLcpHintToRouteProduct(
      cachedHint({ inventory_tracking_policy: 'serialized_strict' })
    );

    expect(product.inventory_tracking_policy).toBe('serialized_strict');
    expect(
      mapCachedProductLcpHintToRouteProduct(
        cachedHint({ inventory_tracking_policy: undefined })
      ).inventory_tracking_policy
    ).toBeNull();
  });

  it('normalizes critical commerce copy and nullable numeric fields for rendering', () => {
    expect(
      buildCriticalCommerceRouteProduct({
        ...mapCachedProductLcpHintToRouteProduct(
          cachedHint({
            meta_description:
              'Current listed price is NGN 1,200,000. Great phone.',
          })
        ),
        compare_at_price: undefined,
        max_variant_price: undefined,
        min_variant_price: undefined,
        price: null,
      })
    ).toMatchObject({
      compare_at_price: undefined,
      description: 'Great phone.',
      max_variant_price: undefined,
      min_variant_price: undefined,
      price: 0,
    });
  });

  it('selects cellular variant image by default for phones and respects explicit variant searchParams', () => {
    const mixedPhoneHint = cachedHint({
      name: 'iPhone 15',
      category: 'Phones',
      categories: { id: 'cat-phones', name: 'Phones', slug: 'phones' },
      product_variants: [
        {
          id: 'variant-wifi',
          product_id: 'product-1',
          price_override: 900_000,
          stock_quantity: 5,
          primary_image: 'https://cdn.example/wifi.avif',
          attributes: { connectivity: 'Wi-Fi only', storage: '128GB' },
        },
        {
          id: 'variant-cellular',
          product_id: 'product-1',
          price_override: 1_100_000,
          stock_quantity: 5,
          primary_image: 'https://cdn.example/cellular.avif',
          attributes: { connectivity: 'Cellular', storage: '128GB' },
        },
      ],
    });

    expect(getCachedProductRoutePrimaryImage(mixedPhoneHint)).toBe(
      'https://cdn.example/cellular.avif'
    );

    expect(
      getCachedProductRoutePrimaryImage(mixedPhoneHint, undefined, {
        variantId: 'variant-wifi',
      })
    ).toBe('https://cdn.example/wifi.avif');

    const product = mapCachedProductLcpHintToRouteProduct(mixedPhoneHint);
    expect(product.category).toBe('Phones');
    expect(product.image).toBe('https://cdn.example/cellular.avif');
  });
});
