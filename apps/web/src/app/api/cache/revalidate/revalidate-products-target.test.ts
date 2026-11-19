import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnrich = vi.fn();
const mockRevalidateProducts = vi.fn();
const mockRevalidateProductSlugs = vi.fn();
const mockExpireBlog = vi.fn();
const mockPurgeProduct = vi.fn();
const mockPurgeHostname = vi.fn();

vi.mock('@/lib/authoritative-product-purge-enrichment', () => ({
  enrichProductPurgeEntries: (...args: unknown[]) => mockEnrich(...args),
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProductSlugs: (...args: unknown[]) =>
    mockRevalidateProductSlugs(...args),
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
}));
vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: (...args: unknown[]) => mockExpireBlog(...args),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockPurgeProduct(...args),
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockPurgeHostname(...args),
}));

import { revalidateProductsTarget } from './revalidate-products-target';

const supabase = {
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { slug: 'ogabassey' },
      error: null,
    }),
  })),
} as unknown as Parameters<typeof revalidateProductsTarget>[0]['supabase'];

describe('revalidateProductsTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRevalidateProductSlugs.mockReturnValue(true);
    mockRevalidateProducts.mockReturnValue(true);
    mockEnrich.mockResolvedValue({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15'],
      authoritativeSlugsById: new Map([['prod-1', 'iphone-15']]),
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });
  });

  it('retries broad hard expiry when scoped expiry returns false and returns true on recovery', async () => {
    mockRevalidateProducts.mockReturnValueOnce(false).mockReturnValueOnce(true);

    await expect(
      revalidateProductsTarget({
        supabase,
        merchantId: 'merchant-1',
        products: [{ id: 'prod-1' }],
      })
    ).resolves.toBe(true);

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
    expect(mockPurgeProduct).toHaveBeenCalledOnce();
  });

  it('returns false and withholds edge purge when origin hard expiry stays false', async () => {
    mockRevalidateProducts.mockReturnValue(false);

    await expect(
      revalidateProductsTarget({
        supabase,
        merchantId: 'merchant-1',
        products: [{ id: 'prod-1' }],
      })
    ).resolves.toBe(false);

    expect(mockPurgeProduct).not.toHaveBeenCalled();
    expect(mockPurgeHostname).not.toHaveBeenCalled();
  });

  it('returns false and withholds edge purge when blog cache expiry returns false', async () => {
    mockExpireBlog.mockReturnValueOnce(false);

    await expect(
      revalidateProductsTarget({
        supabase,
        merchantId: 'merchant-1',
        products: [{ id: 'prod-1' }],
      })
    ).resolves.toBe(false);

    expect(mockPurgeProduct).not.toHaveBeenCalled();
    expect(mockPurgeHostname).not.toHaveBeenCalled();
  });

  it('attempts blog cache expiry in catch recovery and fails closed if it returns false', async () => {
    mockEnrich.mockRejectedValueOnce(new Error('enrichment failed'));
    mockExpireBlog.mockReturnValueOnce(false);

    await expect(
      revalidateProductsTarget({
        supabase,
        merchantId: 'merchant-1',
        products: [{ id: 'prod-1' }],
      })
    ).resolves.toBe(false);

    expect(mockExpireBlog).toHaveBeenCalledWith('merchant-1');
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { expireImmediately: true }
    );
  });
});
