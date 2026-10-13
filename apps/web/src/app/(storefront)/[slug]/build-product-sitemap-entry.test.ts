import { describe, expect, it } from 'vitest';
import { buildProductSitemapEntry } from './build-product-sitemap-entry';

describe('buildProductSitemapEntry', () => {
  it('preserves the canonical category path and valid image URLs', () => {
    expect(
      buildProductSitemapEntry({
        product: {
          id: 'product-1',
          slug: 'linen-shirt',
          category: 'Fashion',
          canonical_url: null,
          images: [
            'https://cdn.example.com/linen-shirt.jpg',
            { url: 'not-an-absolute-url' },
          ],
          updated_at: '2026-08-01T00:00:00.000Z',
          categories: { slug: 'fashion' },
        },
        storeUrl: 'https://zorvexa.usebaci.com',
      })
    ).toEqual({
      url: 'https://zorvexa.usebaci.com/fashion/linen-shirt',
      lastModified: new Date('2026-08-01T00:00:00.000Z'),
      changeFrequency: 'weekly',
      priority: 0.8,
      images: ['https://cdn.example.com/linen-shirt.jpg'],
    });
  });

  it('derives the sitemap URL when the stored canonical path is stale', () => {
    const entry = buildProductSitemapEntry({
      product: {
        id: 'product-1',
        name: 'Linen Shirt',
        slug: 'linen-shirt',
        category: 'Fashion',
        canonical_url: '/old/linen-shirt',
        images: [],
        updated_at: null,
        categories: { slug: 'fashion' },
      },
      storeUrl: 'https://zorvexa.usebaci.com',
    });

    expect(entry.url).toBe('https://zorvexa.usebaci.com/fashion/linen-shirt');
  });

  it('uses a junction category when legacy products have no direct category', () => {
    const entry = buildProductSitemapEntry({
      product: {
        id: 'product-legacy-category',
        name: 'Legacy Laptop',
        slug: 'legacy-laptop',
        category: null,
        canonical_url: '/laptops/legacy-laptop',
        images: [],
        updated_at: null,
        categories: null,
        product_categories: [{ categories: { slug: 'laptops' } }],
      },
      storeUrl: 'https://zorvexa.usebaci.com',
    });

    expect(entry.url).toBe('https://zorvexa.usebaci.com/laptops/legacy-laptop');
  });

  it('keeps the direct category ahead of the junction category', () => {
    const entry = buildProductSitemapEntry({
      product: {
        id: 'product-direct-category',
        name: 'Direct Laptop',
        slug: 'direct-laptop',
        category: null,
        canonical_url: null,
        images: [],
        updated_at: null,
        categories: { slug: 'featured-laptops' },
        product_categories: [{ categories: { slug: 'laptops' } }],
      },
      storeUrl: 'https://zorvexa.usebaci.com',
    });

    expect(entry.url).toBe(
      'https://zorvexa.usebaci.com/featured-laptops/direct-laptop'
    );
  });

  it('keeps an active junction category ahead of legacy text without a direct join', () => {
    const entry = buildProductSitemapEntry({
      product: {
        id: 'product-legacy-text-category',
        name: 'Legacy Category Laptop',
        slug: 'legacy-category-laptop',
        category: 'Laptops',
        canonical_url: null,
        images: [],
        updated_at: null,
        categories: null,
        product_categories: [{ categories: { slug: 'featured-laptops' } }],
      },
      storeUrl: 'https://zorvexa.usebaci.com',
    });

    expect(entry.url).toBe(
      'https://zorvexa.usebaci.com/featured-laptops/legacy-category-laptop'
    );
  });

  it('uses the resolvable product id when an active sitemap product has no slug', () => {
    const entry = buildProductSitemapEntry({
      product: {
        id: '937e9a42-2169-48cc-8094-e228841bc23e',
        name: 'Red Phone',
        slug: null,
        category: 'Phones',
        canonical_url: null,
        images: [],
        updated_at: null,
        categories: { slug: 'phones' },
      },
      storeUrl: 'https://zorvexa.usebaci.com',
    });

    expect(entry.url).toBe(
      'https://zorvexa.usebaci.com/phones/937e9a42-2169-48cc-8094-e228841bc23e'
    );
  });
});
