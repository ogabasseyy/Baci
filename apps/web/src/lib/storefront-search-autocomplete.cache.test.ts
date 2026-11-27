import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutocompleteSupabase } from './storefront-search-autocomplete';

const FIRST_MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174000';
const SECOND_MERCHANT_ID = '223e4567-e89b-12d3-a456-426614174000';

type RankedRpcResult = {
  data: Array<{ product_id: string; total_count: number }> | null;
  error: Error | null;
};

type ProductQuery = PromiseLike<{
  data: Array<{
    id: string;
    name: string;
    category: string | null;
    price: number;
    images: string[];
    slug: string;
  }>;
  error: null;
}> & {
  in: (column: string, values: string[]) => ProductQuery;
  eq: (column: string, value: string) => ProductQuery;
};

function createAutocompleteSupabase() {
  const query: ProductQuery = {
    in: vi.fn(() => query),
    eq: vi.fn(() => query),
    // biome-ignore lint/suspicious/noThenProperty: thenable mock mirrors Supabase query builders
    then: (onFulfilled, onRejected) =>
      Promise.resolve({
        data: [
          {
            id: 'product-1',
            name: 'iPhone 16 Pro',
            category: 'Phones',
            price: 1_200_000,
            images: ['https://cdn.example.com/iphone.jpg'],
            slug: 'iphone-16-pro',
          },
        ],
        error: null,
      }).then(onFulfilled, onRejected),
  };

  return {
    from: vi.fn(() => ({ select: vi.fn(() => query) })),
    rpc: vi.fn<
      (fn: string, args: Record<string, unknown>) => Promise<RankedRpcResult>
    >(),
  } satisfies AutocompleteSupabase;
}

type GetStorefrontAutocompleteProducts =
  typeof import('./storefront-search-autocomplete').getStorefrontAutocompleteProducts;

describe('getStorefrontAutocompleteProducts cache', () => {
  let getStorefrontAutocompleteProducts: GetStorefrontAutocompleteProducts;

  beforeEach(async () => {
    vi.useRealTimers();
    vi.resetModules();
    const autocomplete = await import('./storefront-search-autocomplete');
    getStorefrontAutocompleteProducts =
      autocomplete.getStorefrontAutocompleteProducts;
  });

  it('coalesces concurrent identical autocomplete requests', async () => {
    const supabase = createAutocompleteSupabase();
    let resolveRankedSearch: ((result: RankedRpcResult) => void) | undefined;
    const rankedSearch = new Promise<RankedRpcResult>((resolve) => {
      resolveRankedSearch = resolve;
    });
    supabase.rpc.mockReturnValue(rankedSearch);

    const first = getStorefrontAutocompleteProducts({
      supabase,
      merchantId: FIRST_MERCHANT_ID,
      query: 'iphone',
      limit: 10,
    });
    const second = getStorefrontAutocompleteProducts({
      supabase,
      merchantId: FIRST_MERCHANT_ID,
      query: 'iphone',
      limit: 10,
    });

    resolveRankedSearch?.({
      data: [{ product_id: 'product-1', total_count: 1 }],
      error: null,
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(firstResult.suggestions).toHaveLength(1);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it('reuses a successful response for normalized query variants', async () => {
    const supabase = createAutocompleteSupabase();
    supabase.rpc.mockResolvedValue({
      data: [{ product_id: 'product-1', total_count: 1 }],
      error: null,
    });

    const first = await getStorefrontAutocompleteProducts({
      supabase,
      merchantId: FIRST_MERCHANT_ID,
      query: '  IPHONE  ',
      limit: 10,
    });
    const second = await getStorefrontAutocompleteProducts({
      supabase,
      merchantId: FIRST_MERCHANT_ID,
      query: 'iphone',
      limit: 10,
    });

    expect(second).toEqual(first);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it('does not share in-flight or cached results across different internal whitespace', async () => {
    const supabase = createAutocompleteSupabase();
    supabase.rpc.mockResolvedValue({
      data: [{ product_id: 'product-1', total_count: 1 }],
      error: null,
    });

    await Promise.all([
      getStorefrontAutocompleteProducts({
        supabase,
        merchantId: FIRST_MERCHANT_ID,
        query: 'AB 12',
        limit: 10,
      }),
      getStorefrontAutocompleteProducts({
        supabase,
        merchantId: FIRST_MERCHANT_ID,
        query: 'AB  12',
        limit: 10,
      }),
    ]);

    await getStorefrontAutocompleteProducts({
      supabase,
      merchantId: FIRST_MERCHANT_ID,
      query: 'ab 12',
      limit: 10,
    });

    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      1,
      'search_products_v2',
      expect.objectContaining({ search_query: 'AB 12' })
    );
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      2,
      'search_products_v2',
      expect.objectContaining({ search_query: 'AB  12' })
    );
  });

  it('keeps autocomplete cache entries isolated by merchant', async () => {
    const supabase = createAutocompleteSupabase();
    supabase.rpc.mockResolvedValue({
      data: [{ product_id: 'product-1', total_count: 1 }],
      error: null,
    });

    await getStorefrontAutocompleteProducts({
      supabase,
      merchantId: FIRST_MERCHANT_ID,
      query: 'iphone',
      limit: 10,
    });
    await getStorefrontAutocompleteProducts({
      supabase,
      merchantId: SECOND_MERCHANT_ID,
      query: 'iphone',
      limit: 10,
    });

    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      1,
      'search_products_v2',
      expect.objectContaining({ merchant_id_param: FIRST_MERCHANT_ID })
    );
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      2,
      'search_products_v2',
      expect.objectContaining({ merchant_id_param: SECOND_MERCHANT_ID })
    );
  });

  it('keeps autocomplete cache entries isolated by limit', async () => {
    const supabase = createAutocompleteSupabase();
    supabase.rpc.mockResolvedValue({
      data: [{ product_id: 'product-1', total_count: 1 }],
      error: null,
    });

    await getStorefrontAutocompleteProducts({
      supabase,
      merchantId: FIRST_MERCHANT_ID,
      query: 'iphone',
      limit: 5,
    });
    await getStorefrontAutocompleteProducts({
      supabase,
      merchantId: FIRST_MERCHANT_ID,
      query: 'iphone',
      limit: 10,
    });

    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      1,
      'search_products_v2',
      expect.objectContaining({ result_limit: 5 })
    );
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      2,
      'search_products_v2',
      expect.objectContaining({ result_limit: 10 })
    );
  });

  it('expires a cached response after thirty seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T00:00:00.000Z'));
    const supabase = createAutocompleteSupabase();
    supabase.rpc.mockResolvedValue({
      data: [{ product_id: 'product-1', total_count: 1 }],
      error: null,
    });

    await getStorefrontAutocompleteProducts({
      supabase,
      merchantId: FIRST_MERCHANT_ID,
      query: 'iphone',
      limit: 10,
    });
    await getStorefrontAutocompleteProducts({
      supabase,
      merchantId: FIRST_MERCHANT_ID,
      query: 'iphone',
      limit: 10,
    });
    await vi.advanceTimersByTimeAsync(30_001);
    await getStorefrontAutocompleteProducts({
      supabase,
      merchantId: FIRST_MERCHANT_ID,
      query: 'iphone',
      limit: 10,
    });

    expect(supabase.rpc).toHaveBeenCalledTimes(2);
  });
});
