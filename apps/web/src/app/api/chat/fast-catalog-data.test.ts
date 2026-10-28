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

  it('limits ranked results to the resolved merchant and requested category', async () => {
    const products = await loadFastCatalogProducts('merchant-1', intent);
    expect(products.map((product) => product.name)).toEqual(['iPhone 16']);
    expect(mocks.ranked).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        filters: { categoryId: 'phones' },
        query: 'iPhone 16',
      })
    );
    expect(mocks.query.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(mocks.query.eq).toHaveBeenCalledWith('category_id', 'phones');
    expect(mocks.query.eq).toHaveBeenCalledWith('status', 'active');
  });

  it('rejects unexpected rows from another merchant or category', async () => {
    mocks.query.limit.mockResolvedValue({
      data: [
        { ...row, id: 'other-merchant', merchant_id: 'other' },
        { ...row, id: 'chair', category_id: 'gaming', name: 'Gaming chair' },
      ],
      error: null,
    });
    expect(await loadFastCatalogProducts('merchant-1', intent)).toEqual([]);
  });

  it('fails closed when the variant lookup fails', async () => {
    mocks.query.limit.mockResolvedValue({
      data: [{ ...row, has_variants: true, variant_model: 'sku_matrix' }],
      error: null,
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'unavailable' },
    });
    await expect(
      loadFastCatalogProducts('merchant-1', intent)
    ).rejects.toThrow();
  });

  it('only suggests products the catalog marks for the requested use case', async () => {
    mocks.query.limit.mockResolvedValue({
      data: [
        { ...row, product_key_specs: { recommended_for: ['premium gaming'] } },
        {
          ...row,
          id: 'p2',
          name: 'Basic phone',
          product_key_specs: { recommended_for: ['business'] },
        },
      ],
      error: null,
    });
    const products = await loadFastCatalogProducts('merchant-1', {
      ...intent,
      query: '',
      preference: 'gaming',
    });
    expect(products.map((product) => product.name)).toEqual(['iPhone 16']);
  });

  it('does not treat missing or malformed catalog tags as recommendations', async () => {
    mocks.query.limit.mockResolvedValue({
      data: [
        { ...row, product_key_specs: null },
        { ...row, id: 'p2', product_key_specs: { recommended_for: 'gaming' } },
        {
          ...row,
          id: 'p3',
          product_key_specs: [{ recommended_for: ['photography'] }],
        },
      ],
      error: null,
    });
    expect(
      await loadFastCatalogProducts('merchant-1', {
        ...intent,
        query: '',
        preference: 'gaming',
      })
    ).toEqual([]);
    expect(
      (
        await loadFastCatalogProducts('merchant-1', {
          ...intent,
          query: '',
          preference: 'camera',
        })
      ).map((p) => p.id)
    ).toEqual(['p3']);
  });

  it('rejects a row outside the ranked search result even if its tenant matches', async () => {
    mocks.query.limit.mockResolvedValue({
      data: [{ ...row, id: 'unexpected' }],
      error: null,
    });
    expect(await loadFastCatalogProducts('merchant-1', intent)).toEqual([]);
  });

  it('does not broaden a named model to a different model returned by search', async () => {
    mocks.ranked.mockResolvedValue({
      productIds: ['p1', 'p2'],
      count: 2,
      didYouMean: null,
      query: 'iPhone 16 Pro',
    });
    mocks.query.limit.mockResolvedValue({
      data: [
        { ...row, name: 'iPhone 16 Pro' },
        { ...row, id: 'p2', name: 'iPhone 16' },
      ],
      error: null,
    });
    expect(
      (
        await loadFastCatalogProducts('merchant-1', {
          ...intent,
          query: 'iPhone 16 Pro',
        })
      ).map((p) => p.name)
    ).toEqual(['iPhone 16 Pro']);
  });

  it('searches named products across the merchant catalog while recognizing phone families', async () => {
    mocks.ranked.mockResolvedValue({
      productIds: ['p1', 'p2'],
      count: 2,
      didYouMean: null,
      query: 'Apple',
    });
    mocks.query.limit.mockResolvedValue({
      data: [
        { ...row, has_variants: true, variant_model: 'sku_matrix' },
        { ...row, id: 'p2', name: 'Apple AirPods', category_id: 'audio' },
      ],
      error: null,
    });
    mocks.rpc.mockResolvedValue({
      data: [
        {
          id: 'v1',
          product_id: 'p1',
          attributes: { sim_type: 'Wi-Fi Only' },
          price_override: 100_000,
          stock_quantity: 1,
        },
      ],
      error: null,
    });
    expect(
      (
        await loadFastCatalogProducts('merchant-1', {
          ...intent,
          categoryId: undefined,
          query: 'Apple',
          isPhoneCategory: false,
          phoneCategoryIds: ['phones'],
        })
      ).map((p) => p.name)
    ).toEqual(['Apple AirPods']);
    expect(mocks.query.eq).not.toHaveBeenCalledWith(
      'category_id',
      expect.anything()
    );
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

  it('ignores malformed product and variant records rather than trusting them', async () => {
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
    expect(await loadFastCatalogProducts('merchant-1', intent)).toEqual([]);
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

  it('does not treat missing selection or stock metadata as a simple available product', async () => {
    for (const invalid of [
      { ...row, has_variants: null },
      { ...row, has_condition_offers: null },
      { ...row, manage_stock: null },
    ]) {
      mocks.query.limit.mockResolvedValue({ data: [invalid], error: null });
      expect(await loadFastCatalogProducts('merchant-1', intent)).toEqual([]);
    }
  });
});
