import { describe, expect, it } from 'vitest';
import type { Product as StorefrontProduct } from '@/lib/products';
import { OGABASSEY_HOME_PRODUCT_DESCRIPTION_TEASER_LIMIT } from './config/products';
import { mapStorefrontProductsToOgabasseyProducts } from './home-product-feed';

function createStorefrontProduct(
  overrides: Partial<StorefrontProduct>
): StorefrontProduct {
  return {
    id: 'product-1',
    name: 'Test Product',
    description: 'Test description',
    status: 'active',
    price: 100000,
    manage_stock: true,
    stock: 5,
    image: '/default.jpg',
    imageLarge: '/default-large.jpg',
    imageHint: 'Test product',
    brand: 'Baci',
    gtin: '',
    mpn: '',
    ...overrides,
  };
}

describe('mapStorefrontProductsToOgabasseyProducts', () => {
  it('maps storefront products into the compact Ogabassey card-feed shape', () => {
    const result = mapStorefrontProductsToOgabasseyProducts([
      createStorefrontProduct({
        id: 'iphone-1',
        name: 'iPhone 17 Pro Max',
        slug: 'iphone-17-pro-max',
        description: 'Flagship phone',
        price: 2100000,
        image: '/iphone-black.jpg',
        rating: 4.9,
        category: 'Smartphones',
        category_id: 'cat-1',
        category_slug: 'smartphones',
        categories: {
          id: 'cat-1',
          name: 'Smartphones',
          slug: 'smartphones',
        },
        condition: 'open_box',
        colors: ['Black', 'Gold'],
        storage_options: ['512GB'],
        images: [
          { url: '/iphone-black.jpg', alt: 'Black', order: 0 },
          { url: '/iphone-gold.jpg', alt: 'Gold', order: 1 },
        ],
      }),
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'iphone-1',
        slug: 'iphone-17-pro-max',
        name: 'iPhone 17 Pro Max',
        price: '₦2,100,000',
        rawPrice: 2100000,
        image: '/iphone-black.jpg',
        image_alt: 'Black',
        image_payloads: [
          { url: '/iphone-black.jpg', alt: 'Black' },
          { url: '/iphone-gold.jpg', alt: 'Gold' },
        ],
        description: 'Flagship phone',
        rating: 4.9,
        category: 'Smartphones',
        categorySlug: 'smartphones',
        condition: 'Open Box',
        colors: ['Black', 'Gold'],
        storage: '512GB',
        images: ['/iphone-black.jpg', '/iphone-gold.jpg'],
      }),
    ]);
    expect(result[0]).not.toHaveProperty('categories');
    expect(result[0]).not.toHaveProperty('has_condition_offers');
  });

  it('strips markup, drops the SEO price question, and truncates long descriptions', () => {
    const longTail = 'A'.repeat(400);
    const result = mapStorefrontProductsToOgabasseyProducts([
      createStorefrontProduct({
        description: `<h2>What is the iPhone 17 Price in Nigeria?</h2><p>Great   phone.</p><p>${longTail}</p>`,
      }),
    ]);

    expect(result[0].description).toHaveLength(
      OGABASSEY_HOME_PRODUCT_DESCRIPTION_TEASER_LIMIT
    );
    expect(result[0].description.startsWith('Great phone.')).toBe(true);
    expect(result[0].description).not.toContain('<');
    expect(result[0].description).not.toContain('Price in Nigeria');
  });

  it('omits the rating instead of fabricating a default', () => {
    const [
      withoutRating,
      withZeroRating,
      withInfiniteRating,
      withNaNRating,
      withRealRating,
    ] = mapStorefrontProductsToOgabasseyProducts([
      createStorefrontProduct({ rating: undefined }),
      createStorefrontProduct({ rating: 0 }),
      createStorefrontProduct({ rating: Number.POSITIVE_INFINITY }),
      createStorefrontProduct({ rating: Number.NaN }),
      createStorefrontProduct({ rating: 4.2 }),
    ]);

    expect(withoutRating).not.toHaveProperty('rating');
    expect(withZeroRating).not.toHaveProperty('rating');
    expect(withInfiniteRating).not.toHaveProperty('rating');
    expect(withNaNRating).not.toHaveProperty('rating');
    expect(withRealRating).toEqual(expect.objectContaining({ rating: 4.2 }));
  });

  it('keeps the raw description in full mode for server-only consumers', () => {
    const rawDescription = `<h2>What is the iPhone 17 Price in Nigeria?</h2><p>${'B'.repeat(300)}</p>`;
    const result = mapStorefrontProductsToOgabasseyProducts(
      [createStorefrontProduct({ description: rawDescription })],
      undefined,
      { descriptionMode: 'full' }
    );

    expect(result[0].description).toBe(rawDescription);
  });

  it('marks condition-offer products as New & Used and falls back sensibly', () => {
    const result = mapStorefrontProductsToOgabasseyProducts([
      createStorefrontProduct({
        id: 'mixed-1',
        name: 'Galaxy S30',
        price: 950000,
        category: undefined,
        categories: null,
        image: '',
        has_condition_offers: true,
        images: [{ url: '/galaxy.jpg', alt: 'Galaxy', order: 0 }],
      }),
    ]);

    expect(result[0]).toEqual(
      expect.objectContaining({
        category: 'General',
        condition: 'New & Used',
        has_condition_offers: true,
        image: '/galaxy.jpg',
        image_alt: 'Galaxy',
      })
    );
  });

  it('does not assign alt text from a different image payload', () => {
    const result = mapStorefrontProductsToOgabasseyProducts([
      createStorefrontProduct({
        image: '/front.jpg',
        images: [
          '/front.jpg',
          { url: '/back.jpg', alt: 'Back view', order: 1 },
        ] as unknown as StorefrontProduct['images'],
      }),
    ]);

    expect(result[0]).toEqual(
      expect.objectContaining({
        image: '/front.jpg',
      })
    );
    expect(result[0]).not.toHaveProperty('image_alt');
  });

  it('keeps only alt-bearing image payload entries for rendered-image alt lookup', () => {
    const result = mapStorefrontProductsToOgabasseyProducts([
      createStorefrontProduct({
        image: '/front.jpg',
        images: [
          '/front.jpg',
          { url: '/back.jpg', alt: 'Back view', order: 1 },
          { url: '/side.jpg', order: 2 },
        ] as unknown as StorefrontProduct['images'],
      }),
    ]);

    expect(result[0].image_payloads).toEqual([
      { url: '/back.jpg', alt: 'Back view' },
    ]);
    expect(result[0].images).toEqual(['/front.jpg', '/back.jpg', '/side.jpg']);
  });

  it('omits image_payloads entirely when no entry carries alt text', () => {
    const result = mapStorefrontProductsToOgabasseyProducts([
      createStorefrontProduct({
        image: '/front.jpg',
        images: ['/front.jpg'] as unknown as StorefrontProduct['images'],
      }),
    ]);

    expect(result[0]).not.toHaveProperty('image_payloads');
  });

  it('formats the card price in a non-NGN merchant currency when supplied', () => {
    const result = mapStorefrontProductsToOgabasseyProducts(
      [
        createStorefrontProduct({
          id: 'india-1',
          name: 'Redmi Note',
          price: 999900,
        }),
      ],
      { code: 'INR', symbol: '₹', locale: 'en-IN' }
    );

    expect(result[0]).toEqual(
      expect.objectContaining({
        price: '₹9,99,900',
        rawPrice: 999900,
      })
    );
  });
});
