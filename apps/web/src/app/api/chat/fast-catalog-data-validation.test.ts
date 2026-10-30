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

const intent = {
  categoryId: 'phones',
  kind: 'search' as const,
  query: 'iPhone 16',
  wifiOnly: false,
  isPhoneCategory: true,
};
const row = {
  id: 'p1',
  merchant_id: 'merchant-1',
  category_id: 'phones',
  name: 'iPhone 16',
  slug: 'iphone-16',
  price: 200_000,
  description: null,
  brand: 'Apple',
  category: 'Smartphones',
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

describe('loadFastCatalogProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const name of ['select', 'eq', 'in', 'order'] as const)
      mocks.query[name].mockReturnValue(mocks.query);
    mocks.query.limit.mockResolvedValue({ data: [row], error: null });
    mocks.from.mockReturnValue(mocks.query);
    mocks.ranked.mockResolvedValue({
      productIds: ['p1'],
      count: 1,
      didYouMean: null,
      query: 'iPhone 16',
    });
    mocks.rpc.mockResolvedValue({ data: [], error: null });
  });

  it('reports unavailable when all returned variant records are malformed', async () => {
    mocks.query.limit.mockResolvedValue({
      data: [
        { ...row, id: 'broken', price: 'invalid' },
        { ...row, has_variants: true, variant_model: 'sku_matrix' },
      ],
      error: null,
    });
    mocks.rpc.mockResolvedValue({
      data: [
        null,
        {
          id: 'v',
          product_id: 'p1',
          attributes: 'invalid',
          price_override: 10,
        },
      ],
      error: null,
    });
    await expect(loadFastCatalogProducts('merchant-1', intent)).rejects.toThrow(
      /catalog/i
    );
  });

  it('fails closed when an unrestricted search cannot identify the phone category', async () => {
    await expect(
      loadFastCatalogProducts('merchant-1', {
        ...intent,
        categoryId: undefined,
        phoneCategoryIds: [],
        isPhoneCategory: false,
      })
    ).rejects.toThrow();
    expect(mocks.ranked).not.toHaveBeenCalled();
  });

  it('does not treat absent selection or stock metadata as a simple available product', async () => {
    for (const invalid of [
      { ...row, has_variants: undefined },
      { ...row, has_condition_offers: undefined },
      { ...row, manage_stock: undefined },
    ]) {
      mocks.query.limit.mockResolvedValue({ data: [invalid], error: null });
      await expect(
        loadFastCatalogProducts('merchant-1', intent)
      ).rejects.toThrow(/catalog/i);
    }
  });
});
