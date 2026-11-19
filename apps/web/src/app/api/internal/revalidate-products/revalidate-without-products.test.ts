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

  it('forces broad hard expiry in slug-only mode when omitMerchantWidePdpDetails is requested without products', () => {
    const ok = revalidateWithoutProducts({
      merchantId: MERCHANT_ID,
      hasProducts: false,
      purgeWholeStorefront: false,
      hasExplicitProductSlugs: true,
      explicitSlugsRevalidated: true,
      callerOmitMerchantWidePdpDetails: true,
      shouldExpireProductBlogCache: true,
    });

    expect(ok).toBe(true);
    expect(mockRevalidateProducts).toHaveBeenCalledTimes(1);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      MERCHANT_ID,
      undefined,
      { expireImmediately: true }
    );

    mockRevalidateProducts.mockReturnValueOnce(false);
    expect(
      revalidateWithoutProducts({
        merchantId: MERCHANT_ID,
        hasProducts: false,
        purgeWholeStorefront: false,
        hasExplicitProductSlugs: true,
        explicitSlugsRevalidated: true,
        callerOmitMerchantWidePdpDetails: true,
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
        explicitSlugsRevalidated: true,
        callerOmitMerchantWidePdpDetails: true,
        shouldExpireProductBlogCache: false,
      })
    ).toBe(false);
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
