import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  return { query, from: vi.fn(), rpc: vi.fn() };
});

vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));
vi.mock('@/lib/storefront-search', () => ({
  searchStorefrontProducts: vi.fn(),
}));

import { loadFastCatalogProducts } from './fast-catalog-data';

const intent = {
  categoryId: 'phones',
  kind: 'search' as const,
  query: '',
  wifiOnly: false,
  isPhoneCategory: true,
};
const product = {
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
  stock: 9,
  stock_quantity: 0,
  manage_stock: true,
  has_variants: false,
  has_condition_offers: false,
  variant_model: 'legacy',
  available_conditions: ['new'],
  condition: 'new',
  status: 'active',
};

describe('fast catalog simple-product availability', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const name of ['select', 'eq', 'order'] as const)
      mocks.query[name].mockReturnValue(mocks.query);
    mocks.query.limit.mockResolvedValue({ data: [product], error: null });
    mocks.from.mockReturnValue(mocks.query);
    mocks.rpc.mockResolvedValue({ data: [], error: null });
  });

  it('does not recommend a managed product when only legacy stock is positive', async () => {
    for (const stockQuantity of [0, null]) {
      mocks.query.limit.mockResolvedValue({
        data: [{ ...product, stock_quantity: stockQuantity }],
        error: null,
      });
      expect(await loadFastCatalogProducts('merchant-1', intent)).toEqual([]);
    }
  });

  it('gates even an unmanaged product on its strict serialized units', async () => {
    mocks.query.limit.mockResolvedValue({
      data: [{ ...product, manage_stock: false }],
      error: null,
    });
    mocks.rpc.mockResolvedValue({
      data: [
        {
          product_id: 'p1',
          effective_policy: 'serialized_strict',
          available_units: 0,
        },
      ],
      error: null,
    });
    expect(await loadFastCatalogProducts('merchant-1', intent)).toEqual([]);
    mocks.rpc.mockResolvedValue({
      data: [
        {
          product_id: 'p1',
          effective_policy: 'serialized_strict',
          available_units: 2,
        },
      ],
      error: null,
    });
    expect(await loadFastCatalogProducts('merchant-1', intent)).toMatchObject([
      { id: 'p1', manage_stock: true, stock: 2 },
    ]);
  });

  it('keeps an unlimited serialized product available without units', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          product_id: 'p1',
          effective_policy: 'serialized_then_unlimited',
          available_units: 0,
        },
      ],
      error: null,
    });
    expect(await loadFastCatalogProducts('merchant-1', intent)).toMatchObject([
      { id: 'p1', manage_stock: false },
    ]);
  });

  it('fails closed when serialized availability cannot be checked', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await expect(
      loadFastCatalogProducts('merchant-1', intent)
    ).rejects.toThrow();
  });

  it('keeps each serialized availability lookup within the 100-product RPC limit', async () => {
    mocks.query.limit.mockResolvedValue({
      data: Array.from({ length: 101 }, (_, i) => ({
        ...product,
        id: `p${i}`,
        stock_quantity: 1,
      })),
      error: null,
    });
    await loadFastCatalogProducts('merchant-1', intent);
    const calls = mocks.rpc.mock.calls.filter(
      ([name]) => name === 'get_mcp_search_serialized_anchor_policies'
    );
    expect(calls).toHaveLength(2);
    expect(calls.map(([, args]) => args.p_product_ids.length)).toEqual([
      100, 1,
    ]);
    expect(calls.every(([, args]) => args.p_merchant_id === 'merchant-1')).toBe(
      true
    );
  });
});
