import { beforeEach, expect, it, vi } from 'vitest';

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
import { interpretFastCatalogIntent } from './fast-catalog-intent';

const categories = [{ id: 'phones', name: 'Smartphones', slug: 'smartphones' }];
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
  product_key_specs: { recommended_for: ['battery'] },
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const name of ['select', 'eq', 'in', 'order'] as const)
    mocks.query[name].mockReturnValue(mocks.query);
  mocks.query.limit.mockResolvedValue({
    data: [
      row,
      { ...row, id: 'out-of-stock', stock_quantity: 0 },
      { ...row, id: 'other-merchant', merchant_id: 'other' },
      { ...row, id: 'untagged', product_key_specs: null },
    ],
    error: null,
  });
  mocks.from.mockReturnValue(mocks.query);
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  mocks.ranked.mockResolvedValue({
    productIds: ['p1', 'out-of-stock', 'other-merchant', 'untagged'],
    count: 4,
    didYouMean: null,
    query: 'Samsung',
  });
});

it('returns only in-stock tenant products marked for the requested use case', async () => {
  const intent = interpretFastCatalogIntent(
    ['Show me phones with long battery life'],
    categories
  );
  expect(intent?.kind).toBe('search');
  if (intent?.kind !== 'search') return;
  const products = await loadFastCatalogProducts('merchant-1', intent);
  expect(products.map(({ name, price }) => ({ name, price }))).toEqual([
    { name: 'Samsung Galaxy S24', price: 200_000 },
  ]);
  expect(mocks.ranked).not.toHaveBeenCalled();
  expect(mocks.query.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
});

it('retains a named brand and budget while filtering the use case', async () => {
  const intent = interpretFastCatalogIntent(
    ['Samsung phones with long battery life under 500k'],
    categories
  );
  expect(intent?.kind).toBe('search');
  if (intent?.kind !== 'search') return;
  expect(
    (await loadFastCatalogProducts('merchant-1', intent)).map((p) => p.id)
  ).toEqual(['p1']);
  expect(mocks.ranked).toHaveBeenCalledWith(
    expect.objectContaining({ merchantId: 'merchant-1', query: 'Samsung' })
  );
});
