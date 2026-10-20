import { fetchRefinedProductsPage } from './refined-product-pages';

const mockRpc = jest.fn();
const mockRead = jest.fn();
const mockHydrate = jest.fn();
const mockTransform = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ in: mockRead }) }) }),
    }),
  },
}));
jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (fn: () => Promise<unknown>) => fn(),
}));
jest.mock('./product-hydration', () => ({
  hydrateRowsNeedingStorefrontVariants: (rows: unknown) => mockHydrate(rows),
}));
jest.mock('./product-transform', () => ({
  transformProduct: (...args: unknown[]) => mockTransform(...args),
}));
describe('refined native pages', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockHydrate.mockImplementation((rows: unknown) => rows);
    mockTransform.mockImplementation((row: unknown) => row);
  });
  // Route RPC mocks by name: the search RPC returns match rows while the
  // merchant visibility gate returns its bit.
  function mockSearchRpc(matchData: unknown, visible = true) {
    mockRpc.mockImplementation(async (name: string) =>
      name === 'storefront_search_merchant_is_visible'
        ? { data: visible, error: null }
        : { data: matchData, error: null }
    );
  }
  it.each([
    false,
    true,
  ])('advances when an entire hydrated page disappears (malformed=%s)', async (malformed) => {
    const searchPages = [
      [{ product_id: 'gone', total_count: 2 }],
      [{ product_id: 'visible', total_count: 2 }],
    ];
    let searchPageIndex = 0;
    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'storefront_search_merchant_is_visible')
        return { data: true, error: null };
      return { data: searchPages[searchPageIndex++] ?? [], error: null };
    });
    mockRead
      .mockResolvedValueOnce({
        data: malformed ? [{ id: 'gone' }] : [],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ id: 'visible', price: 100 }],
        error: null,
      });
    if (malformed) mockTransform.mockReturnValueOnce(null);
    const result = await fetchRefinedProductsPage(
      'm',
      'phone',
      { brands: [], sort: 'relevance' },
      1,
      0
    );
    expect(result.products.map((product) => product.id)).toEqual(['visible']);
    expect(result.nextOffset).toBeNull();
    expect(result.total).toBe(1);
    const searchCalls = mockRpc.mock.calls.filter(
      ([name]) => name === 'search_storefront_products_refined'
    );
    expect(searchCalls.at(-1)).toEqual([
      'search_storefront_products_refined',
      expect.objectContaining({ result_offset: 1 }),
    ]);
  });
  it('caps skip-ahead fetches and keeps pagination advancing', async () => {
    mockSearchRpc([{ product_id: 'gone', total_count: 100 }]);
    mockRead.mockResolvedValue({ data: [], error: null });
    const result = await fetchRefinedProductsPage(
      'm',
      'phone',
      { brands: [], sort: 'relevance' },
      1,
      0
    );
    expect(result.products).toEqual([]);
    expect(result.nextOffset).toBe(4);
    // Four pages × (search RPC + visibility gate).
    expect(mockRpc).toHaveBeenCalledTimes(8);
  });
  it('stops after an empty final page', async () => {
    mockSearchRpc([{ product_id: 'gone', total_count: 1 }]);
    mockRead.mockResolvedValue({ data: [], error: null });
    const result = await fetchRefinedProductsPage(
      'm',
      'phone',
      { brands: [], sort: 'relevance' },
      1,
      0
    );
    expect(result).toEqual({ products: [], total: 0, nextOffset: null });
    // One search RPC plus one visibility gate.
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });
  it('stops pagination at the supported RPC offset ceiling', async () => {
    mockSearchRpc([{ product_id: 'p1', total_count: 3000 }]);
    mockRead.mockResolvedValue({
      data: [{ id: 'p1', price: 100 }],
      error: null,
    });
    const result = await fetchRefinedProductsPage(
      'm',
      'phone',
      { brands: [], sort: 'relevance' },
      20,
      1980
    );
    expect(result.products).toHaveLength(1);
    expect(result.nextOffset).toBeNull();
  });
  it('uses the matching option price and keeps ranked ordering and offset', async () => {
    mockSearchRpc([
      {
        product_id: 'p2',
        total_count: 42,
        effective_price: 100,
        matched_variant_id: 'v2',
        matched_condition: 'used',
      },
      { product_id: 'p1', total_count: 42, effective_price: 200 },
    ]);
    mockRead.mockResolvedValue({
      data: [
        { id: 'p1', price: 500 },
        { id: 'p2', price: 700 },
      ],
      error: null,
    });
    const result = await fetchRefinedProductsPage(
      'm',
      'phone',
      { brands: ['Apple', 'Samsung'], sort: 'price_asc' },
      20,
      20
    );
    expect(result.products.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(result.products[0]).toMatchObject({
      price: 100,
      condition: 'used',
      searchMatch: { variantId: 'v2' },
    });
    expect(result.total).toBe(42);
    expect(result.nextOffset).toBe(40);
  });
  it('renders variant-bearing cards without waiting for detail hydration', async () => {
    mockSearchRpc([
      {
        product_id: 'p1',
        total_count: 1,
        effective_price: 200,
        matched_variant_id: 'v1',
      },
    ]);
    mockRead.mockResolvedValue({
      data: [{ id: 'p1', name: 'iPhone', price: 500, has_variants: true }],
      error: null,
    });
    const result = await fetchRefinedProductsPage(
      'm',
      'iphone',
      { brands: [], sort: 'relevance' },
      20,
      0
    );
    expect(mockHydrate).not.toHaveBeenCalled();
    expect(result.products[0]).toMatchObject({
      name: 'iPhone',
      price: 200,
      searchMatch: { variantId: 'v1' },
    });
  });
  it('skips matches whose rows vanished instead of failing the page', async () => {
    mockSearchRpc([
      { product_id: 'p1', total_count: 2 },
      { product_id: 'p2', total_count: 2 },
    ]);
    mockRead.mockResolvedValue({
      data: [{ id: 'p1', price: 500 }],
      error: null,
    });
    const result = await fetchRefinedProductsPage(
      'm',
      'phone',
      { brands: [], sort: 'relevance' },
      20,
      0
    );
    expect(result.products.map((p) => p.id)).toEqual(['p1']);
    expect(result.total).toBe(1);
    expect(result.nextOffset).toBeNull();
  });
  it('skips rows that fail validation instead of failing the page', async () => {
    mockSearchRpc([
      { product_id: 'p1', total_count: 2 },
      { product_id: 'p2', total_count: 2 },
    ]);
    mockRead.mockResolvedValue({
      data: [
        { id: 'p1', price: 500 },
        { id: 'p2', price: 700 },
      ],
      error: null,
    });
    mockTransform.mockReturnValueOnce(null);
    const result = await fetchRefinedProductsPage(
      'm',
      'phone',
      { brands: [], sort: 'relevance' },
      20,
      0
    );
    expect(result.products.map((p) => p.id)).toEqual(['p2']);
    expect(result.total).toBe(1);
  });
  it('continues past a skipped row instead of truncating the list', async () => {
    const matches = Array.from({ length: 20 }, (_, index) => ({
      product_id: `p${index}`,
      total_count: 21,
    }));
    mockSearchRpc(matches);
    mockRead.mockResolvedValue({
      data: Array.from({ length: 20 }, (_, index) => ({
        id: `p${index}`,
        price: 100 + index,
      })).filter((row) => row.id !== 'p5'),
      error: null,
    });
    const result = await fetchRefinedProductsPage(
      'm',
      'phone',
      { brands: [], sort: 'relevance' },
      20,
      0
    );
    expect(result.products).toHaveLength(19);
    expect(result.total).toBe(20);
    expect(result.nextOffset).toBe(20);
  });
  it('does not silently fall back when the new contract fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    await expect(
      fetchRefinedProductsPage(
        'm',
        'phone',
        { brands: [], sort: 'relevance' },
        20,
        0
      )
    ).rejects.toThrow('Search results unavailable');
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRead).not.toHaveBeenCalled();
  });
  it('returns an empty page when the merchant unpublished mid-request', async () => {
    mockSearchRpc([{ product_id: 'p1', total_count: 1 }], false);
    const result = await fetchRefinedProductsPage(
      'm',
      'phone',
      { brands: [], sort: 'relevance' },
      20,
      0
    );
    expect(mockRpc).toHaveBeenLastCalledWith(
      'storefront_search_merchant_is_visible',
      { p_merchant_id: 'm' }
    );
    expect(mockRead).not.toHaveBeenCalled();
    expect(result).toEqual({ products: [], total: 0, nextOffset: null });
  });
});

it('sends processor selection to globally filtered search with pagination', async () => {
  mockRpc.mockResolvedValue({ data: [], error: null });
  await fetchRefinedProductsPage(
    'm',
    'laptop',
    { brands: [], sort: 'price_asc', processor: 'Intel Core i7' },
    20,
    40
  );
  expect(mockRpc).toHaveBeenLastCalledWith(
    'search_storefront_products_processor_refined',
    expect.objectContaining({
      processor_filter: 'Intel Core i7',
      result_offset: 40,
      sort_by: 'price_asc',
    })
  );
});
