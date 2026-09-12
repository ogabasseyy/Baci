import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRevalidateProducts = vi.fn();
const mockRevalidateProductSlugs = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();
const mockScheduleStorefrontHostnamePurge = vi.fn();
const mockEnrichProductPurgeEntries = vi.fn();
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
vi.mock('@/lib/authoritative-product-purge-enrichment', () => ({
  enrichProductPurgeEntries: (...args: unknown[]) =>
    mockEnrichProductPurgeEntries(...args),
}));
vi.mock('@/env', () => ({
  getAppUrl: () => 'https://app.usebaci.com',
  getInternalApiSecret: () => 'test-internal-secret',
}));

import { revalidateProductsReliable } from '@/lib/revalidate-products-reliable';

describe('revalidateProductsReliable', () => {
  const originalBaseUrl = process.env.BACI_WEB_BASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default tests exercise the getAppUrl() fallback; the BACI_WEB_BASE_URL
    // precedence has its own test.
    delete process.env.BACI_WEB_BASE_URL;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalBaseUrl === undefined) {
      delete process.env.BACI_WEB_BASE_URL;
    } else {
      process.env.BACI_WEB_BASE_URL = originalBaseUrl;
    }
  });

  it('targets BACI_WEB_BASE_URL (the worker env convention) over getAppUrl when set', async () => {
    process.env.BACI_WEB_BASE_URL = 'https://ogabassey.com';
    mockRevalidateProducts.mockImplementation(() => {
      throw new Error('no store');
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);

    await revalidateProductsReliable('merchant-1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      'https://ogabassey.com/api/internal/revalidate-products'
    );
  });

  it('uses in-process revalidation and does NOT call the HTTP endpoint when a store context exists', async () => {
    mockRevalidateProducts.mockReturnValue(undefined);
    const fetchImpl = vi.fn();

    await revalidateProductsReliable('merchant-1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(mockRevalidateProducts).toHaveBeenCalledWith('merchant-1');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the remote route when local revalidation returns false', async () => {
    mockRevalidateProducts.mockReturnValue(false);
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    await revalidateProductsReliable('merchant-1', {
      fetchImpl,
      merchantSlug: 'ogabassey',
      products: [{ id: 'product-1', slug: 'phone' }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      products: [{ id: 'product-1', slug: 'phone' }],
      merchantSlug: 'ogabassey',
    });
  });

  it('falls back to the internal Bearer endpoint when in-process revalidation throws (no store context)', async () => {
    mockRevalidateProducts.mockImplementation(() => {
      throw new Error('static generation store missing');
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);

    await revalidateProductsReliable('merchant-1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchImpl.mock.calls[0];
    expect(String(calledUrl)).toBe(
      'https://app.usebaci.com/api/internal/revalidate-products'
    );
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer test-internal-secret',
      'Content-Type': 'application/json',
    });
    expect((init as RequestInit).body).toBe(
      JSON.stringify({ merchantId: 'merchant-1' })
    );
  });

  it('never throws when the HTTP fallback returns non-2xx', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRevalidateProducts.mockImplementation(() => {
      throw new Error('no store');
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(
      revalidateProductsReliable('merchant-1', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).resolves.toBeUndefined();
  });

  it('never throws when the HTTP fallback request rejects/times out', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRevalidateProducts.mockImplementation(() => {
      throw new Error('no store');
    });
    const fetchImpl = vi.fn().mockRejectedValue(new Error('timeout'));

    await expect(
      revalidateProductsReliable('merchant-1', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).resolves.toBeUndefined();
  });

  it('busts per-slug Next caches even when merchantSlug is missing (purge skipped)', async () => {
    mockRevalidateProducts.mockReturnValue(undefined);
    await revalidateProductsReliable('merchant-1', {
      products: [{ slug: 'iphone-15', id: 'p1' }],
    });

    // The Next-layer bust needs only merchantId — a failed/absent merchant-slug
    // resolution must not skip it; only the Cloudflare purge is gated.
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(
      'merchant-1',
      expect.arrayContaining(['iphone-15'])
    );
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
  });

  it('schedules an in-process Cloudflare purge when merchantSlug + products are supplied', async () => {
    mockRevalidateProducts.mockReturnValue(undefined);
    const fetchImpl = vi.fn();

    await revalidateProductsReliable('merchant-1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      merchantSlug: 'ogabassey',
      products: [{ slug: 'iphone-15', category: 'Smartphones' }],
    });

    // In-process path: no HTTP call, purge scheduled directly. A single product
    // is well under the fan-out threshold, so per-PDP purges are kept.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'ogabassey',
      [{ slug: 'iphone-15', categorySegment: 'smartphones' }]
    );
    expect(mockExpireProductBlogCache).toHaveBeenCalledWith('merchant-1');
  });

  it('busts the per-slug Next product caches BEFORE scheduling the in-process purge (F3 parity)', async () => {
    mockRevalidateProducts.mockReturnValue(undefined);
    const fetchImpl = vi.fn();

    await revalidateProductsReliable('merchant-1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      merchantSlug: 'ogabassey',
      products: [{ slug: 'iphone-15', id: 'prod-1', category: 'Smartphones' }],
    });

    // Per-slug invalidation for the caller-resolved slug + id (no store client
    // here to resolve authoritative rows).
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith('merchant-1', [
      'iphone-15',
      'prod-1',
    ]);
    // Ordering: the Next per-slug tags are busted before the edge purge is
    // scheduled, so a CF MISS cannot refill from stale Next data.
    expect(mockRevalidateProductSlugs.mock.invocationCallOrder[0]).toBeLessThan(
      mockScheduleStorefrontProductPurge.mock.invocationCallOrder[0]
    );
  });

  it('forwards every high-cardinality product to the shared bounded purge scheduler', async () => {
    mockRevalidateProducts.mockReturnValue(undefined);
    const fetchImpl = vi.fn();
    // More than 50 distinct products must reach the shared scheduler intact so
    // it can issue a bounded hostname-wide purge instead of leaving PDPs stale.
    const products = Array.from({ length: 51 }, (_, index) => ({
      slug: `product-${index}`,
      category: 'Smartphones',
    }));

    await revalidateProductsReliable('merchant-1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      merchantSlug: 'ogabassey',
      products,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'ogabassey',
      expect.arrayContaining([
        { slug: 'product-0', categorySegment: 'smartphones' },
        { slug: 'product-50', categorySegment: 'smartphones' },
      ])
    );
  });

  it('does not fetch (no secret leak) when the revalidation target is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRevalidateProducts.mockImplementation(() => {
      throw new Error('no store');
    });
    const fetchImpl = vi.fn();

    // Empty base URL → no trusted target → fail open without an HTTP call.
    await revalidateProductsReliable('merchant-1', {
      baseUrl: '',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
