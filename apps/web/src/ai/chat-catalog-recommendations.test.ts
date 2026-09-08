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

import { handleGetRecommendations } from './chat-catalog-recommendations';

const OGABASSEY_MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
describe('chat tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchStorefrontProducts.mockReset();
  });
  it('restricts recommendations to active Ogabassey products', async () => {
    const sourceQuery = createQueryMock({
      data: {
        id: 'source-product',
        name: 'Galaxy S26',
        price: 900_000,
        category: 'Smartphones',
        brand: 'Samsung',
      },
      error: null,
    });
    const recommendationQuery = createQueryMock({
      data: [
        {
          id: 'recommended-product',
          name: 'Galaxy S26 Ultra',
          price: 1_100_000,
          description: 'A larger Galaxy model',
          brand: 'Samsung',
          category: 'Smartphones',
          images: [{ url: 'https://cdn.example.com/galaxy.jpg' }],
          stock: 4,
          status: 'active',
        },
      ],
      error: null,
    });
    const from = vi
      .fn()
      .mockReturnValueOnce(sourceQuery)
      .mockReturnValueOnce(recommendationQuery);
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({ from });

    const result = await handleGetRecommendations({
      productId: 'source-product',
      type: 'upsell',
    });

    expect(sourceQuery.eq).toHaveBeenCalledWith('id', 'source-product');
    expect(sourceQuery.eq).toHaveBeenCalledWith(
      'merchant_id',
      OGABASSEY_MERCHANT_ID
    );
    expect(sourceQuery.eq).toHaveBeenCalledWith('status', 'active');
    expect(recommendationQuery.eq).toHaveBeenCalledWith(
      'merchant_id',
      OGABASSEY_MERCHANT_ID
    );
    expect(recommendationQuery.eq).toHaveBeenCalledWith('status', 'active');
    expect(recommendationQuery.neq).toHaveBeenCalledWith(
      'id',
      'source-product'
    );
    expect(result).toEqual([
      {
        id: 'recommended-product',
        name: 'Galaxy S26 Ultra',
        price: 1_100_000,
        description: 'A larger Galaxy model',
        brand: 'Samsung',
        category: 'Smartphones',
        image_url: 'https://cdn.example.com/galaxy.jpg',
        stock: 4,
        status: 'active',
      },
    ]);
  });

  it('returns no recommendations when the scoped source product is missing', async () => {
    const sourceQuery = createQueryMock({ data: null, error: null });
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: vi.fn(() => sourceQuery),
    });

    const result = await handleGetRecommendations({
      productId: 'source-product',
      type: 'cross_sell',
    });

    expect(result).toEqual([]);
  });

  it('returns no recommendations when source lookup rejects', async () => {
    const sourceQuery = createQueryMock();
    sourceQuery.maybeSingle.mockRejectedValueOnce(
      new Error('network unavailable')
    );
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: vi.fn(() => sourceQuery),
    });

    const result = await handleGetRecommendations({
      productId: 'source-product',
      type: 'cross_sell',
    });

    expect(result).toEqual([]);
  });
});
