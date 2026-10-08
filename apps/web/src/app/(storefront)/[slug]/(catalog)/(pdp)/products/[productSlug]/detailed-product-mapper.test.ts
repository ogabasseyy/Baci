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

describe('mapDetailedCachedProductToProduct', () => {
  it('passes parent effective stock so null variant quantities inherit', () => {
    normalizeVariantsMock.mockClear();
    mapDetailedCachedProductToProduct(
      {
        id: 'product-1',
        merchant_id: 'merchant-1',
        name: 'Widget',
        stock_quantity: 6,
        product_variants: [{ id: 'variant-1', stock_quantity: null }],
      } as never,
      'merchant-1'
    );
    expect(normalizeStorefrontProductVariants).toHaveBeenCalledWith(
      [{ id: 'variant-1', stock_quantity: null }],
      expect.objectContaining({ parentStock: 6 })
    );
  });

  it('defaults detailed products to manage_stock false while keeping stock', () => {
    const product = mapDetailedCachedProductToProduct(
      {
        id: 'prod-2',
        merchant_id: 'merchant-1',
        name: 'Galaxy S24',
        description: null,
        status: 'active',
        slug: 'galaxy-s24',
        meta_title: 'Galaxy S24 Price in Nigeria',
        meta_description: 'Compare Galaxy S24 prices and specs.',
        keywords: ['galaxy s24 price in nigeria'],
        schema_markup: {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: 'Galaxy S24',
        },
        google_product_category: 'Electronics > Communications > Telephony',
        price: '600000',
        compare_at_price: '650000',
        min_variant_price: 590000,
        max_variant_price: 740000,
        manage_stock: null,
        stock: 0,
        stock_quantity: '7',
        images: [],
        imageHint: null,
        brand: null,
        gtin: null,
        mpn: null,
        category: 'Smart Phones',
        categories: null,
        product_variants: [],
        specifications: null,
        product_key_specs: null,
      },
      'merchant-1'
    );

    expect(product).toMatchObject({
      slug: 'galaxy-s24',
      meta_title: 'Galaxy S24 Price in Nigeria',
      meta_description: 'Compare Galaxy S24 prices and specs.',
      keywords: ['galaxy s24 price in nigeria'],
      schema_markup: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Galaxy S24',
      },
      google_product_category: 'Electronics > Communications > Telephony',
      price: 600000,
      compare_at_price: 650000,
      min_variant_price: 590000,
      max_variant_price: 740000,
      manage_stock: false,
      stock: 7,
      category: 'Smart Phones',
      category_slug: 'smart-phones',
    });
  });

  it('flattens embedded key-spec relation rows for detailed cached products', () => {
    const product = mapDetailedCachedProductToProduct(
      {
        id: 'prod-detailed-key-specs',
        merchant_id: 'merchant-1',
        name: 'Galaxy S25',
        description: null,
        status: 'active',
        slug: 'galaxy-s25',
        price: 950000,
        compare_at_price: null,
        manage_stock: true,
        stock: 3,
        stock_quantity: 3,
        images: [],
        imageHint: null,
        brand: null,
        gtin: null,
        mpn: null,
        category: 'Phones',
        categories: null,
        product_variants: [],
        specifications: null,
        product_key_specs: [
          {
            chipset: 'Snapdragon',
            has_5g: true,
            battery_mah: 5000,
          },
        ],
      },
      'merchant-1'
    );

    expect(product.product_key_specs).toEqual({
      chipset: 'Snapdragon',
      has_5g: true,
      battery_mah: 5000,
    });
  });

  it('extracts primary category from categories array', () => {
    const detailedProduct = {
      id: 'prod-3',
      merchant_id: 'merchant-1',
      name: 'Pixel 9',
      description: null,
      status: 'active',
      slug: 'pixel-9',
      price: 700000,
      compare_at_price: null,
      manage_stock: true,
      stock: 3,
      stock_quantity: 3,
      images: [],
      imageHint: null,
      brand: null,
      gtin: null,
      mpn: null,
      category: null,
      categories: [
        {
          id: 'cat-2',
          name: 'Smartphones',
          slug: 'smartphones',
          parent_id: null,
        },
        {
          id: 'cat-3',
          name: 'Android Phones',
          slug: 'android-phones',
          parent_id: 'cat-2',
        },
      ],
      product_variants: [],
      specifications: null,
      product_key_specs: null,
      internal_only_flag: 'should-not-leak',
    };

    const product = mapDetailedCachedProductToProduct(
      detailedProduct,
      'merchant-1'
    );

    expect(product).toMatchObject({
      category: 'Smartphones',
      category_slug: 'smartphones',
      categories: {
        id: 'cat-2',
        name: 'Smartphones',
        slug: 'smartphones',
        parent_id: undefined,
      },
    });
    expect(product).not.toHaveProperty('internal_only_flag');
  });

  it('maps has_condition_offers and offers from detailed product', () => {
    const product = mapDetailedCachedProductToProduct(
      {
        id: 'prod-4',
        merchant_id: 'merchant-1',
        name: 'iPhone 14',
        description: null,
        status: 'active',
        slug: 'iphone-14',
        price: 800000,
        compare_at_price: null,
        manage_stock: false,
        stock: 10,
        stock_quantity: 10,
        images: [],
        imageHint: null,
        brand: null,
        gtin: null,
        mpn: null,
        category: 'Phones',
        categories: null,
        product_variants: [],
        specifications: null,
        product_key_specs: null,
        has_condition_offers: true,
        offers: [
          {
            id: 'o1',
            condition: 'used',
            price: 500000,
            stock_quantity: 9999,
            status: 'active',
          },
        ],
      },
      'merchant-1'
    );

    expect(product.has_condition_offers).toBe(true);
    expect(product.offers).toEqual([
      {
        id: 'o1',
        condition: 'used',
        price: 500000,
        stock_quantity: 9999,
        status: 'active',
      },
    ]);
  });

  it('normalizes invalid status, zero compare price, and malformed offers', () => {
    const product = mapDetailedCachedProductToProduct(
      {
        id: 'prod-edge',
        merchant_id: 'merchant-1',
        name: 'Promo Phone',
        status: 'published',
        price: 'abc',
        compare_at_price: '0',
        stock_quantity: null,
        images: [],
        category: null,
        categories: [{ id: 'cat-edge' } as never],
        product_key_specs: [{ unexpected: 'x' }],
        offers: [
          { id: 'inactive', condition: 'used', price: 1, status: 'archived' },
          { id: 'bad-price', condition: 'used', price: null, status: 'active' },
          {
            id: 'bad-condition',
            condition: 'fair' as never,
            price: 1,
            status: 'active',
          },
          { id: 'active', condition: 'used', price: '0', status: 'active' },
        ],
      },
      'merchant-1'
    );

    expect(product).toMatchObject({
      status: 'active',
      price: 0,
      compare_at_price: 0,
    });
    expect(product.offers).toEqual([
      {
        id: 'active',
        condition: 'used',
        price: 0,
        stock_quantity: 0,
        status: 'active',
      },
    ]);
  });
});
