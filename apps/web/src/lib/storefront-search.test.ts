import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSupabase = {
  rpc: vi.fn(),
  from: vi.fn(() => ({
    insert: vi.fn().mockResolvedValue({ error: null }),
  })),
};

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

import { sanitizeSearchQuery } from '@/lib/sanitize-core';
import { createPublicClient } from '@/lib/supabase/public';
import { createClient } from '@/lib/supabase/server';
import {
  getStorefrontSearchProducts,
  InvalidMerchantIdError,
  searchStorefrontProducts,
} from './storefront-search';

describe('searchStorefrontProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyticsInsert.mockResolvedValue({ error: null });
    vi.mocked(createPublicClient).mockReturnValue(
      mockAnalyticsSupabase as never
    );
  });

  it('sanitizes the query before calling the search rpc', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{ product_id: 'prod-1', total_count: 1 }],
      error: null,
    });

    const rawQuery = '<script>alert(1)</script>iphone';
    const expectedQuery = sanitizeSearchQuery(rawQuery);

    await searchStorefrontProducts({
      supabase: mockSupabase as never,
      merchantId: '123e4567-e89b-12d3-a456-426614174000',
      query: rawQuery,
      limit: 20,
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({
        search_query: expectedQuery,
      })
    );
  });

  it('returns the shaped success response', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{ product_id: 'prod-1', total_count: 2 }],
      error: null,
    });

    const result = await searchStorefrontProducts({
      supabase: mockSupabase as never,
      merchantId: '123e4567-e89b-12d3-a456-426614174000',
      query: 'iphone',
      limit: 20,
    });

    expect(result).toEqual({
      count: 2,
      didYouMean: null,
      productIds: ['prod-1'],
      query: 'iphone',
    });
    expect(createPublicClient).toHaveBeenCalledWith({
      clientInfo: 'baci-storefront-search-analytics',
    });
    expect(mockAnalyticsSupabase.from).toHaveBeenCalledWith('search_analytics');
    expect(mockAnalyticsInsert).toHaveBeenCalledWith({
      merchant_id: '123e4567-e89b-12d3-a456-426614174000',
      search_query: 'iphone',
      results_count: 2,
      search_method: 'server',
    });
  });

  it('throws InvalidMerchantIdError for invalid merchant ids', async () => {
    await expect(
      searchStorefrontProducts({
        supabase: mockSupabase as never,
        merchantId: 'not-a-uuid',
        query: 'iphone',
        limit: 20,
      })
    ).rejects.toBeInstanceOf(InvalidMerchantIdError);
  });

  it('returns didYouMean when the first search has no matches', async () => {
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [{ suggested_term: 'iphone' }],
        error: null,
      });

    const result = await searchStorefrontProducts({
      supabase: mockSupabase as never,
      merchantId: '123e4567-e89b-12d3-a456-426614174000',
      query: 'iphon',
      limit: 20,
    });

    expect(result.didYouMean).toBe('iphone');
  });

  it('degrades to no suggestion when the suggestion lookup fails', async () => {
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'suggestion rpc exploded' },
      });

    const result = await searchStorefrontProducts({
      supabase: mockSupabase as never,
      merchantId: '123e4567-e89b-12d3-a456-426614174000',
      query: 'iphon',
      limit: 20,
    });

    expect(result.didYouMean).toBeNull();
    expect(result.productIds).toEqual([]);
  });

  it('passes optional filter and pagination arguments to search_products_v2', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{ product_id: 'prod-1', total_count: 1 }],
      error: null,
    });

    await searchStorefrontProducts({
      supabase: mockSupabase as never,
      merchantId: '123e4567-e89b-12d3-a456-426614174000',
      query: 'iphone',
      limit: 12,
      offset: 24,
      filters: {
        brand: 'Apple',
        categoryId: '22222222-2222-2222-2222-222222222222',
        condition: 'used',
        minPrice: 100000,
        maxPrice: 500000,
        minRating: 4,
        stock: 'in_stock',
      },
      sort: 'price_asc',
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({
        brand_filter: 'Apple',
        category_id_filter: '22222222-2222-2222-2222-222222222222',
        condition_filter: 'used',
        max_price_filter: 500000,
        min_price_filter: 100000,
        min_rating_filter: 4,
        result_limit: 12,
        result_offset: 24,
        sort_by: 'price_asc',
        stock_filter: 'in_stock',
      })
    );
  });

  it('clamps result limits before calling the rpc', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{ product_id: 'prod-1', total_count: 1 }],
      error: null,
    });

    await searchStorefrontProducts({
      supabase: mockSupabase as never,
      merchantId: '123e4567-e89b-12d3-a456-426614174000',
      query: 'iphone',
      limit: 500,
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({ result_limit: 100 })
    );
  });

  it('can disable analytics for autocomplete-style callers', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{ product_id: 'prod-1', total_count: 1 }],
      error: null,
    });

    await searchStorefrontProducts({
      supabase: mockSupabase as never,
      merchantId: '123e4567-e89b-12d3-a456-426614174000',
      query: 'iphone',
      limit: 10,
      trackAnalytics: false,
    });

    expect(createPublicClient).not.toHaveBeenCalledWith({
      clientInfo: 'baci-storefront-search-analytics',
    });
    expect(mockAnalyticsSupabase.from).not.toHaveBeenCalledWith(
      'search_analytics'
    );
  });
});

describe('getStorefrontSearchProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({});
    mockAnalyticsInsert.mockResolvedValue({ error: null });
    vi.mocked(createPublicClient).mockReturnValue(
      mockAnalyticsSupabase as never
    );
  });

  it('hydrates search results and preserves the ranked order', async () => {
    vi.mocked(createClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: [
          { product_id: 'product-2', total_count: 2 },
          { product_id: 'product-1', total_count: 2 },
        ],
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
                    {
                      id: 'product-2',
                      name: 'Phone Two',
                      price: 2000,
                      slug: 'phone-two',
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
    });

    expect(result.products).toHaveLength(2);
    expect(result.products.map((product) => product.id)).toEqual([
      'product-2',
      'product-1',
    ]);
    expect(result.products[0]).toMatchObject({
      id: 'product-2',
      name: 'Phone Two',
      price: 2000,
      slug: 'phone-two',
    });
    expect(result.products[1]).toMatchObject({
      id: 'product-1',
      name: 'Phone One',
      price: 1000,
      slug: 'phone-one',
    });
  });

  it('applies storefront condition-family filters after hydrating ranked results', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { product_id: 'product-1', total_count: 2 },
        { product_id: 'product-2', total_count: 2 },
      ],
      error: null,
    });

    vi.mocked(createClient).mockReturnValue({
      rpc,
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
                      name: 'Phone Offer Family',
                      price: 1000,
                      slug: 'phone-offer-family',
                      condition: 'new',
                      has_condition_offers: true,
                      available_conditions: ['new', 'open_box'],
                    },
                    {
                      id: 'product-2',
                      name: 'New Only Phone',
                      price: 2000,
                      slug: 'new-only-phone',
                      condition: 'new',
                      has_condition_offers: false,
                      available_conditions: ['new'],
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
      filters: { condition: 'open_box' },
    });

    expect(rpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({
        condition_filter: null,
        result_limit: 100,
        result_offset: 0,
      })
    );
    expect(result.products.map((product) => product.id)).toEqual(['product-1']);
    expect(result.productIds).toEqual(['product-1']);
    expect(result.count).toBe(1);
  });

  it('accumulates ranked candidates across pages so condition-family counts are not capped at one page', async () => {
    const page1 = Array.from({ length: 100 }, (_, index) => ({
      product_id: `p${index}`,
      total_count: 150,
    }));
    const page2 = Array.from({ length: 50 }, (_, index) => ({
      product_id: `p${100 + index}`,
      total_count: 150,
    }));
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: page1, error: null })
      .mockResolvedValueOnce({ data: page2, error: null });

    vi.mocked(createClient).mockReturnValue({
      rpc,
      from: vi.fn(() => ({
        insert: vi.fn().mockResolvedValue({ error: null }),
      })),
    } as never);

    // Even-indexed products belong to the open_box family (75 of 150).
    const hydrated = Array.from({ length: 150 }, (_, index) => ({
      id: `p${index}`,
      name: `Phone ${index}`,
      price: 1000 + index,
      slug: `phone-${index}`,
      condition: 'new',
      has_condition_offers: index % 2 === 0,
      available_conditions: index % 2 === 0 ? ['new', 'open_box'] : ['new'],
    }));

    vi.mocked(createPublicClient)
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({ data: hydrated, error: null }),
              })),
            })),
          })),
        })),
      } as never)
      .mockReturnValue(mockAnalyticsSupabase as never);

    const result = await getStorefrontSearchProducts({
      merchantId: '123e4567-e89b-12d3-a456-426614174000',
      query: 'phone',
      limit: 20,
      offset: 20,
      filters: { condition: 'open_box' },
    });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'search_products_v2',
      expect.objectContaining({ result_offset: 0, result_limit: 100 })
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'search_products_v2',
      expect.objectContaining({ result_offset: 100, result_limit: 100 })
    );
    // Count reflects the full filtered set, not a single 100-row page.
    expect(result.count).toBe(75);
    // Second page (offset 20, limit 20) of the filtered open_box products.
    expect(result.products).toHaveLength(20);
    expect(result.products[0].id).toBe('p40');
  });
});
