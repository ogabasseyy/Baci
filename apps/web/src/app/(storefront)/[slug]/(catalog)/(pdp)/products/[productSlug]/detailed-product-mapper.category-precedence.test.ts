import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storefront-product-variants', () => ({
  normalizeStorefrontProductVariants: () => [],
}));

vi.mock('@/lib/seo-utils', () => ({
  generateSlug: (value: string) => value.toLowerCase().replace(/\s+/g, '-'),
  getProductUrl: (product: {
    category_slug?: string | null;
    id: string;
    slug?: string | null;
  }) =>
    product.category_slug
      ? `/${product.category_slug}/${product.slug || product.id}`
      : `/products/${product.slug || product.id}`,
}));

import { mapDetailedCachedProductToProduct } from './detailed-product-mapper';

describe('mapDetailedCachedProductToProduct category precedence', () => {
  it('uses a slug-only joined camera category before stale legacy phone text', () => {
    const product = mapDetailedCachedProductToProduct(
      {
        id: 'slug-only-camera',
        merchant_id: 'merchant-1',
        name: 'Action Camera',
        status: 'active',
        slug: 'action-camera',
        price: 100,
        images: [],
        category: 'Smartphones',
        categories: { id: 'camera-category', slug: 'action-cameras' },
        product_variants: [],
        specifications: null,
        product_key_specs: null,
      },
      'merchant-1'
    );

    expect(product).toMatchObject({
      category: 'action-cameras',
      category_slug: 'action-cameras',
      categories: { id: 'camera-category', slug: 'action-cameras' },
    });
  });

  it('derives the category slug from a name-only joined category before stale legacy text', () => {
    const product = mapDetailedCachedProductToProduct(
      {
        id: 'name-only-camera',
        merchant_id: 'merchant-1',
        name: 'Mirrorless Camera',
        status: 'active',
        slug: 'mirrorless-camera',
        price: 100,
        images: [],
        category: 'Smartphones',
        categories: { id: 'camera-category', name: 'Cameras' },
        product_variants: [],
        specifications: null,
        product_key_specs: null,
      },
      'merchant-1'
    );

    expect(product).toMatchObject({
      category: 'Cameras',
      category_slug: 'cameras',
    });
  });

  it('ignores padded joined category slugs before deriving a usable fallback', () => {
    const product = mapDetailedCachedProductToProduct(
      {
        id: 'padded-camera-category',
        merchant_id: 'merchant-1',
        name: 'Action Camera',
        status: 'active',
        slug: 'action-camera',
        price: 100,
        images: [],
        category: 'Smartphones',
        categories: { id: 'camera-category', name: 'Cameras', slug: '   ' },
        product_variants: [],
        specifications: null,
        product_key_specs: null,
      },
      'merchant-1'
    );

    expect(product).toMatchObject({
      category: 'Cameras',
      category_slug: 'cameras',
    });
  });

  it('rejects placeholder joined slugs before deriving a usable fallback slug', () => {
    const product = mapDetailedCachedProductToProduct(
      {
        id: 'unknown-slug-camera',
        merchant_id: 'merchant-1',
        name: 'Action Camera',
        status: 'active',
        slug: 'action-camera',
        price: 100,
        images: [],
        category: 'Action Cameras',
        categories: { id: 'camera-category', slug: 'unknown' },
        product_variants: [],
        specifications: null,
        product_key_specs: null,
      },
      'merchant-1'
    );

    expect(product).toMatchObject({
      category: 'Action Cameras',
      category_slug: 'action-cameras',
    });
  });

  it('preserves joined category slugs that contain reserved delimiters', () => {
    const product = mapDetailedCachedProductToProduct(
      {
        id: 'encoded-slug-category',
        merchant_id: 'merchant-1',
        name: 'Smart Watch',
        status: 'active',
        slug: 'smart-watch',
        price: 100,
        images: [],
        category: 'Smart Watches',
        categories: {
          id: 'watch-category',
          slug: 'smart?watches#gps',
        },
        product_variants: [],
        specifications: null,
        product_key_specs: null,
      },
      'merchant-1'
    );

    expect(product.category_slug).toBe('smart?watches#gps');
  });
});
