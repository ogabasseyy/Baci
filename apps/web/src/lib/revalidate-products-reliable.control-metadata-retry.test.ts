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

describe('revalidateProductsReliable control metadata retry', () => {
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

  it('resends purge metadata on a later chunk when the first chunk fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ ok: true } as Response);
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
    const bodies = fetchImpl.mock.calls.map(([, init]) =>
      JSON.parse((init as RequestInit).body as string)
    );
    // The failed first chunk attempted the metadata; the successful second
    // chunk resends it so the edge purge is still scheduled.
    expect(bodies[1]).toMatchObject({
      merchantSlug: 'ogabassey',
      products,
      purgeWholeStorefront: true,
    });
    expect(bodies[1].productSlugs).toHaveLength(1);
  });

  it('sends purge metadata exactly once when the first chunk succeeds', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);
    const nextProductSlugs = Array.from(
      { length: 10_001 },
      (_, index) => `slug-${index}`
    );

    await revalidateProductsReliable('merchant-1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nextProductSlugs,
      merchantSlug: 'ogabassey',
      products: [{ id: 'product-1' }],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const bodies = fetchImpl.mock.calls.map(([, init]) =>
      JSON.parse((init as RequestInit).body as string)
    );
    expect(bodies[0].merchantSlug).toBe('ogabassey');
    expect(bodies[1].merchantSlug).toBeUndefined();
    expect(bodies[1].products).toBeUndefined();
  });
});
