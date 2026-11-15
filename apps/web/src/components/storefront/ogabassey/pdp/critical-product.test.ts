import { describe, expect, it } from 'vitest';
import {
  buildOgabasseyPdpCriticalProduct,
  getOgabasseyPdpImageVersion,
  getOgabasseyPdpPrimaryImage,
} from './critical-product';

describe('buildOgabasseyPdpCriticalProduct', () => {
  it('omits stale listed prices from the intro while retaining product prose', () => {
    const product = buildOgabasseyPdpCriticalProduct({
      id: 'tablet',
      name: 'A tablet',
      price: 200000,
      description:
        'A portable canvas for your ideas. Current listed price is NGN 100,000. Enjoy your next chapter.',
    });
    expect(product.descriptionExcerpt).toBe(
      'A portable canvas for your ideas. Enjoy your next chapter.'
    );
    expect(product.price).toBe(200000);
  });
  it('derives the intro from catalog prose and does not manufacture missing copy', () => {
    const source = { id: 'tablet', name: 'A tablet' };
    expect(
      buildOgabasseyPdpCriticalProduct({
        ...source,
        description:
          '<p>Take your ideas further with a portable canvas for everyday work.</p>',
      }).descriptionExcerpt
    ).toBe('Take your ideas further with a portable canvas for everyday work.');
    expect(buildOgabasseyPdpCriticalProduct(source).descriptionExcerpt).toBe(
      ''
    );
  });
  it('maps cached product fields without requiring a review_count column', () => {
    const product = buildOgabasseyPdpCriticalProduct({
      brand: 'Lenovo',
      category: 'Laptops',
      categories: { id: 'cat-1', name: 'Laptops', slug: 'laptops' },
      condition: 'used',
      id: 'product-1',
      images: [
        { url: 'https://cdn.ogabassey.com/core-assets/products/legion.avif' },
      ],
      name: 'Lenovo Legion Pro 9',
      price: '5985000',
      schema_markup: {
        aggregateRating: {
          ratingValue: '4.5',
          reviewCount: '12',
        },
      },
      slug: 'lenovo-legion-pro-9',
      stock_quantity: 3,
      updated_at: '2026-06-13T10:00:00.000Z',
    });

    expect(product).toMatchObject({
      brand: 'Lenovo',
      categoryName: 'Laptops',
      categorySlug: 'laptops',
      condition: 'used',
      id: 'product-1',
      image: 'https://cdn.ogabassey.com/core-assets/products/legion.avif',
      imageVersion: getOgabasseyPdpImageVersion({
        images: [
          { url: 'https://cdn.ogabassey.com/core-assets/products/legion.avif' },
        ],
        updated_at: '2026-06-13T10:00:00.000Z',
      }),
      name: 'Lenovo Legion Pro 9',
      price: 5_985_000,
      rating: 4.5,
      reviewCount: 12,
      slug: 'lenovo-legion-pro-9',
      stockQuantity: 3,
    });
  });

  it('falls back to legacy string image arrays', () => {
    expect(
      getOgabasseyPdpPrimaryImage({
        images: ['https://cdn.ogabassey.com/core-assets/products/iphone.avif'],
      })
    ).toBe('https://cdn.ogabassey.com/core-assets/products/iphone.avif');
  });

  it('changes the cache version when the primary image changes', () => {
    const firstVersion = getOgabasseyPdpImageVersion({
      images: ['https://cdn.ogabassey.com/core-assets/products/old.avif'],
      updated_at: '2026-06-13T10:00:00.000Z',
    });
    const nextVersion = getOgabasseyPdpImageVersion({
      images: ['https://cdn.ogabassey.com/core-assets/products/new.avif'],
      updated_at: '2026-06-13T10:00:00.000Z',
    });

    expect(firstVersion).toMatch(/^[a-z0-9]+$/);
    expect(nextVersion).toMatch(/^[a-z0-9]+$/);
    expect(nextVersion).not.toBe(firstVersion);
  });

  it('changes the cache version when updated_at changes', () => {
    const firstVersion = getOgabasseyPdpImageVersion({
      images: ['https://cdn.ogabassey.com/core-assets/products/phone.avif'],
      updated_at: '2026-06-13T10:00:00.000Z',
    });
    const nextVersion = getOgabasseyPdpImageVersion({
      images: ['https://cdn.ogabassey.com/core-assets/products/phone.avif'],
      updated_at: '2026-06-13T11:00:00.000Z',
    });

    expect(firstVersion).toMatch(/^[a-z0-9]+$/);
    expect(nextVersion).toMatch(/^[a-z0-9]+$/);
    expect(nextVersion).not.toBe(firstVersion);
  });

  it('generates a cache version from a real image when updated_at is missing', () => {
    const version = getOgabasseyPdpImageVersion({
      images: ['https://cdn.ogabassey.com/core-assets/products/tablet.avif'],
      updated_at: null,
    });

    expect(version).toMatch(/^[a-z0-9]+$/);
  });

  it('generates a cache version from updated_at when the image is fallback', () => {
    const version = getOgabasseyPdpImageVersion({
      images: ['/placeholder.png'],
      updated_at: '2026-06-13T10:00:00.000Z',
    });

    expect(version).toMatch(/^[a-z0-9]+$/);
  });

  it('returns null when updated_at is missing and the image is fallback', () => {
    expect(
      getOgabasseyPdpImageVersion({
        images: ['/placeholder.png'],
        updated_at: null,
      })
    ).toBeNull();
  });

  it('keeps rating-count-only aggregate ratings visible without claiming reviews', () => {
    const product = buildOgabasseyPdpCriticalProduct({
      category: 'Smartphones',
      id: 'product-2',
      name: 'Rating Count Product',
      price: 100,
      schema_markup: {
        aggregateRating: {
          ratingValue: 4.5,
          reviewCount: 0,
          ratingCount: 12,
        },
      },
    });

    expect(product.rating).toBe(4.5);
    expect(product.reviewCount).toBe(0);
    expect(product.ratingCount).toBe(12);
  });

  it('ignores aggregate ratings that use a non-storefront rating scale', () => {
    const product = buildOgabasseyPdpCriticalProduct({
      category: 'Smartphones',
      id: 'product-3',
      name: 'Hundred Point Rating Product',
      price: 100,
      schema_markup: {
        aggregateRating: {
          bestRating: 100,
          worstRating: 0,
          ratingValue: 87,
          ratingCount: 12,
        },
      },
    });

    expect(product.rating).toBe(0);
    expect(product.reviewCount).toBe(0);
    expect(product.ratingCount).toBe(0);
  });

  it('uses safe defaults for legacy rows without schema markup or condition', () => {
    const product = buildOgabasseyPdpCriticalProduct({
      category: null,
      condition: null,
      id: 'legacy-product',
      images: null,
      name: 'Legacy Product',
      price: null,
      schema_markup: null,
      stock_quantity: null,
    });

    expect(product).toMatchObject({
      brand: 'OgaBassey',
      categoryName: 'Electronics',
      categorySlug: 'electronics',
      condition: 'new',
      image: '/placeholder.png',
      price: 0,
      rating: 0,
      ratingCount: 0,
      reviewCount: 0,
      slug: 'legacy-product',
      stockQuantity: null,
    });
  });
});
