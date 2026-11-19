import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExpireProductBlogCache = vi.fn();
const mockRevalidateProducts = vi.fn();

vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: (...args: unknown[]) =>
    mockExpireProductBlogCache(...args),
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
}));

import { revalidateWithoutProducts } from './revalidate-without-products';

const MERCHANT_ID = 'merchant-1';

describe('revalidateWithoutProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExpireProductBlogCache.mockReturnValue(true);
    mockRevalidateProducts.mockReturnValue(true);
  });

  it('returns false when scoped blog-cache hard expiry fails on blog tag', () => {
    mockExpireProductBlogCache.mockReturnValueOnce(false);

    const ok = revalidateWithoutProducts({
      merchantId: MERCHANT_ID,
      hasProducts: false,
      purgeWholeStorefront: false,
      hasExplicitProductSlugs: true,
      explicitSlugsRevalidated: true,
      callerOmitMerchantWidePdpDetails: true,
      shouldExpireProductBlogCache: true,
    });

    expect(ok).toBe(false);
  });

  it('falls back to broad hard expiry when scoped listing expiry fails and returns false if broad also fails', () => {
    mockRevalidateProducts.mockReturnValueOnce(false).mockReturnValueOnce(true);

    const recovered = revalidateWithoutProducts({
      merchantId: MERCHANT_ID,
      hasProducts: false,
      purgeWholeStorefront: false,
      hasExplicitProductSlugs: true,
      explicitSlugsRevalidated: true,
      callerOmitMerchantWidePdpDetails: true,
      shouldExpireProductBlogCache: true,
    });

    expect(recovered).toBe(true);
    expect(mockRevalidateProducts).toHaveBeenNthCalledWith(
      2,
      MERCHANT_ID,
      undefined,
      { expireImmediately: true }
    );

    mockRevalidateProducts.mockClear();
    mockRevalidateProducts
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false);

    const failed = revalidateWithoutProducts({
      merchantId: MERCHANT_ID,
      hasProducts: false,
      purgeWholeStorefront: false,
      hasExplicitProductSlugs: true,
      explicitSlugsRevalidated: true,
      callerOmitMerchantWidePdpDetails: true,
      shouldExpireProductBlogCache: true,
    });

    expect(failed).toBe(false);

    mockRevalidateProducts.mockClear();
    mockRevalidateProducts
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false);

    const slugChunkFailed = revalidateWithoutProducts({
      merchantId: MERCHANT_ID,
      hasProducts: false,
      purgeWholeStorefront: false,
      hasExplicitProductSlugs: true,
      explicitSlugsRevalidated: true,
      callerOmitMerchantWidePdpDetails: true,
      shouldExpireProductBlogCache: false,
    });

    expect(slugChunkFailed).toBe(false);
  });

  it('returns false in blog mode when expireProductBlogCache fails or broad fallback fails', () => {
    mockExpireProductBlogCache.mockReturnValueOnce(false);

    expect(
      revalidateWithoutProducts({
        merchantId: MERCHANT_ID,
        hasProducts: false,
        purgeWholeStorefront: false,
        hasExplicitProductSlugs: false,
        explicitSlugsRevalidated: false,
        callerOmitMerchantWidePdpDetails: undefined,
        shouldExpireProductBlogCache: true,
      })
    ).toBe(false);

    mockRevalidateProducts.mockReturnValueOnce(false);

    expect(
      revalidateWithoutProducts({
        merchantId: MERCHANT_ID,
        hasProducts: false,
        purgeWholeStorefront: false,
        hasExplicitProductSlugs: true,
        explicitSlugsRevalidated: false,
        callerOmitMerchantWidePdpDetails: undefined,
        shouldExpireProductBlogCache: true,
      })
    ).toBe(false);

    mockRevalidateProducts.mockReturnValueOnce(false);

    expect(
      revalidateWithoutProducts({
        merchantId: MERCHANT_ID,
        hasProducts: false,
        purgeWholeStorefront: true,
        hasExplicitProductSlugs: false,
        explicitSlugsRevalidated: false,
        callerOmitMerchantWidePdpDetails: true,
        shouldExpireProductBlogCache: false,
      })
    ).toBe(false);

    mockRevalidateProducts.mockReturnValueOnce(false);

    expect(
      revalidateWithoutProducts({
        merchantId: MERCHANT_ID,
        hasProducts: false,
        purgeWholeStorefront: false,
        hasExplicitProductSlugs: false,
        explicitSlugsRevalidated: false,
        callerOmitMerchantWidePdpDetails: undefined,
        shouldExpireProductBlogCache: false,
      })
    ).toBe(false);
  });
});
