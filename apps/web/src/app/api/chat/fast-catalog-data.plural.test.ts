import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  return { query, from: vi.fn(), rpc: vi.fn(), ranked: vi.fn() };
});

vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));
vi.mock('@/lib/storefront-search', () => ({
  searchStorefrontProducts: mocks.ranked,
}));

import { loadFastCatalogProducts } from './fast-catalog-data';

const row = {
  id: 'mac-1',
  merchant_id: 'merchant-1',
  category_id: 'laptops',
  name: 'Apple MacBook Air M2',
  slug: 'apple-macbook-air-m2',
  price: 1_450_000,
  description: null,
  brand: 'Apple',
  category: 'Laptops',
  images: [],
  stock: 1,
  stock_quantity: 1,
  manage_stock: true,
  has_variants: false,
  has_condition_offers: false,
  variant_model: 'legacy',
  available_conditions: ['new'],
  condition: 'new',
  status: 'active',
};

describe('loadFastCatalogProducts plural normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const name of ['select', 'eq', 'in', 'order'] as const)
      mocks.query[name].mockReturnValue(mocks.query);
    mocks.from.mockReturnValue(mocks.query);
    mocks.rpc.mockResolvedValue({ data: [], error: null });
  });

  it('matches singular product titles even when given a plural device query', async () => {
    mocks.ranked.mockResolvedValue({
      productIds: ['mac-1'],
      count: 1,
      didYouMean: null,
      query: 'macbooks',
    });
    mocks.query.limit.mockResolvedValue({ data: [row], error: null });

    const products = await loadFastCatalogProducts('merchant-1', {
      categoryId: 'laptops',
      kind: 'search',
      query: 'macbooks',
      wifiOnly: false,
      isPhoneCategory: false,
      maxPrice: 2_000_000,
      exclusiveMaxPrice: true,
    });

    expect(products.map((product) => product.name)).toEqual([
      'Apple MacBook Air M2',
    ]);
  });
});
