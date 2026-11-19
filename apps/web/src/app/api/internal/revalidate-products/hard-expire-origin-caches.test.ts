import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRevalidateProducts = vi.fn();
const mockExpireProductBlogCache = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
}));
vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: (...args: unknown[]) =>
    mockExpireProductBlogCache(...args),
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

import { hardExpireOriginCaches } from './hard-expire-origin-caches';

describe('hardExpireOriginCaches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExpireProductBlogCache.mockReturnValue(true);
    mockRevalidateProducts.mockReturnValue(true);
  });

  it('falls back to unrestricted hard expiry when scoped revalidateProducts fails', () => {
    mockRevalidateProducts.mockReturnValueOnce(false).mockReturnValueOnce(true);

    expect(
      hardExpireOriginCaches({
        merchantId: 'merchant-1',
        scopedOptions: { omitMerchantWidePdpDetails: true },
        edgePurgeTarget: 'product',
      })
    ).toBe(true);
    expect(mockRevalidateProducts).toHaveBeenNthCalledWith(
      1,
      'merchant-1',
      undefined,
      { expireImmediately: true, omitMerchantWidePdpDetails: true }
    );
    expect(mockRevalidateProducts).toHaveBeenNthCalledWith(
      2,
      'merchant-1',
      undefined,
      { expireImmediately: true }
    );
  });

  it('returns false and logs when blog or product origin expiry fails', () => {
    mockExpireProductBlogCache.mockReturnValueOnce(false);
    expect(
      hardExpireOriginCaches({
        merchantId: 'merchant-1',
        edgePurgeTarget: 'hostname',
      })
    ).toBe(false);
    expect(mockLoggerError).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mockExpireProductBlogCache.mockReturnValueOnce(true);
    mockRevalidateProducts.mockReturnValueOnce(false);
    expect(
      hardExpireOriginCaches({
        merchantId: 'merchant-1',
        edgePurgeTarget: 'product',
      })
    ).toBe(false);
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
  });
});
