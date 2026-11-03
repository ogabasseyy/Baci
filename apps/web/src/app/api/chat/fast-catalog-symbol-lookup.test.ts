import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  const symbolQuery = {
    eq: vi.fn(),
    ilike: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  return { query, symbolQuery, from: vi.fn(), rpc: vi.fn(), ranked: vi.fn() };
});

vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));
vi.mock('@/lib/storefront-search', () => ({
  searchStorefrontProducts: mocks.ranked,
}));

import { loadFastCatalogProducts } from './fast-catalog-data';

const row = {
  id: 'p1',
  merchant_id: 'merchant-1',
  category_id: 'phones',
  name: 'Samsung Galaxy S24',
  slug: 'samsung-galaxy-s24',
  price: 200_000,
  description: null,
  brand: 'Samsung',
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

beforeEach(() => {
  vi.clearAllMocks();
  for (const name of ['select', 'eq', 'in', 'order'] as const)
    mocks.query[name].mockReturnValue(mocks.query);
  for (const name of ['eq', 'ilike', 'order'] as const)
    mocks.symbolQuery[name].mockReturnValue(mocks.symbolQuery);
  mocks.query.select.mockImplementation((columns: string) =>
    columns === 'id' ? mocks.symbolQuery : mocks.query
  );
  mocks.symbolQuery.limit.mockResolvedValue({ data: [], error: null });
  mocks.query.limit.mockResolvedValue({
    data: [
      row,
      { ...row, id: 'sold-out', stock: 0, stock_quantity: 0 },
      { ...row, id: 'other-merchant', merchant_id: 'other' },
    ],
    error: null,
  });
  mocks.from.mockReturnValue(mocks.query);
  mocks.ranked.mockResolvedValue({
    productIds: ['p1', 'sold-out', 'other-merchant'],
    count: 3,
    didYouMean: null,
  });
  mocks.rpc.mockResolvedValue({ data: [], error: null });
});

it('keeps a symbol-named Plus candidate when both rankings are full of base models', async () => {
  const baseRows = Array.from({ length: 50 }, (_, index) => ({
    ...row,
    id: `base-${index}`,
    name: 'Samsung Galaxy S21',
  }));
  const plus = { ...row, id: 'symbol-plus', name: 'Samsung Galaxy S21+' };
  mocks.ranked.mockResolvedValue({
    productIds: baseRows.map((p) => p.id),
    count: 50,
    didYouMean: null,
  });
  mocks.symbolQuery.limit.mockResolvedValue({
    data: [{ id: 'symbol-plus' }],
    error: null,
  });
  mocks.query.limit.mockImplementation(async (limit: number) => ({
    data: [...baseRows, plus].slice(0, limit),
    error: null,
  }));

  const products = await loadFastCatalogProducts('merchant-1', {
    kind: 'search',
    categoryId: 'phones',
    query: 'Samsung Galaxy S21+',
    wifiOnly: false,
    isPhoneCategory: true,
  });
  expect(products.map((product) => product.id)).toEqual(['symbol-plus']);
  expect(mocks.symbolQuery.eq).toHaveBeenCalledWith(
    'merchant_id',
    'merchant-1'
  );
  expect(mocks.symbolQuery.eq).toHaveBeenCalledWith('category_id', 'phones');
  expect(mocks.symbolQuery.eq).toHaveBeenCalledWith('status', 'active');
  expect(mocks.symbolQuery.ilike).toHaveBeenCalledWith('name', '%S21+%');
});

it('reserves candidate capacity for symbol names ahead of a full broad ranking', async () => {
  const specificRows = Array.from({ length: 50 }, (_, index) => ({
    ...row,
    id: `specific-${index}`,
    name: 'Samsung Galaxy S21 with Galaxy Buds Plus',
  }));
  const broadRows = Array.from({ length: 50 }, (_, index) => ({
    ...row,
    id: `broad-${index}`,
    name: 'Samsung Galaxy S21',
  }));
  const plus = { ...row, id: 'symbol-plus', name: 'Samsung Galaxy S21+' };
  mocks.ranked.mockImplementation(async ({ query }: { query: string }) => ({
    productIds: (query === 'Samsung Galaxy S21 Plus'
      ? specificRows
      : broadRows
    ).map((p) => p.id),
    count: 50,
    didYouMean: null,
  }));
  mocks.symbolQuery.limit.mockResolvedValue({
    data: [{ id: 'symbol-plus' }],
    error: null,
  });
  mocks.query.limit.mockResolvedValue({
    data: [...specificRows, ...broadRows.slice(0, 49), plus],
    error: null,
  });

  const products = await loadFastCatalogProducts('merchant-1', {
    kind: 'search',
    categoryId: 'phones',
    query: 'Samsung Galaxy S21+',
    wifiOnly: false,
    isPhoneCategory: true,
  });
  expect(products.map((product) => product.id)).toEqual(['symbol-plus']);
  expect(mocks.query.in).toHaveBeenCalledWith(
    'id',
    expect.arrayContaining(['symbol-plus'])
  );
  expect(mocks.query.limit).toHaveBeenCalledWith(100);
});

it('fails closed if the supplemental symbol lookup fails', async () => {
  mocks.symbolQuery.limit.mockResolvedValue({
    data: null,
    error: { message: 'unavailable' },
  });
  await expect(
    loadFastCatalogProducts('merchant-1', {
      kind: 'search',
      categoryId: 'phones',
      query: 'Samsung Galaxy S21+',
      wifiOnly: false,
      isPhoneCategory: true,
    })
  ).rejects.toThrow();
});

it('checks the literal Pro+ suffix and its model number within the category', async () => {
  mocks.ranked.mockResolvedValue({
    productIds: ['base'],
    count: 1,
    didYouMean: null,
  });
  mocks.symbolQuery.limit.mockResolvedValue({
    data: [{ id: 'pro-plus' }],
    error: null,
  });
  mocks.query.limit.mockResolvedValue({
    data: [
      { ...row, id: 'base', name: 'Tecno Spark 40 Pro', brand: 'Tecno' },
      { ...row, id: 'pro-plus', name: 'Tecno Spark 40 Pro+', brand: 'Tecno' },
    ],
    error: null,
  });
  const products = await loadFastCatalogProducts('merchant-1', {
    kind: 'search',
    categoryId: 'phones',
    query: 'Tecno Spark 40 Pro+',
    wifiOnly: false,
    isPhoneCategory: true,
  });
  expect(products.map((product) => product.id)).toEqual(['pro-plus']);
  expect(mocks.symbolQuery.ilike).toHaveBeenCalledWith('name', '%Pro+%');
  expect(mocks.symbolQuery.ilike).toHaveBeenCalledWith('name', '%40%');
  expect(mocks.symbolQuery.eq).toHaveBeenCalledWith('category_id', 'phones');
});

it('does not perform the supplemental symbol lookup without a resolved category', async () => {
  await loadFastCatalogProducts('merchant-1', {
    kind: 'search',
    phoneCategoryIds: ['phones'],
    query: 'Samsung Galaxy S21+',
    wifiOnly: false,
    isPhoneCategory: false,
  });
  expect(mocks.symbolQuery.ilike).not.toHaveBeenCalled();
});

it('returns the word-form Plus product instead of a replacement part', async () => {
  mocks.ranked.mockResolvedValue({
    productIds: ['buds', 'replacement'],
    count: 2,
    didYouMean: null,
  });
  mocks.query.limit.mockResolvedValue({
    data: [
      {
        ...row,
        id: 'buds',
        category_id: 'earbuds',
        name: 'Samsung Galaxy Buds Plus',
      },
      {
        ...row,
        id: 'replacement',
        category_id: 'accessories',
        name: 'Samsung Galaxy Buds Plus Replacement Left Earbud',
      },
    ],
    error: null,
  });
  const products = await loadFastCatalogProducts('merchant-1', {
    kind: 'search',
    phoneCategoryIds: ['phones'],
    query: 'Samsung Galaxy Buds Plus',
    wifiOnly: false,
    isPhoneCategory: false,
  });
  expect(products.map((product) => product.id)).toEqual(['buds']);
});
