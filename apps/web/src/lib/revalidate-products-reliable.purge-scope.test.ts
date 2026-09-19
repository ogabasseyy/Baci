import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRevalidateProducts = vi.fn();
const mockRevalidateProductSlugs = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();
const mockScheduleStorefrontHostnamePurge = vi.fn();
const mockExpireProductBlogCache = vi.fn();

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
  revalidateProductSlugs: (...args: unknown[]) =>
    mockRevalidateProductSlugs(...args),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
}));
vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: (...args: unknown[]) =>
    mockExpireProductBlogCache(...args),
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockScheduleStorefrontHostnamePurge(...args),
}));
vi.mock('@/env', () => ({
  getAppUrl: () => 'https://app.usebaci.com',
  getInternalApiSecret: () => 'test-internal-secret',
}));

import { revalidateProductsReliable } from '@/lib/revalidate-products-reliable';

describe('revalidateProductsReliable purge scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses a hostname purge for structural or oversized operations', async () => {
    mockRevalidateProducts.mockReturnValue(undefined);

    await revalidateProductsReliable('merchant-1', {
      merchantSlug: 'ogabassey',
      products: [{ slug: 'iphone-15', category: 'Smartphones' }],
      purgeWholeStorefront: true,
    });

    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontHostnamePurge).toHaveBeenCalledWith(
      'ogabassey'
    );
    expect(mockExpireProductBlogCache).toHaveBeenCalledWith('merchant-1');
  });

  it('forwards merchantSlug and products in the HTTP fallback body', async () => {
    mockRevalidateProducts.mockImplementation(() => {
      throw new Error('no store');
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);
    const products = [{ slug: 'iphone-15', category: 'Smartphones' }];

    await revalidateProductsReliable('merchant-1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      merchantSlug: 'ogabassey',
      products,
    });

    const [, init] = fetchImpl.mock.calls[0];
    expect((init as RequestInit).body).toBe(
      JSON.stringify({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        products,
      })
    );
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
  });

  it('forwards products without merchantSlug in the HTTP fallback body', async () => {
    mockRevalidateProducts.mockImplementation(() => {
      throw new Error('no store');
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);
    const products = [{ slug: 'iphone-15', category: 'Smartphones' }];

    await revalidateProductsReliable('merchant-1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      products,
    });

    const [, init] = fetchImpl.mock.calls[0];
    expect((init as RequestInit).body).toBe(
      JSON.stringify({ merchantId: 'merchant-1', products })
    );
  });

  it('forwards the complete per-slug set separately from bounded edge entries', async () => {
    mockRevalidateProducts.mockImplementation(() => {
      throw new Error('no store');
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);
    const products = [{ slug: 'representative-phone', category: 'Phones' }];
    const productSlugs = ['phone-1', 'phone-2', 'phone-3'];

    await revalidateProductsReliable('merchant-1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      products,
      nextProductSlugs: productSlugs,
    });

    const [, init] = fetchImpl.mock.calls[0];
    expect((init as RequestInit).body).toBe(
      JSON.stringify({
        merchantId: 'merchant-1',
        products,
        productSlugs,
      })
    );
  });

  it('forwards the hostname-purge contract through the HTTP fallback', async () => {
    mockRevalidateProducts.mockImplementation(() => {
      throw new Error('no store');
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);

    await revalidateProductsReliable('merchant-1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      merchantSlug: 'ogabassey',
      purgeWholeStorefront: true,
    });

    const [, init] = fetchImpl.mock.calls[0];
    expect((init as RequestInit).body).toBe(
      JSON.stringify({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        purgeWholeStorefront: true,
      })
    );
  });

  it('chunks oversized slug sets without repeating edge-purge inputs', async () => {
    mockRevalidateProducts.mockImplementation(() => {
      throw new Error('no store');
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);
    const products = [{ slug: 'representative-phone', category: 'Phones' }];
    const productSlugs = Array.from(
      { length: 10_001 },
      (_, index) => `phone-${index}`
    );

    await revalidateProductsReliable('merchant-1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      merchantSlug: 'ogabassey',
      products,
      nextProductSlugs: productSlugs,
      purgeWholeStorefront: true,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(
      (fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string
    ) as Record<string, unknown>;
    const secondBody = JSON.parse(
      (fetchImpl.mock.calls[1]?.[1] as RequestInit).body as string
    ) as Record<string, unknown>;
    expect(firstBody).toMatchObject({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      products,
      purgeWholeStorefront: true,
    });
    expect(firstBody.productSlugs).toHaveLength(10_000);
    expect(secondBody).toEqual({
      merchantId: 'merchant-1',
      productSlugs: ['phone-10000'],
    });
  });
});
