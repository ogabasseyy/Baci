import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAfter = vi.fn();
const mockRevalidateProductSlugs = vi.fn();
const mockRevalidateProducts = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();
const mockScheduleProductBlogPurgeAfterResponse = vi.fn();
const mockExpire = vi.fn();
const mockExpireReliable = vi.fn();
const mockHostnamePurge = vi.fn();

vi.mock('next/server', () => ({
  after: (...args: unknown[]) => mockAfter(...args),
}));
vi.mock('./expire-product-blog-cache', () => ({
  expireProductBlogCache: (...args: unknown[]) => mockExpire(...args),
}));
vi.mock('./expire-product-blog-cache-reliable', () => ({
  expireProductBlogCacheReliable: (...args: unknown[]) =>
    mockExpireReliable(...args),
}));
vi.mock('./storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockHostnamePurge(...args),
}));
vi.mock('./cache-revalidation', () => ({
  revalidateProductSlugs: (...args: unknown[]) =>
    mockRevalidateProductSlugs(...args),
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
}));
vi.mock('./schedule-product-blog-purge-after-response', () => ({
  scheduleProductBlogPurgeAfterResponse: (...args: unknown[]) =>
    mockScheduleProductBlogPurgeAfterResponse(...args),
}));
vi.mock('./storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
}));

import { scheduleProductMutationPurge } from './schedule-product-mutation-purge';

describe('scheduleProductMutationPurge fallback guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRevalidateProducts.mockReturnValue(true);
    mockRevalidateProductSlugs.mockReturnValue(true);
    mockExpire.mockReturnValue(true);
    mockExpireReliable.mockResolvedValue(true);
  });

  it('falls back to broad PDP expiry when authoritativeScopedInputs is omitted', () => {
    const entries = [{ slug: 'new-phone', categorySegment: 'smartphones' }];

    scheduleProductMutationPurge({
      supabase: {} as never,
      merchantId: 'merchant-1',
      merchantSlug: 'test-store',
      productIds: ['product-1'],
      entries,
    });

    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { expireImmediately: true }
    );
  });

  it('defers reliable expiry before scheduling edge purge when expireProductBlogCache returns false', async () => {
    const entries = [{ slug: 'new-phone', categorySegment: 'smartphones' }];
    mockExpire.mockReturnValueOnce(false);
    mockExpireReliable.mockResolvedValueOnce(false);
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    try {
      scheduleProductMutationPurge({
        supabase: {} as never,
        merchantId: 'merchant-1',
        merchantSlug: 'test-store',
        productIds: ['product-1'],
        entries,
        authoritativeScopedInputs: true,
      });

      expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
      await mockAfter.mock.calls[0][0]();
      expect(mockExpireReliable).toHaveBeenCalledWith('merchant-1', {
        expireWidePdpDetails: true,
      });
      expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
