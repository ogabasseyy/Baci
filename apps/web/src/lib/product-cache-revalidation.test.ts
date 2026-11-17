import { beforeEach, describe, expect, it, vi } from 'vitest';

const { revalidateTag } = vi.hoisted(() => ({ revalidateTag: vi.fn() }));

vi.mock('next/cache', () => ({ revalidateTag }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

import { getCategoryPageDataCacheTag } from '@/lib/category-page-cache-tags';
import { logger } from '@/lib/logger';
import { productCacheRevalidation } from '@/lib/product-cache-revalidation';

describe('productCacheRevalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    revalidateTag.mockReset();
  });

  it('revalidates merchant-wide, feed, dashboard, and product-slug tags', () => {
    productCacheRevalidation.revalidateProducts('merchant-1', ' phone ');

    expect(revalidateTag).toHaveBeenCalledWith(
      'products-merchant-1',
      'products'
    );
    expect(revalidateTag).toHaveBeenCalledWith(
      'merchant-feed-merchant-1',
      'products'
    );
    expect(revalidateTag).toHaveBeenCalledWith(
      'openai-product-feed',
      'products'
    );
    expect(revalidateTag).toHaveBeenCalledWith(
      'dashboard-merchant-1',
      'merchant'
    );
    expect(revalidateTag).toHaveBeenCalledWith(
      'product-merchant-1-phone',
      'products'
    );
  });

  it('limits tracked-inventory sales to the affected merchant feed', () => {
    productCacheRevalidation.revalidateProducts('merchant-1', undefined, {
      feedScope: 'merchant',
    });

    expect(revalidateTag).toHaveBeenCalledWith(
      'merchant-feed-merchant-1',
      'products'
    );
    expect(revalidateTag).not.toHaveBeenCalledWith(
      'google-merchant-feed',
      'products'
    );
    expect(revalidateTag).not.toHaveBeenCalledWith(
      'openai-product-feed',
      'products'
    );
    expect(revalidateTag).not.toHaveBeenCalledWith(
      'merchant-feed-review-signals-merchant-1',
      'products'
    );
  });

  it('hard-expires product-derived category data before an outer CDN eviction', () => {
    productCacheRevalidation.revalidateProducts('merchant-1', undefined, {
      expireImmediately: true,
      feedScope: 'merchant',
    });

    expect(revalidateTag).toHaveBeenCalledWith('products-merchant-1', {
      expire: 0,
    });
    expect(revalidateTag).toHaveBeenCalledWith('merchant-feed-merchant-1', {
      expire: 0,
    });
    expect(revalidateTag).toHaveBeenCalledWith(
      getCategoryPageDataCacheTag('merchant-1'),
      { expire: 0 }
    );
  });

  it('can invalidate dashboard order metrics without churning product caches', () => {
    productCacheRevalidation.revalidateDashboard('merchant-1');

    expect(revalidateTag).toHaveBeenCalledExactlyOnceWith(
      'dashboard-merchant-1',
      'merchant'
    );
  });

  it('deduplicates product slugs and ignores blank values', () => {
    productCacheRevalidation.revalidateProductSlugs('merchant-1', [
      'phone',
      ' phone ',
      '',
      null,
    ]);

    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith(
      'product-merchant-1-phone',
      'products'
    );
  });

  it('does not revalidate product tags for a blank merchant id', () => {
    productCacheRevalidation.revalidateProductSlugs(' ', ['phone']);

    expect(revalidateTag).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith({
      merchantId: ' ',
      message: 'Skipped product slug revalidation for invalid merchant ID',
    });
  });

  it('does not revalidate merchant-wide product tags for a blank merchant id', () => {
    productCacheRevalidation.revalidateProducts(' ');

    expect(revalidateTag).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith({
      merchantId: ' ',
      message: 'Skipped product cache revalidation for invalid merchant ID',
    });
  });

  it('does not emit feed tags for a whitespace-only merchant id', () => {
    productCacheRevalidation.revalidateMerchantFeed(' ');

    expect(revalidateTag).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith({
      merchantId: ' ',
      message: 'Skipped merchant feed revalidation for invalid merchant ID',
    });
  });

  it('continues invalidating later tags when one tag throws', () => {
    revalidateTag.mockImplementationOnce(() => {
      throw new Error('cache unavailable');
    });

    const revalidated =
      productCacheRevalidation.revalidateProducts('merchant-1');

    expect(revalidateTag).toHaveBeenCalledWith(
      'dashboard-merchant-1',
      'merchant'
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Error: cache unavailable',
        message: 'Failed to revalidate product cache tag',
        tag: 'products-merchant-1',
      })
    );
    expect(revalidated).toBe(false);
  });

  it('skips error logging and remaining tags when Next static generation store is missing', () => {
    revalidateTag.mockImplementation(() => {
      throw new Error(
        'Invariant: static generation store missing in revalidateTag("products-merchant-1")'
      );
    });

    const revalidated =
      productCacheRevalidation.revalidateProducts('merchant-1');

    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
    expect(revalidated).toBe(false);
  });

  it('skips error logging and remaining tags when incrementalCache is missing across slug, feed, and dashboard helpers', () => {
    revalidateTag.mockImplementation(() => {
      throw new Error('incrementalCache missing');
    });

    productCacheRevalidation.revalidateProductSlugs('merchant-1', [
      'slug-1',
      'slug-2',
    ]);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();

    revalidateTag.mockClear();
    const feedRevalidated =
      productCacheRevalidation.revalidateMerchantFeed('merchant-1');
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
    expect(feedRevalidated).toBe(false);

    revalidateTag.mockClear();
    productCacheRevalidation.revalidateDashboard('merchant-1');
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
