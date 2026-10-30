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
import { interpretFastCatalogIntent } from './fast-catalog-intent';

const categories = [
  { id: 'phones', name: 'Smartphones', slug: 'smartphones' },
  { id: 'accessories', name: 'Accessories', slug: 'accessories' },
];
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

it('returns only available tenant phones for an in-stock brand question', async () => {
  const intent = interpretFastCatalogIntent(
    ['Do you have Samsung phones in stock?'],
    categories
  );
  if (intent?.kind !== 'search') throw new Error('Expected a search');

  const products = await loadFastCatalogProducts('merchant-1', intent);
  expect(products.map((product) => product.id)).toEqual(['p1']);
  expect(mocks.query.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
});

it('keeps a Plus candidate even when the broad ranking is full of base models', async () => {
  const baseRows = Array.from({ length: 50 }, (_, index) => ({
    ...row,
    id: `base-${index}`,
    name: 'Samsung Galaxy S21',
  }));
  const plus = { ...row, id: 'plus', name: 'Samsung Galaxy S21 Plus' };
  mocks.ranked.mockImplementation(async ({ query }: { query: string }) => ({
    productIds:
      query === 'Samsung Galaxy S21 Plus'
        ? ['plus']
        : baseRows.map((p) => p.id),
    count: query === 'Samsung Galaxy S21 Plus' ? 1 : 50,
    didYouMean: null,
  }));
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
  expect(products.map((product) => product.id)).toEqual(['plus']);
  expect(mocks.query.limit).toHaveBeenCalledWith(51);
});

it('finds a symbol-named Plus charger without assuming an ambiguous word-form name', async () => {
  const intent = interpretFastCatalogIntent(
    ['Samsung Galaxy S21+ phone charger in stock'],
    categories
  );
  if (intent?.kind !== 'search') throw new Error('Expected a search');
  mocks.query.limit.mockResolvedValue({
    data: [
      {
        ...row,
        id: 'symbol',
        category_id: 'accessories',
        name: 'Samsung Galaxy S21+ Phone Charger',
      },
      {
        ...row,
        id: 'word',
        category_id: 'accessories',
        name: 'Samsung Galaxy S21 Plus Charger',
      },
      {
        ...row,
        id: 'base',
        category_id: 'accessories',
        name: 'Samsung Galaxy S21 Phone Charger',
      },
    ],
    error: null,
  });
  mocks.ranked.mockResolvedValue({
    productIds: ['symbol', 'word', 'base'],
    count: 3,
    didYouMean: null,
  });

  expect(
    (await loadFastCatalogProducts('merchant-1', intent)).map((p) => p.id)
  ).toEqual(['symbol']);
});

it.each([
  'Samsung Galaxy S21+',
  'Samsung Galaxy S21 Plus',
])('does not replace the requested Plus model with the base model: %s', async (query) => {
  mocks.query.limit.mockResolvedValue({
    data: [
      { ...row, id: 'plus-symbol', name: 'Samsung Galaxy S21+' },
      { ...row, id: 'plus-word', name: 'Samsung Galaxy S21 Plus' },
      { ...row, id: 'base', name: 'Samsung Galaxy S21' },
      {
        ...row,
        id: 'unrelated-plus',
        name: 'Samsung Galaxy S21 with Galaxy Buds Plus',
      },
      { ...row, id: 'ambiguous-word', name: 'Samsung Galaxy S21 Plus Charger' },
      {
        ...row,
        id: 'ambiguous-modifier',
        name: 'Samsung Galaxy S21 Plus USB-C Charger',
      },
      {
        ...row,
        id: 'ambiguous-symbol',
        name: 'Samsung Galaxy S21+USB-C Charger',
      },
    ],
    error: null,
  });
  mocks.ranked.mockResolvedValue({
    productIds: [
      'plus-symbol',
      'plus-word',
      'base',
      'unrelated-plus',
      'ambiguous-word',
      'ambiguous-modifier',
      'ambiguous-symbol',
    ],
    count: 7,
    didYouMean: null,
  });

  const products = await loadFastCatalogProducts('merchant-1', {
    kind: 'search',
    categoryId: 'phones',
    query,
    wifiOnly: false,
    isPhoneCategory: true,
  });
  expect(products.map((product) => product.id)).toEqual([
    'plus-symbol',
    'plus-word',
  ]);
  expect(mocks.ranked).toHaveBeenCalledWith(
    expect.objectContaining({ query: 'Samsung Galaxy S21' })
  );
});

it.each([
  'Samsung Galaxy S21+5G',
  'Samsung Galaxy S21 Plus 5G',
])('preserves a Plus suffix attached to 5G: %s', async (query) => {
  mocks.query.limit.mockResolvedValue({
    data: [
      { ...row, id: 'plus-symbol', name: 'Samsung Galaxy S21+5G' },
      { ...row, id: 'plus-word', name: 'Samsung Galaxy S21 Plus 5G' },
      { ...row, id: 'base', name: 'Samsung Galaxy S21 5G' },
      {
        ...row,
        id: 'unrelated-plus',
        name: 'Samsung Galaxy S21 5G with Galaxy Buds Plus',
      },
    ],
    error: null,
  });
  mocks.ranked.mockResolvedValue({
    productIds: ['plus-symbol', 'plus-word', 'base', 'unrelated-plus'],
    count: 4,
    didYouMean: null,
  });

  const products = await loadFastCatalogProducts('merchant-1', {
    kind: 'search',
    categoryId: 'phones',
    query,
    wifiOnly: false,
    isPhoneCategory: true,
  });
  expect(products.map((product) => product.id)).toEqual([
    'plus-symbol',
    'plus-word',
  ]);
  expect(mocks.ranked).toHaveBeenCalledWith(
    expect.objectContaining({ query: 'Samsung Galaxy S21 5G' })
  );
});
