import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, read, suggestion } = vi.hoisted(() => ({
  rpc: vi.fn(),
  read: vi.fn(),
  suggestion: vi.fn(),
}));
vi.mock('./storefront-search-did-you-mean', () => ({
  findStorefrontSearchDidYouMean: suggestion,
}));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('./supabase/server', () => ({
  createClient: () => ({
    rpc,
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ in: read }) }) }),
    }),
  }),
}));
vi.mock('./normalize-product', () => ({
  normalizeProduct: (row: unknown) => row,
}));

import { getStorefrontRefinedSearchProducts } from './storefront-search-refined-products';

describe('refined product hydration', () => {
  beforeEach(() => vi.clearAllMocks());
  it('retains typo recovery for empty refined results', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    suggestion.mockResolvedValue('iphone');
    const result = await getStorefrontRefinedSearchProducts({
      merchantId: 'm1',
      query: 'iphon',
      limit: 20,
      refinements: { brands: [], sort: 'relevance' },
    });
    expect(result.didYouMean).toBe('iphone');
    expect(suggestion).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'iphon', merchantId: 'm1' })
    );
  });
  it('suppresses typo recovery when refinements alone empty the results', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({
      data: [{ product_id: 'p1', total_count: 5, effective_price: 99 }],
      error: null,
    });
    suggestion.mockResolvedValue('iphone');
    const result = await getStorefrontRefinedSearchProducts({
      merchantId: 'm1',
      query: 'iphone',
      limit: 20,
      refinements: { brands: [], sort: 'relevance', maxPrice: 1 },
    });
    expect(result.didYouMean).toBeNull();
    expect(suggestion).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({
      brands_filter: [],
      result_limit: 1,
      result_offset: 0,
    });
  });
  it('keeps typo recovery when the unrefined query is also empty', async () => {
    rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    suggestion.mockResolvedValue('iphone');
    const result = await getStorefrontRefinedSearchProducts({
      merchantId: 'm1',
      query: 'iphon',
      limit: 20,
      refinements: { brands: ['Apple'], sort: 'relevance' },
    });
    expect(result.didYouMean).toBe('iphone');
    expect(suggestion).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'iphon', merchantId: 'm1' })
    );
  });
  it('fails closed when the unrefined probe errors', async () => {
    rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    suggestion.mockResolvedValue('iphone');
    const result = await getStorefrontRefinedSearchProducts({
      merchantId: 'm1',
      query: 'iphone',
      limit: 20,
      refinements: { brands: [], sort: 'relevance', maxPrice: 1 },
    });
    expect(result.didYouMean).toBeNull();
    expect(suggestion).not.toHaveBeenCalled();
  });
  it('displays the matching variant price in ranked order', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          product_id: 'p1',
          total_count: 1,
          effective_price: 200000,
          matched_variant_id: 'v1',
          matched_condition: 'used',
        },
      ],
      error: null,
    });
    read.mockResolvedValue({
      data: [
        {
          id: 'p1',
          price: 500000,
          condition: 'new',
          available_conditions: ['new', 'used'],
        },
      ],
      error: null,
    });
    const result = await getStorefrontRefinedSearchProducts({
      merchantId: 'm1',
      query: 'phone',
      limit: 20,
      refinements: {
        brands: ['Apple', 'Samsung'],
        sort: 'relevance',
        condition: 'used',
        maxPrice: 250000,
      },
    });
    expect(result.products[0]).toMatchObject({
      price: 200000,
      condition: 'used',
      available_conditions: ['used'],
      searchMatch: { variantId: 'v1' },
    });
    expect(result.count).toBe(1);
  });
  it('skips matches whose rows vanished instead of failing the page', async () => {
    rpc.mockResolvedValue({
      data: [
        { product_id: 'p1', total_count: 2 },
        { product_id: 'p2', total_count: 2 },
      ],
      error: null,
    });
    read.mockResolvedValue({
      data: [{ id: 'p1', price: 100 }],
      error: null,
    });
    const result = await getStorefrontRefinedSearchProducts({
      merchantId: 'm1',
      query: 'phone',
      limit: 20,
      refinements: { brands: [], sort: 'relevance' },
    });
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ price: 100 });
    expect(result.productIds).toEqual(['p1']);
    expect(result.count).toBe(1);
    // Page arithmetic uses the raw RPC total: the skipped row stays ranked.
    expect(result.totalCount).toBe(2);
  });
  it('preserves all condition metadata when sorting an unrefined search', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          product_id: 'p1',
          total_count: 1,
          effective_price: 200000,
          matched_variant_id: 'v1',
          matched_condition: 'used',
        },
      ],
      error: null,
    });
    read.mockResolvedValue({
      data: [
        {
          id: 'p1',
          price: 500000,
          condition: 'new',
          available_conditions: ['new', 'used'],
        },
      ],
      error: null,
    });
    const result = await getStorefrontRefinedSearchProducts({
      merchantId: 'm1',
      query: 'phone',
      limit: 20,
      refinements: { brands: [], sort: 'price_asc' },
    });
    expect(result.products[0].available_conditions).toEqual(['new', 'used']);
    expect(result.products[0].price).toBe(200000);
  });
  it('fails visibly when the required database contract is unavailable', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    await expect(
      getStorefrontRefinedSearchProducts({
        merchantId: 'm1',
        query: 'phone',
        limit: 20,
        refinements: { brands: [], sort: 'relevance' },
      })
    ).rejects.toThrow('Search results unavailable');
    expect(read).not.toHaveBeenCalled();
  });
});

it('reads only complete available-query facets and propagates failures', async () => {
  const { getStorefrontSearchFacets } = await import(
    './storefront-search-refined-products'
  );
  rpc.mockResolvedValue({
    data: {
      brands: ['Apple'],
      categories: [],
      conditions: ['used'],
      minPrice: 10,
      maxPrice: 20,
    },
    error: null,
  });
  const facets = await getStorefrontSearchFacets('m1', 'iphone', {
    brands: [],
    sort: 'relevance',
  });
  expect(facets.conditions).toEqual(['used']);
  expect(rpc).toHaveBeenLastCalledWith(
    'get_storefront_search_available_facets',
    { search_query: 'iphone', merchant_id_param: 'm1' }
  );
  rpc.mockResolvedValue({ data: null, error: { code: 'fail' } });
  await expect(
    getStorefrontSearchFacets('m1', 'iphone', { brands: [], sort: 'relevance' })
  ).rejects.toThrow('Filter options unavailable');
});

it('sends processor selection to global search before pagination', async () => {
  rpc.mockResolvedValue({ data: [], error: null });
  suggestion.mockResolvedValue(null);
  await getStorefrontRefinedSearchProducts({
    merchantId: 'm',
    query: 'laptop',
    refinements: { brands: [], sort: 'price_asc', processor: 'Intel Core i7' },
    limit: 20,
    offset: 40,
  });
  // The empty refined page also probes the unrefined query before typo
  // recovery, so the processor-bearing call is asserted by value.
  expect(rpc).toHaveBeenCalledWith(
    'search_storefront_products_processor_refined',
    expect.objectContaining({
      processor_filter: 'Intel Core i7',
      result_offset: 40,
    })
  );
});

it('requests category-specific facets when a type is selected', async () => {
  const { getStorefrontSearchFacets } = await import(
    './storefront-search-refined-products'
  );
  rpc.mockResolvedValue({
    data: {
      brands: ['HP'],
      categories: [],
      conditions: ['new'],
      processors: ['Intel Core i7'],
      minPrice: 100,
      maxPrice: 200,
    },
    error: null,
  });
  const result = await getStorefrontSearchFacets('m', 'laptop', {
    brands: [],
    sort: 'relevance',
    categoryId: 'gaming-category',
  });
  expect(result.processors).toEqual(['Intel Core i7']);
  expect(rpc).toHaveBeenLastCalledWith(
    'get_storefront_search_category_facets',
    {
      search_query: 'laptop',
      merchant_id_param: 'm',
      category_id_param: 'gaming-category',
    }
  );
});

it('never renders a negative count when all matched rows disappear', async () => {
  rpc.mockResolvedValue({
    data: [{ product_id: 'p1', total_count: 0 }],
    error: null,
  });
  read.mockResolvedValue({ data: [], error: null });
  const result = await getStorefrontRefinedSearchProducts({
    merchantId: 'm1',
    query: 'phone',
    limit: 20,
    refinements: { brands: [], sort: 'relevance' },
  });
  expect(result.count).toBe(0);
  expect(result.totalCount).toBe(0);
});
