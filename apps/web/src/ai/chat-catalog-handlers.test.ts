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
  it('searches active products across names, descriptions, brands, and categories with price filters', async () => {
    mocks.searchStorefrontProducts.mockResolvedValue({
      count: 1,
      didYouMean: null,
      productIds: ['macbook-air-m4'],
      query: 'laptop',
    });
    const query = createQueryMock({
      data: [
        {
          id: 'macbook-air-m4',
          name: '15" MacBook Air M4 (2025)',
          price: 1_265_000,
          description: 'Apple laptop',
          brand: 'Apple',
          category: 'Laptops',
          images: [{ url: 'https://cdn.example.com/macbook.jpg' }],
          stock: 3,
          status: 'active',
        },
      ],
      error: null,
    });
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
    });

    const result = await handleSearchProducts({
      query: 'laptop',
      minPrice: 1_200_000,
      maxPrice: 1_400_000,
    });

    expect(query.eq).toHaveBeenCalledWith('merchant_id', OGABASSEY_MERCHANT_ID);
    expect(query.eq).toHaveBeenCalledWith('status', 'active');
    expect(mocks.searchStorefrontProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          maxPrice: 1_400_000,
          minPrice: 1_200_000,
        }),
        limit: 10,
        merchantId: OGABASSEY_MERCHANT_ID,
        query: 'laptop',
        trackAnalytics: false,
      })
    );
    expect(query.in).toHaveBeenCalledWith('id', ['macbook-air-m4']);
    expect(query.or).not.toHaveBeenCalled();
    expect(query.gte).toHaveBeenCalledWith('price', 1_200_000);
    expect(query.lte).toHaveBeenCalledWith('price', 1_400_000);
    expect(result).toEqual({
      products: [
        {
          id: 'macbook-air-m4',
          name: '15" MacBook Air M4 (2025)',
          price: 1_265_000,
          description: 'Apple laptop',
          brand: 'Apple',
          category: 'Laptops',
          image_url: 'https://cdn.example.com/macbook.jpg',
          stock: 3,
          status: 'active',
        },
      ],
      total: 1,
    });
  });

  it('uses optional category as an additional search term instead of a hard AND filter', async () => {
    mocks.searchStorefrontProducts.mockResolvedValue({
      count: 0,
      didYouMean: null,
      productIds: [],
      query: 'MacBook Laptops',
    });
    const query = createQueryMock({ data: [], error: null });
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
    });

    await handleSearchProducts({
      query: 'MacBook',
      category: 'Laptops',
      minPrice: 1_200_000,
      maxPrice: 1_400_000,
    });

    expect(mocks.searchStorefrontProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: OGABASSEY_MERCHANT_ID,
        query: 'MacBook Laptops',
        trackAnalytics: false,
      })
    );
    expect(query.or).not.toHaveBeenCalled();
    expect(query.ilike).not.toHaveBeenCalled();
  });

  it('searches by category when no free-text query is provided', async () => {
    mocks.searchStorefrontProducts.mockResolvedValue({
      count: 0,
      didYouMean: null,
      productIds: [],
      query: 'Laptops',
    });
    const query = createQueryMock({ data: [], error: null });
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
    });

    await handleSearchProducts({
      query: '',
      category: 'Laptops',
      minPrice: 1_200_000,
      maxPrice: 1_400_000,
    });

    expect(mocks.searchStorefrontProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: OGABASSEY_MERCHANT_ID,
        query: 'Laptops',
        trackAnalytics: false,
      })
    );
    expect(query.or).not.toHaveBeenCalled();
  });
});
