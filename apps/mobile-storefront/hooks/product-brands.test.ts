import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockRpc = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockFrom = jest.fn();

jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (operation: () => Promise<unknown>) => operation(),
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { fetchAvailableBrands } from './product-brands';

describe('fetchAvailableBrands normalized-empty search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns no brands instead of all brands for punctuation-only queries', async () => {
    const result = await fetchAvailableBrands('merchant-1', { search: '!!' });

    expect(result).toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('fetchAvailableBrands complete search facets', () => {
  it('finds a brand after the RPC maximum first 100 results without trimming its filter value', async () => {
    mockRpc.mockReset();
    mockFrom.mockReset();
    const page = Array.from({ length: 100 }, (_, i) => ({
      product_id: `p-${i}`,
      total_count: 101,
    }));
    mockRpc
      .mockResolvedValueOnce({ data: page, error: null })
      .mockResolvedValueOnce({
        data: [{ product_id: 'p-100', total_count: 101 }],
        error: null,
      });
    const pages = [
      [
        ...page.map((r) => ({
          id: r.product_id,
          brand: r.product_id === 'p-0' ? '   ' : 'Apple',
        })),
      ],
      [{ id: 'p-100', brand: ' Samsung ' }],
    ];
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: pages.shift(), error: null }),
        }),
      }),
    }));
    expect(
      await fetchAvailableBrands('merchant-1', { search: 'phone' })
    ).toEqual([' Samsung ', 'Apple']);
  });
});

describe('fetchAvailableBrands processor refinements', () => {
  it('omits the processor filter the brands RPC cannot accept', async () => {
    mockRpc.mockReset();
    mockFrom.mockReset();
    mockRpc.mockResolvedValue({ data: [{ brand: 'Apple' }], error: null });
    const result = await fetchAvailableBrands('merchant-1', {
      search: 'laptop',
      refinements: { brands: [], sort: 'relevance', processor: 'M3' },
    });
    expect(result).toEqual(['Apple']);
    expect(mockRpc).toHaveBeenCalledWith(
      'get_storefront_search_brands',
      expect.not.objectContaining({ processor_filter: expect.anything() })
    );
  });
});
