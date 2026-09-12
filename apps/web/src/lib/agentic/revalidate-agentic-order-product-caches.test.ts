import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockScheduleBlogPurge,
  mockRevalidateProducts,
  mockRevalidateProductSlugs,
  mockRevalidateDashboard,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockScheduleBlogPurge: vi.fn(),
  mockRevalidateProducts: vi.fn(),
  mockRevalidateProductSlugs: vi.fn(),
  mockRevalidateDashboard: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('@/lib/schedule-order-product-blog-purge-after-response', () => ({
  scheduleOrderProductBlogPurgeAfterResponse: (...args: unknown[]) =>
    mockScheduleBlogPurge(...args),
}));
vi.mock('@/lib/product-cache-revalidation', () => ({
  productCacheRevalidation: {
    revalidateDashboard: (...args: unknown[]) =>
      mockRevalidateDashboard(...args),
    revalidateProductSlugs: (...args: unknown[]) =>
      mockRevalidateProductSlugs(...args),
    revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: mockLoggerError } }));
vi.mock('@/lib/sanitize-core', () => ({
  sanitizeForLog: (value: unknown) => value,
}));

import { revalidateAgenticOrderProductCaches } from './revalidate-agentic-order-product-caches';

function makeSupabase(
  result: { data: unknown; error: unknown },
  variantResult: { data: unknown; error: unknown } = { data: [], error: null }
) {
  const chain = {
    eq: vi.fn(),
    in: vi.fn(),
    returns: vi.fn().mockResolvedValue(result),
    select: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  const variantChain = {
    eq: vi.fn(),
    in: vi.fn(),
    returns: vi.fn().mockResolvedValue(variantResult),
    select: vi.fn(),
  };
  variantChain.select.mockReturnValue(variantChain);
  variantChain.in.mockReturnValue(variantChain);
  variantChain.eq.mockReturnValue(variantChain);
  return {
    from: vi.fn((table: string) =>
      table === 'product_variants' ? variantChain : chain
    ),
  };
}

describe('revalidateAgenticOrderProductCaches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('revalidates tracked product slugs and queues the article lookup', async () => {
    const supabase = makeSupabase({
      data: [{ id: 'product-1', manage_stock: true, slug: 'phone-1' }],
      error: null,
    });

    await revalidateAgenticOrderProductCaches({
      merchantId: 'merchant-1',
      productIds: ['product-1'],
      sessionId: 'session-1',
      slugLookupFailureMessage: 'slug lookup failed',
      outerFailureMessage: 'cache revalidation failed',
      supabase: supabase as never,
    });

    expect(mockScheduleBlogPurge).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      productIds: ['product-1'],
      supabase,
    });
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { feedScope: 'merchant' }
    );
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith('merchant-1', [
      'phone-1',
    ]);
  });

  it('does not queue an article purge for unlimited-stock products', async () => {
    const supabase = makeSupabase({
      data: [{ id: 'product-1', manage_stock: false, slug: 'phone-1' }],
      error: null,
    });

    await revalidateAgenticOrderProductCaches({
      merchantId: 'merchant-1',
      productIds: ['product-1'],
      sessionId: 'session-1',
      slugLookupFailureMessage: 'slug lookup failed',
      outerFailureMessage: 'cache revalidation failed',
      supabase: supabase as never,
    });

    expect(mockScheduleBlogPurge).not.toHaveBeenCalled();
    expect(mockRevalidateDashboard).toHaveBeenCalledWith('merchant-1');
  });

  it('queues serialized products even when the legacy stock flag is off', async () => {
    const supabase = makeSupabase({
      data: [
        {
          id: 'product-1',
          inventory_tracking_policy: 'serialized_strict',
          manage_stock: false,
          slug: 'phone-1',
        },
      ],
      error: null,
    });

    await revalidateAgenticOrderProductCaches({
      merchantId: 'merchant-1',
      productIds: ['product-1'],
      sessionId: 'session-1',
      slugLookupFailureMessage: 'slug lookup failed',
      outerFailureMessage: 'cache revalidation failed',
      supabase: supabase as never,
    });

    expect(mockScheduleBlogPurge).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      productIds: ['product-1'],
      supabase,
    });
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith('merchant-1', [
      'phone-1',
    ]);
  });

  it('queues a serialized child variant under an unlimited parent', async () => {
    const supabase = makeSupabase(
      {
        data: [
          {
            id: 'product-1',
            inventory_tracking_policy: 'off',
            manage_stock: false,
            slug: 'phone-1',
          },
        ],
        error: null,
      },
      {
        data: [
          {
            inventory_tracking_policy: 'serialized_strict',
            product_id: 'product-1',
          },
        ],
        error: null,
      }
    );

    await revalidateAgenticOrderProductCaches({
      merchantId: 'merchant-1',
      productIds: ['product-1'],
      sessionId: 'session-1',
      slugLookupFailureMessage: 'slug lookup failed',
      outerFailureMessage: 'cache revalidation failed',
      supabase: supabase as never,
    });

    expect(mockScheduleBlogPurge).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      productIds: ['product-1'],
      supabase,
    });
  });

  it('fails open when the variant policy query errors', async () => {
    const supabase = makeSupabase(
      {
        data: [
          { id: 'product-1', manage_stock: true, slug: 'phone-1' },
          { id: 'product-2', manage_stock: false, slug: 'phone-2' },
        ],
        error: null,
      },
      { data: null, error: new Error('variant query unavailable') }
    );

    await revalidateAgenticOrderProductCaches({
      merchantId: 'merchant-1',
      productIds: ['product-1'],
      sessionId: 'session-1',
      slugLookupFailureMessage: 'slug lookup failed',
      outerFailureMessage: 'cache revalidation failed',
      supabase: supabase as never,
    });

    expect(mockScheduleBlogPurge).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      productIds: ['product-1', 'product-2'],
      supabase,
    });
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith('merchant-1', [
      'phone-1',
      'phone-2',
    ]);
  });

  it('fails open when the slug query errors', async () => {
    const supabase = makeSupabase({
      data: null,
      error: new Error('timeout'),
    });

    await expect(
      revalidateAgenticOrderProductCaches({
        merchantId: 'merchant-1',
        productIds: ['product-1'],
        sessionId: 'session-1',
        slugLookupFailureMessage: 'slug lookup failed',
        outerFailureMessage: 'cache revalidation failed',
        supabase: supabase as never,
      })
    ).resolves.toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalled();
    expect(mockScheduleBlogPurge).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      productIds: ['product-1'],
      supabase,
    });
  });
});
