import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prewarm: vi.fn(),
  purge: vi.fn(),
  revalidate: vi.fn(),
  resolveCategory: vi.fn(() => 'electronics'),
}));

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: mocks.revalidate,
}));
vi.mock('@/lib/schedule-product-image-prewarm', () => ({
  scheduleProductImageTransformsPrewarm: mocks.prewarm,
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: mocks.purge,
}));
vi.mock('@/lib/storefront-product-purge-urls', () => ({
  resolveProductPurgeCategorySegment: mocks.resolveCategory,
}));

import { scheduleNewProductCaches } from './schedule-new-product-caches';

describe('scheduleNewProductCaches', () => {
  it('revalidates, purges the canonical PDP, and prewarms every new product image', () => {
    const images = [{ url: 'https://cdn.example/product.jpg' }];

    scheduleNewProductCaches({
      merchantId: 'merchant-1',
      merchantSlug: 'merchant-store',
      productId: 'product-1',
      slug: 'new-product',
      name: 'New Product',
      category: 'Electronics',
      images,
    });

    expect(mocks.revalidate).toHaveBeenCalledWith('merchant-1', 'new-product');
    expect(mocks.purge).toHaveBeenCalledWith('merchant-store', [
      { slug: 'new-product', categorySegment: 'electronics' },
    ]);
    expect(mocks.prewarm).toHaveBeenCalledWith(images);
  });

  it('uses the created id when the generated slug is blank', () => {
    scheduleNewProductCaches({
      merchantId: 'merchant-1',
      merchantSlug: undefined,
      productId: 'product-1',
      slug: ' ',
      name: 'New Product',
      category: null,
      images: [],
    });

    expect(mocks.purge).toHaveBeenLastCalledWith(undefined, [
      { slug: 'product-1', categorySegment: 'electronics' },
    ]);
  });

  it('passes category-fallback article slugs through the purge scheduler', () => {
    scheduleNewProductCaches({
      merchantId: 'merchant-1',
      merchantSlug: 'merchant-store',
      productId: 'product-1',
      slug: 'new-product',
      name: 'New Product',
      category: 'Electronics',
      images: [],
      blogPostSlugs: ['electronics-buying-guide'],
    });

    expect(mocks.purge).toHaveBeenLastCalledWith(
      'merchant-store',
      [{ slug: 'new-product', categorySegment: 'electronics' }],
      { blogPostSlugs: ['electronics-buying-guide'] }
    );
  });

  it('does not turn a cache-purge scheduling error into a failed product creation', () => {
    mocks.purge.mockImplementationOnce(() => {
      throw new Error('purge unavailable');
    });

    expect(() =>
      scheduleNewProductCaches({
        merchantId: 'merchant-1',
        merchantSlug: 'merchant-store',
        productId: 'product-1',
        slug: 'new-product',
        name: 'New Product',
        category: null,
        images: [],
      })
    ).not.toThrow();
  });
});
