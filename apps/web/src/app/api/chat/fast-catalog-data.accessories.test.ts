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

describe('loadFastCatalogProducts accessories', () => {
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

  it('matches accessory names whether the catalog uses singular or plural', async () => {
    mocks.query.limit.mockResolvedValue({
      data: [{ ...row, name: 'Fast Chargers' }],
      error: null,
    });
    expect(
      (
        await loadFastCatalogProducts('merchant-1', {
          ...intent,
          query: 'charger',
        })
      ).map((p) => p.name)
    ).toEqual(['Fast Chargers']);
  });

  it('does not present controller or microphone cases as phone cases', async () => {
    mocks.ranked.mockResolvedValue({
      productIds: ['p1', 'p2', 'p3'],
      count: 3,
      didYouMean: null,
      query: 'case',
    });
    mocks.query.limit.mockResolvedValue({
      data: [
        { ...row, name: 'PS5 Controller Rubber Case', category_id: 'gaming' },
        {
          ...row,
          id: 'p2',
          name: 'DJI Microphone Charging Case',
          category_id: 'audio',
        },
        {
          ...row,
          id: 'p3',
          name: 'Samsung Galaxy Z Fold8 Clear Case',
          category_id: 'accessories',
        },
      ],
      error: null,
    });
    expect(
      (
        await loadFastCatalogProducts('merchant-1', {
          ...intent,
          categoryId: undefined,
          query: 'case',
          isPhoneCategory: false,
          phoneProtectiveAccessory: true,
          phoneCategoryIds: ['phones'],
        })
      ).map((p) => p.name)
    ).toEqual(['Samsung Galaxy Z Fold8 Clear Case']);
  });
});
