import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRevalidateProducts = vi.fn();

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
  revalidateProductSlugs: vi.fn(),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: vi.fn(),
}));
vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: vi.fn(),
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: vi.fn(),
}));
vi.mock('@/lib/authoritative-product-purge-enrichment', () => ({
  enrichProductPurgeEntries: vi.fn(),
}));
vi.mock('@/env', () => ({
  getAppUrl: () => 'https://app.usebaci.com',
  getInternalApiSecret: () => 'test-internal-secret',
}));

import { revalidateProductsReliable } from '@/lib/revalidate-products-reliable';

describe('revalidateProductsReliable control metadata ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BACI_WEB_BASE_URL;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRevalidateProducts.mockImplementation(() => {
      throw new Error('no store');
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function bodiesOf(fetchImpl: ReturnType<typeof vi.fn>) {
    return fetchImpl.mock.calls.map(
      ([, init]) =>
        JSON.parse((init as RequestInit).body as string) as Record<
          string,
          unknown
        >
    );
  }

  it('sends purge metadata only on the last chunk when every chunk succeeds', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);
    const nextProductSlugs = Array.from(
      { length: 10_001 },
      (_, index) => `slug-${index}`
    );
    const products = [{ id: 'product-1' }];

    await revalidateProductsReliable('merchant-1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nextProductSlugs,
      merchantSlug: 'ogabassey',
      products,
      purgeWholeStorefront: true,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const bodies = bodiesOf(fetchImpl);
    expect(bodies[0]).not.toHaveProperty('merchantSlug');
    expect(bodies[0]).not.toHaveProperty('products');
    expect(bodies[0]).not.toHaveProperty('purgeWholeStorefront');
    expect(bodies[1]).toMatchObject({
      merchantSlug: 'ogabassey',
      products,
      purgeWholeStorefront: true,
    });
  });

  it('suppresses the edge purge when an earlier chunk fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ ok: true } as Response);
    const nextProductSlugs = Array.from(
      { length: 10_001 },
      (_, index) => `slug-${index}`
    );

    await revalidateProductsReliable('merchant-1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nextProductSlugs,
      merchantSlug: 'ogabassey',
      products: [{ id: 'product-1' }],
      purgeWholeStorefront: true,
    });

    // Both chunks are still submitted for their slug invalidations, but the
    // successful last chunk withholds the purge inputs: scheduling the
    // purge now would refill the edge from the failed chunk's stale tags.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const bodies = bodiesOf(fetchImpl);
    for (const body of bodies) {
      expect(body).not.toHaveProperty('merchantSlug');
      expect(body).not.toHaveProperty('products');
      expect(body).not.toHaveProperty('purgeWholeStorefront');
    }
    expect(bodies[1].productSlugs).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('edge purge suppressed'),
      expect.objectContaining({ merchantId: 'merchant-1' })
    );
  });
});
