import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAnalyticsInsert = vi.fn().mockResolvedValue({ error: null });
const mockAnalyticsSupabase = {
  from: vi.fn(() => ({
    insert: mockAnalyticsInsert,
  })),
};

const mockCookies = vi.fn();

vi.mock('next/headers', () => ({
  cookies: () => mockCookies(),
}));

vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('./storefront-products-select', () => ({
  STOREFRONT_PRODUCTS_COMPACT_SELECT: 'compact-select',
}));

vi.mock('@/app/api/storefront/products/product-response', () => ({
  mapStorefrontProduct: (product: {
    id: string;
    name: string;
    price: number;
    slug: string;
  }) => ({
    id: product.id,
    name: product.name,
    price: product.price,
    slug: product.slug,
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import { createPublicClient } from '@/lib/supabase/public';
import { createClient } from '@/lib/supabase/server';
import { getStorefrontSearchProducts } from './storefront-search-products';

describe('getStorefrontSearchProducts submission tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({});
    mockAnalyticsInsert.mockResolvedValue({ error: null });
    vi.mocked(createPublicClient).mockReturnValue(
      mockAnalyticsSupabase as never
    );
  });

  it('records one submission when tracking is explicitly opted in', async () => {
    vi.mocked(createClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: [{ product_id: 'product-1', total_count: 45 }],
        error: null,
      }),
      from: vi.fn(() => ({
        insert: vi.fn().mockResolvedValue({ error: null }),
      })),
    } as never);

    vi.mocked(createPublicClient)
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'product-1',
                      name: 'Phone One',
                      price: 1000,
                      slug: 'phone-one',
                    },
                  ],
                  error: null,
                }),
              })),
            })),
          })),
        })),
      } as never)
      .mockReturnValueOnce(mockAnalyticsSupabase as never);

    const result = await getStorefrontSearchProducts({
      merchantId: '123e4567-e89b-12d3-a456-426614174000',
      query: 'phone',
      limit: 20,
      trackAnalytics: true,
    });

    expect(result.products).toHaveLength(1);
    expect(mockAnalyticsSupabase.from).toHaveBeenCalledWith('search_analytics');
    expect(mockAnalyticsInsert).toHaveBeenCalledTimes(1);
    expect(mockAnalyticsInsert).toHaveBeenCalledWith({
      merchant_id: '123e4567-e89b-12d3-a456-426614174000',
      search_query: 'phone',
      results_count: 45,
      search_method: 'server',
    });
  });

  it('leaves analytics untracked when hydration fails after a successful rpc', async () => {
    vi.mocked(createClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: [{ product_id: 'product-1', total_count: 45 }],
        error: null,
      }),
      from: vi.fn(() => ({
        insert: vi.fn().mockResolvedValue({ error: null }),
      })),
    } as never);

    // Hydration throws after the ranked call succeeded: the error panel
    // renders and its retry must record the submission exactly once, so
    // this partial failure stays untracked.
    vi.mocked(createPublicClient).mockReturnValueOnce({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'hydration exploded' },
              }),
            })),
          })),
        })),
      })),
    } as never);

    await expect(
      getStorefrontSearchProducts({
        merchantId: '123e4567-e89b-12d3-a456-426614174000',
        query: 'phone',
        limit: 20,
      })
    ).rejects.toEqual({ message: 'hydration exploded' });

    expect(createPublicClient).not.toHaveBeenCalledWith({
      clientInfo: 'baci-storefront-search-analytics',
    });
    expect(mockAnalyticsSupabase.from).not.toHaveBeenCalledWith(
      'search_analytics'
    );
    expect(mockAnalyticsInsert).not.toHaveBeenCalled();
  });

  it('leaves analytics untracked by default without an explicit opt-in', async () => {
    vi.mocked(createClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: [{ product_id: 'product-1', total_count: 45 }],
        error: null,
      }),
      from: vi.fn(() => ({
        insert: vi.fn().mockResolvedValue({ error: null }),
      })),
    } as never);

    vi.mocked(createPublicClient).mockReturnValueOnce({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'product-1',
                    name: 'Phone One',
                    price: 1000,
                    slug: 'phone-one',
                  },
                ],
                error: null,
              }),
            })),
          })),
        })),
      })),
    } as never);

    const result = await getStorefrontSearchProducts({
      merchantId: '123e4567-e89b-12d3-a456-426614174000',
      query: 'phone',
      limit: 20,
      offset: 20,
    });

    expect(result.products).toHaveLength(1);
    // Only the hydration client is created; no analytics client or insert.
    expect(createPublicClient).toHaveBeenCalledTimes(1);
    expect(createPublicClient).not.toHaveBeenCalledWith({
      clientInfo: 'baci-storefront-search-analytics',
    });
    expect(mockAnalyticsSupabase.from).not.toHaveBeenCalledWith(
      'search_analytics'
    );
  });
});
