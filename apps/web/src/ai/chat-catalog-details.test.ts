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

import { handleGetProductDetails } from './chat-catalog-details';

const OGABASSEY_MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
describe('chat tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchStorefrontProducts.mockReset();
  });
  it('restricts product details to active Ogabassey products', async () => {
    const query = createQueryMock();
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
    });

    await handleGetProductDetails({ productId: 'product-1' });

    expect(query.eq).toHaveBeenCalledWith('id', 'product-1');
    expect(query.eq).toHaveBeenCalledWith('merchant_id', OGABASSEY_MERCHANT_ID);
    expect(query.eq).toHaveBeenCalledWith('status', 'active');
  });

  it('returns null when scoped product details are missing', async () => {
    const query = createQueryMock({ data: null, error: null });
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
    });

    const result = await handleGetProductDetails({ productId: 'product-1' });

    expect(result).toBeNull();
  });

  it('returns null when product detail lookup fails', async () => {
    const query = createQueryMock({
      data: null,
      error: new Error('database unavailable'),
    });
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
    });

    const result = await handleGetProductDetails({ productId: 'product-1' });

    expect(result).toBeNull();
  });

  it('returns null when product detail lookup rejects', async () => {
    const query = createQueryMock();
    query.single.mockRejectedValueOnce(new Error('network unavailable'));
    mocks.createAgenticScopedSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
    });

    const result = await handleGetProductDetails({ productId: 'product-1' });

    expect(result).toBeNull();
  });
});
