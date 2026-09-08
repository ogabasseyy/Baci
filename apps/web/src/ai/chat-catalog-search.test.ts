import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryMock } from './chat-query.test-support';

const mocks = vi.hoisted(() => ({
  createAgenticScopedSupabaseClient: vi.fn(),
  searchStorefrontProducts: vi.fn(),
}));
vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: mocks.createAgenticScopedSupabaseClient,
}));
vi.mock('@/lib/storefront-search', () => ({
  searchStorefrontProducts: mocks.searchStorefrontProducts,
}));
vi.mock('@/ai/chat-catalog-context', () => ({
  getChatCatalogContext: async () => ({
    supabase: mocks.createAgenticScopedSupabaseClient(),
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  }),
}));

import { handleSearchProducts } from './chat-tool-handlers';

const OGABASSEY_MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
describe('chat tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchStorefrontProducts.mockReset();
  });
  it('routes chat product search through shared ranked search and preserves ranked hydration order', async () => {
    mocks.searchStorefrontProducts.mockResolvedValue({
      count: 2,
      didYouMean: null,
      productIds: ['iphone-16-pro', 'iphone-x'],
      query: 'iphnoe',
    });
    const query = createQueryMock({
      count: 2,
      data: [
        {
          id: 'iphone-x',
          name: 'iPhone X',
          price: 240_000,
          description: 'Used iPhone',
          brand: 'Apple',
          category: 'Phones',
          images: [{ url: 'https://cdn.example.com/iphone-x.jpg' }],
          stock: 2,
          status: 'active',
        },
        {
          id: 'iphone-16-pro',
          name: 'iPhone 16 Pro',
          price: 1_200_000,
          description: 'New iPhone',
          brand: 'Apple',
          category: 'Phones',
          images: [{ url: 'https://cdn.example.com/iphone-16-pro.jpg' }],
          stock: 5,
          status: 'active',
        },
      ],
      error: null,
    });
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
      rpc: vi.fn(),
    });

    const result = await handleSearchProducts({
      query: 'iphnoe',
      minPrice: 100_000,
      maxPrice: 1_500_000,
    });

    expect(mocks.searchStorefrontProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          maxPrice: 1_500_000,
          minPrice: 100_000,
        }),
        limit: 10,
        merchantId: OGABASSEY_MERCHANT_ID,
        query: 'iphnoe',
        trackAnalytics: false,
      })
    );
    expect(query.in).toHaveBeenCalledWith('id', ['iphone-16-pro', 'iphone-x']);
    expect(query.or).not.toHaveBeenCalled();
    expect(result.products.map((product) => product.id)).toEqual([
      'iphone-16-pro',
      'iphone-x',
    ]);
    expect(result.total).toBe(2);
  });

  it('sanitizes PostgREST separator characters before ranked chat search', async () => {
    mocks.searchStorefrontProducts.mockResolvedValue({
      count: 1,
      didYouMean: null,
      productIds: ['iphone-case'],
      query: 'iphone casecover',
    });
    const query = createQueryMock({
      data: [
        {
          id: 'iphone-case',
          name: 'iPhone Case',
          price: 25_000,
          description: 'Protective case',
          brand: 'Apple',
          category: 'Accessories',
          images: [{ url: 'https://cdn.example.com/case.jpg' }],
          stock: 7,
          status: 'active',
        },
      ],
      error: null,
    });
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
      rpc: vi.fn(),
    });

    const result = await handleSearchProducts({
      query: 'iphone, case|cover();\\',
    });

    expect(mocks.searchStorefrontProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'iphone casecover',
      })
    );
    expect(query.or).not.toHaveBeenCalled();
    expect(query.ilike).not.toHaveBeenCalled();
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.id).toBe('iphone-case');
    expect(result.total).toBe(1);
  });

  it('uses category text as the ranked search query when no free-text query is provided', async () => {
    mocks.searchStorefrontProducts.mockResolvedValue({
      count: 0,
      didYouMean: null,
      productIds: [],
      query: 'Laptops',
    });
    const query = createQueryMock({ data: [], error: null });
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
      rpc: vi.fn(),
    });

    const result = await handleSearchProducts({
      query: '',
      category: 'Laptops',
    });

    expect(mocks.searchStorefrontProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: OGABASSEY_MERCHANT_ID,
        query: 'Laptops',
        trackAnalytics: false,
      })
    );
    expect(query.or).not.toHaveBeenCalled();
    expect(result).toEqual({ products: [], total: 0 });
  });

  it('rejects when ranked search fails instead of returning no matches', async () => {
    mocks.searchStorefrontProducts.mockRejectedValueOnce(
      new Error('search rpc unavailable')
    );
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: vi.fn(),
      rpc: vi.fn(),
    });

    await expect(handleSearchProducts({ query: 'iphone' })).rejects.toThrow(
      'Catalog search temporarily unavailable'
    );
  });
});
