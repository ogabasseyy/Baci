import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAgenticScopedSupabaseClient: vi.fn(),
  createPublicClient: vi.fn(),
  resolveAgenticChatTenant: vi.fn(),
  searchStorefrontProducts: vi.fn(),
}));

vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: mocks.createAgenticScopedSupabaseClient,
}));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: mocks.createPublicClient,
}));
vi.mock('@/lib/agentic/agentic-chat-tenant', () => ({
  resolveAgenticChatTenant: mocks.resolveAgenticChatTenant,
}));
vi.mock('@/lib/storefront-search', () => ({
  searchStorefrontProducts: mocks.searchStorefrontProducts,
}));

import {
  createQueryMock,
  OGABASSEY_MERCHANT_ID,
} from '../../tests/ai/chat-tool-handlers.test-support';
import {
  handleGetProductDetails,
  handleGetRecommendations,
  handleSearchProducts,
} from './chat-catalog-handlers';

describe('read-only catalog handlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveAgenticChatTenant.mockResolvedValue({
      agenticCheckoutEnabled: true,
      businessName: 'Ogabassey',
      currencyCode: 'NGN',
      merchantId: OGABASSEY_MERCHANT_ID,
      merchantSlug: 'ogabassey',
      priceNegotiationEnabled: true,
    });
  });

  afterEach(() => {
    expect(mocks.createAgenticScopedSupabaseClient).not.toHaveBeenCalled();
  });

  it('uses a public RLS client for catalog search rather than minting a checkout JWT', async () => {
    mocks.searchStorefrontProducts.mockResolvedValue({
      count: 0,
      didYouMean: null,
      productIds: [],
      query: 'phone',
    });
    const query = createQueryMock({ data: [], error: null });
    mocks.createPublicClient.mockReturnValue({ from: vi.fn(() => query) });

    await handleSearchProducts({ query: 'phone' });

    expect(mocks.createPublicClient).toHaveBeenCalledWith({
      clientInfo: 'baci-chat-catalog',
    });
  });

  it('restricts product details to active Ogabassey products', async () => {
    const query = createQueryMock();
    mocks.createPublicClient.mockReturnValue({
      from: vi.fn(() => query),
    });

    await handleGetProductDetails({ productId: 'product-1' });

    expect(query.eq).toHaveBeenCalledWith('id', 'product-1');
    expect(query.eq).toHaveBeenCalledWith('merchant_id', OGABASSEY_MERCHANT_ID);
    expect(query.eq).toHaveBeenCalledWith('status', 'active');
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
    mocks.createPublicClient.mockReturnValue({ from });

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
});
