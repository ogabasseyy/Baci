import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStorefrontAutocompleteProducts } from '@/lib/storefront-search-autocomplete';

const searchStorefrontProducts = vi.fn();
const productQuery = {
  select: vi.fn(() => productQuery),
  in: vi.fn(() => productQuery),
  eq: vi.fn(() => productQuery),
  // biome-ignore lint/suspicious/noThenProperty: thenable mock mirrors Supabase query builders
  then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
    Promise.resolve({
      data: [
        {
          id: 'p2',
          name: 'iPhone 16 Pro',
          category: 'Smartphones',
          price: 1_200_000,
          images: ['two.jpg'],
          slug: 'iphone-16-pro',
        },
        {
          id: 'p1',
          name: 'iPhone X',
          category: 'Smartphones',
          price: 240_000,
          images: ['one.jpg'],
          slug: 'iphone-x',
        },
      ],
      error: null,
    }).then(resolve),
};

const supabase = {
  rpc: vi.fn(),
  from: vi.fn(() => productQuery),
};
const VALID_MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174000';

vi.mock('@/lib/storefront-search', () => ({
  searchStorefrontProducts: (...args: unknown[]) =>
    searchStorefrontProducts(...args),
}));

describe('getStorefrontAutocompleteProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates ranked ids into autocomplete suggestions in ranked order', async () => {
    searchStorefrontProducts.mockResolvedValueOnce({
      count: 2,
      didYouMean: null,
      productIds: ['p1', 'p2'],
      query: 'iphnoe',
    });

    const result = await getStorefrontAutocompleteProducts({
      supabase: supabase as never,
      merchantId: VALID_MERCHANT_ID,
      query: 'iphnoe',
      limit: 10,
    });

    expect(result.suggestions.map((product) => product.id)).toEqual([
      'p1',
      'p2',
    ]);
    expect(searchStorefrontProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'iphnoe',
        limit: 10,
      })
    );
    expect(result.popularSearches).toEqual([]);
  });

  it('keeps unmatched database rows after ranked suggestions', async () => {
    searchStorefrontProducts.mockResolvedValueOnce({
      count: 2,
      didYouMean: null,
      productIds: ['p1', 'p2'],
      query: 'iphone',
    });

    const unmatchedQuery = {
      select: vi.fn(() => unmatchedQuery),
      in: vi.fn(() => unmatchedQuery),
      eq: vi.fn(() => unmatchedQuery),
      // biome-ignore lint/suspicious/noThenProperty: thenable mock mirrors Supabase query builders
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({
          data: [
            {
              id: 'p3',
              name: 'iPhone Case',
              category: 'Accessories',
              price: 30_000,
              images: [],
              slug: 'iphone-case',
            },
            {
              id: 'p2',
              name: 'iPhone 16 Pro',
              category: 'Smartphones',
              price: 1_200_000,
              images: ['two.jpg'],
              slug: 'iphone-16-pro',
            },
            {
              id: 'p1',
              name: 'iPhone X',
              category: 'Smartphones',
              price: 240_000,
              images: ['one.jpg'],
              slug: 'iphone-x',
            },
          ],
          error: null,
        }).then(resolve),
    };
    const unmatchedSupabase = {
      rpc: vi.fn(),
      from: vi.fn(() => unmatchedQuery),
    };

    const result = await getStorefrontAutocompleteProducts({
      supabase: unmatchedSupabase as never,
      merchantId: VALID_MERCHANT_ID,
      query: 'iphone-unmatched',
      limit: 10,
    });

    expect(result.suggestions.map((product) => product.id)).toEqual([
      'p1',
      'p2',
      'p3',
    ]);
  });

  it('returns empty suggestions for short queries without hitting the rpc', async () => {
    const result = await getStorefrontAutocompleteProducts({
      supabase: supabase as never,
      merchantId: VALID_MERCHANT_ID,
      query: 'i',
      limit: 10,
    });

    expect(result).toEqual({ suggestions: [], popularSearches: [] });
    expect(searchStorefrontProducts).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('rejects invalid limits before searching', async () => {
    await expect(
      getStorefrontAutocompleteProducts({
        supabase: supabase as never,
        merchantId: VALID_MERCHANT_ID,
        query: 'iphone',
        limit: 0,
      })
    ).rejects.toThrow('limit must be between 1 and 100');

    expect(searchStorefrontProducts).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('rejects limits above the maximum before searching', async () => {
    await expect(
      getStorefrontAutocompleteProducts({
        supabase: supabase as never,
        merchantId: VALID_MERCHANT_ID,
        query: 'iphone',
        limit: 101,
      })
    ).rejects.toThrow('limit must be between 1 and 100');

    expect(searchStorefrontProducts).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('throws when product hydration fails', async () => {
    searchStorefrontProducts.mockResolvedValueOnce({
      count: 1,
      didYouMean: null,
      productIds: ['p1'],
      query: 'iphone',
    });

    const hydrationError = new Error('DB error');
    const errorQuery = {
      select: vi.fn(() => errorQuery),
      in: vi.fn(() => errorQuery),
      eq: vi.fn(() => errorQuery),
      // biome-ignore lint/suspicious/noThenProperty: thenable mock mirrors Supabase query builders
      then: (resolve: (value: { data: null; error: Error }) => unknown) =>
        Promise.resolve({ data: null, error: hydrationError }).then(resolve),
    };
    const errorSupabase = {
      rpc: vi.fn(),
      from: vi.fn(() => errorQuery),
    };

    await expect(
      getStorefrontAutocompleteProducts({
        supabase: errorSupabase as never,
        merchantId: VALID_MERCHANT_ID,
        query: 'iphone-error',
        limit: 10,
      })
    ).rejects.toThrow('DB error');
  });

  it('handles null data from product hydration', async () => {
    searchStorefrontProducts.mockResolvedValueOnce({
      count: 1,
      didYouMean: null,
      productIds: ['p1'],
      query: 'iphone',
    });

    const nullDataQuery = {
      select: vi.fn(() => nullDataQuery),
      in: vi.fn(() => nullDataQuery),
      eq: vi.fn(() => nullDataQuery),
      // biome-ignore lint/suspicious/noThenProperty: thenable mock mirrors Supabase query builders
      then: (resolve: (value: { data: null; error: null }) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    };
    const nullDataSupabase = {
      rpc: vi.fn(),
      from: vi.fn(() => nullDataQuery),
    };

    await expect(
      getStorefrontAutocompleteProducts({
        supabase: nullDataSupabase as never,
        merchantId: VALID_MERCHANT_ID,
        query: 'iphone-null',
        limit: 10,
      })
    ).resolves.toEqual({ suggestions: [], popularSearches: [] });
  });
});
